#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browserSourceRoots = ["web/app"];
const forbiddenPackages = [
	"prime-agent",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-tui",
	// TypeSafe classification is server-only; the API key must never reach the
	// browser bundle. Fleet talks to it over /api/chat/intent instead.
	"@typesafe-ai/sdk",
];

function forbiddenPackage(specifier) {
	return forbiddenPackages.find((packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`));
}

function parseModule(source, fileName) {
	const isTypeScript = /\.[cm]?tsx?$/.test(fileName);
	const isJsx = /\.[jt]sx$/.test(fileName);
	return parse(source, {
		errorRecovery: true,
		plugins: [...(isTypeScript ? ["typescript"] : []), ...(isJsx ? ["jsx"] : [])],
		sourceType: "unambiguous",
	});
}

function specifierName(node) {
	if (!node) return undefined;
	return node.type === "StringLiteral" ? node.value : node.name;
}

/**
 * Every module reference in `source` with the names it binds: named imports and
 * re-exports list their imported names; default imports are `default`; namespace
 * imports, `export *`, side-effect imports, `import()` and `require()` are `*`.
 */
function moduleReferences(source, fileName) {
	const references = [];

	function record(moduleSpecifier, names) {
		if (moduleSpecifier?.type !== "StringLiteral") return;
		references.push({ line: moduleSpecifier.loc.start.line, specifier: moduleSpecifier.value, names });
	}

	function visit(node) {
		if (!node || typeof node !== "object") return;
		if (node.type === "ImportDeclaration") {
			const names = node.specifiers.map((specifier) =>
				specifier.type === "ImportSpecifier"
					? specifierName(specifier.imported)
					: specifier.type === "ImportDefaultSpecifier"
						? "default"
						: "*",
			);
			record(node.source, names.length > 0 ? names : ["*"]);
		} else if (node.type === "ExportNamedDeclaration") {
			record(
				node.source,
				(node.specifiers ?? []).map((specifier) => specifierName(specifier.local)),
			);
		} else if (node.type === "ExportAllDeclaration") {
			record(node.source, ["*"]);
		} else if (node.type === "ImportExpression" || node.type === "TSExternalModuleReference") {
			record(node.source ?? node.expression, ["*"]);
		} else if (
			node.type === "CallExpression" &&
			(node.callee.type === "Import" || (node.callee.type === "Identifier" && node.callee.name === "require"))
		) {
			record(node.arguments[0], ["*"]);
		}

		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const child of value) visit(child);
			} else if (value && typeof value === "object" && typeof value.type === "string") {
				visit(value);
			}
		}
	}

	visit(parseModule(source, fileName).program);
	return references;
}

export function findForbiddenImports(source, fileName = "source.ts") {
	const imports = [];
	for (const { line, specifier } of moduleReferences(source, fileName)) {
		const packageName = forbiddenPackage(specifier);
		if (packageName) imports.push({ line, packageName });
	}
	return imports;
}

// R1b legacy bridge (docs/plans/prime-agent-v0.10.1.md). Temporary: delete this
// section together with web/server/src/legacy/ after the Rust daemon cutover.
//
// web/server/src reaches the v0.9.8 SDK's on-disk config and transcript classes
// only through the bridge module. Every other SDK import that production server
// code still has is pinned in scripts/server-sdk-imports.baseline.json; those go
// away with the R1 socket client. The baseline only ever shrinks: a new file
// importing the SDK, or a new name imported from it, fails the check.
const legacyBridgeModule = "web/server/src/legacy/prime-agent-sdk.ts";
const serverSourceRoot = "web/server/src";
const serverSdkPackages = ["prime-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"];
const legacyBridgeSymbols = new Set([
	"AuthStorage",
	"buildSessionContext",
	"DefaultResourceLoader",
	"getAgentDir",
	"migrateSessionEntries",
	"ModelRegistry",
	"parseSessionEntries",
	"SessionManager",
	"SettingsManager",
]);
// The runtime provisions its own kernel (PRIME_AGENT_KERNEL_VENV on v0.10.1).
const retiredSdkSymbols = new Set(["IpythonKernelProvisioner"]);

function serverSdkPackage(specifier) {
	return serverSdkPackages.find((packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`));
}

export function isServerTestPath(relativePath) {
	const parts = relativePath.split(/[/\\]/);
	return parts.includes("__tests__") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath);
}

