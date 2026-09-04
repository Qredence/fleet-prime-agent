#!/usr/bin/env node

import { parse } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const browserSourceRoots = ["web/app", "web/design"];
const forbiddenPackages = [
	"prime-agent",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-tui",
];

function forbiddenPackage(specifier) {
	return forbiddenPackages.find((packageName) => specifier === packageName || specifier.startsWith(packageName + "/"));
}

export function findForbiddenImports(source, fileName = "source.ts") {
	const isTypeScript = /\.[cm]?tsx?$/.test(fileName);
	const isJsx = /\.[jt]sx$/.test(fileName);
	const ast = parse(source, {
		errorRecovery: true,
		plugins: [...(isTypeScript ? ["typescript"] : []), ...(isJsx ? ["jsx"] : [])],
		sourceType: "unambiguous",
	});
	const imports = [];

	function record(moduleSpecifier) {
		if (moduleSpecifier?.type !== "StringLiteral") return;
		const packageName = forbiddenPackage(moduleSpecifier.value);
		if (!packageName) return;
		imports.push({ line: moduleSpecifier.loc.start.line, packageName });
	}

	function visit(node) {
		if (!node || typeof node !== "object") return;
		if (
			node.type === "ImportDeclaration" ||
			node.type === "ExportNamedDeclaration" ||
			node.type === "ExportAllDeclaration"
		) {
			record(node.source);
		} else if (node.type === "ImportExpression" || node.type === "TSExternalModuleReference") {
			record(node.source ?? node.expression);
		} else if (
			node.type === "CallExpression" &&
			(node.callee.type === "Import" || (node.callee.type === "Identifier" && node.callee.name === "require"))
		) {
			record(node.arguments[0]);
		}

		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const child of value) visit(child);
			} else if (value && typeof value === "object" && typeof value.type === "string") {
				visit(value);
			}
		}
	}

	visit(ast.program);
	return imports;
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

function main() {
	const violations = [];
	for (const sourceRoot of browserSourceRoots) {
		for (const file of sourceFiles(resolve(root, sourceRoot))) {
			const source = readFileSync(file, "utf8");
			for (const { line, packageName } of findForbiddenImports(source, file)) {
				violations.push(relative(root, file) + ":" + line + " imports " + packageName);
			}
		}
	}

	if (violations.length > 0) {
		console.error("Browser packages must not import Prime Agent runtime packages directly:");
		for (const violation of violations) console.error("- " + violation);
		process.exit(1);
	}

	console.log("Browser/runtime import boundary passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
