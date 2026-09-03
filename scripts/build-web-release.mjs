#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webDist = join(root, "web", "app", "dist");
const serverEntry = join(webDist, "server", "server.js");
const clientSource = join(webDist, "client");
const releaseRoot = join(root, "packages", "fleet-prime", "dist", "web");
const serverOutput = join(releaseRoot, "server");
const fleetPackage = JSON.parse(readFileSync(join(root, "packages", "fleet-prime", "package.json"), "utf8"));

if (!existsSync(serverEntry) || !existsSync(clientSource)) {
	throw new Error("Missing web build output. Run pnpm --filter @prime-agent/web build first.");
}

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
cpSync(clientSource, join(releaseRoot, "client"), { recursive: true });

const packageDependencies = new Set([
	...Object.keys(fleetPackage.dependencies ?? {}),
	...Object.keys(fleetPackage.optionalDependencies ?? {}),
]);
const builtinModuleNames = new Set([...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]);

/**
 * Extract the root package name from a package specifier.
 * @param {string} specifier - A package name, optionally including a subpath.
 * @return {string} The package root name, including its scope when present.
 */
function packageName(specifier) {
	return specifier.startsWith("@") ? specifier.split("/", 2).join("/") : specifier.split("/", 1)[0];
}

/**
 * Audits external server imports against the package's declared dependencies.
 * @param {object} metafile - The esbuild metafile containing bundle output import data.
 * @throws {Error} If an external non-relative, non-builtin import is undeclared.
 */
function auditExternalImports(metafile) {
	const external = new Set();
	for (const output of Object.values(metafile.outputs)) {
		for (const imported of output.imports ?? []) {
			if (!imported.external) continue;
			const specifier = imported.path;
			if (!specifier.startsWith(".") && !specifier.startsWith("/") && !builtinModuleNames.has(specifier)) {
				external.add(packageName(specifier));
			}
		}
	}
	const undeclared = [...external].filter((dependency) => !packageDependencies.has(dependency)).sort();
	if (undeclared.length > 0) {
		throw new Error(
			`Bundled server has external imports that are not direct production dependencies: ${undeclared.join(", ")}`,
		);
	}
	console.log(`Bundled server external audit passed: ${[...external].sort().join(", ") || "none"}.`);
}

const buildResult = await build({
	entryPoints: [serverEntry],
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	splitting: true,
	outdir: serverOutput,
	logLevel: "info",
	metafile: true,
	external: [
		...packageDependencies,
		...[...packageDependencies]
			.filter((dependency) => dependency.startsWith("@"))
			.map((dependency) => `${dependency}/*`),
	],
});

auditExternalImports(buildResult.metafile);

cpSync(join(root, "scripts", "prime-agent-web-launcher.mjs"), join(releaseRoot, "launcher.mjs"));

console.log(`Packaged web runtime in ${releaseRoot}`);