/** SDK names `source` imports, keyed `<specifier>#<name>`, with the line of each. */
export function findServerSdkImports(source, fileName = "source.ts") {
	const imports = [];
	for (const { line, specifier, names } of moduleReferences(source, fileName)) {
		if (!serverSdkPackage(specifier)) continue;
		for (const name of names) imports.push({ line, specifier, name });
	}
	return imports;
}

/**
 * Violations for one web/server/src file. `baseline` maps a repo-relative path to
 * the `<specifier>#<name>` keys it may still import outside the bridge.
 */
export function findServerSdkViolations(relativePath, source, baseline) {
	const violations = [];
	const imports = findServerSdkImports(source, relativePath);
	for (const { line, name } of imports) {
		if (retiredSdkSymbols.has(name)) {
			violations.push(`${relativePath}:${line} imports ${name}, which Fleet no longer uses`);
		}
	}
	if (relativePath === legacyBridgeModule || isServerTestPath(relativePath)) return violations;
	const allowed = new Set(baseline[relativePath] ?? []);
	for (const { line, specifier, name } of imports) {
		if (retiredSdkSymbols.has(name)) continue;
		if (legacyBridgeSymbols.has(name) && !allowed.has(`${specifier}#${name}`)) {
			violations.push(`${relativePath}:${line} imports ${name} from ${specifier}; use ${legacyBridgeModule}`);
		} else if (!allowed.has(`${specifier}#${name}`)) {
			violations.push(
				`${relativePath}:${line} adds ${name} from ${specifier}; new Prime Agent SDK imports are frozen until the R1 cutover`,
			);
		}
	}
	return violations;
}

function sourceFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules" && entry.name !== "dist") files.push(...sourceFiles(path));
			continue;
		}
		if (/\.(?:c|m)?[jt]sx?$/.test(entry.name)) files.push(path);
	}
	return files;
}

const arbitraryTypeScalePattern = /text-\[0\./;
const typeScaleRoots = ["web/app"];

export function findArbitraryTypeScaleLines(source) {
	const lines = [];
	const parts = source.split("\n");
	for (let index = 0; index < parts.length; index += 1) {
		if (arbitraryTypeScalePattern.test(parts[index])) lines.push(index + 1);
	}
	return lines;
}

export function isTypeScaleExemptPath(relativePath) {
	return relativePath.split(/[/\\]/).includes("openui");
}

function main() {
	const violations = [];
	for (const sourceRoot of browserSourceRoots) {
		for (const file of sourceFiles(resolve(root, sourceRoot))) {
			const source = readFileSync(file, "utf8");
			for (const { line, packageName } of findForbiddenImports(source, file)) {
				violations.push(`${relative(root, file)}:${line} imports ${packageName}`);
			}
		}
	}

	if (violations.length > 0) {
		console.error("Browser packages must not import Prime Agent runtime packages directly:");
		for (const violation of violations) console.error(`- ${violation}`);
		process.exit(1);
	}

	const typeScaleViolations = [];
	for (const sourceRoot of typeScaleRoots) {
		for (const file of sourceFiles(resolve(root, sourceRoot))) {
			const relativePath = relative(root, file);
			if (isTypeScaleExemptPath(relativePath)) continue;
			const source = readFileSync(file, "utf8");
			for (const line of findArbitraryTypeScaleLines(source)) {
				typeScaleViolations.push(
					`${relativePath}:${line} uses arbitrary text-[0. size (use text-micro/caption/label/body)`,
				);
			}
		}
	}

	if (typeScaleViolations.length > 0) {
		console.error("Fleet UI must use the named type scale outside openui/:");
		for (const violation of typeScaleViolations) console.error(`- ${violation}`);
		process.exit(1);
	}

	const baseline = JSON.parse(readFileSync(resolve(root, "scripts/server-sdk-imports.baseline.json"), "utf8"));
	const serverViolations = [];
	for (const file of sourceFiles(resolve(root, serverSourceRoot))) {
		const relativePath = relative(root, file).split(sep).join("/");
		serverViolations.push(...findServerSdkViolations(relativePath, readFileSync(file, "utf8"), baseline.files));
	}

	if (serverViolations.length > 0) {
		console.error("web/server must reach the legacy Prime Agent SDK through the R1b bridge:");
		for (const violation of serverViolations) console.error(`- ${violation}`);
		process.exit(1);
	}

	console.log("Browser/runtime import boundary passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
