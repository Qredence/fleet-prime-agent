#!/usr/bin/env node

import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const webDist = join(root, "web", "app", "dist");
const serverEntry = join(webDist, "server", "server.js");
const clientSource = join(webDist, "client");
const releaseRoot = join(root, "packages", "fleet-prime", "dist", "web");
const serverOutput = join(releaseRoot, "server");
const fleetPackage = JSON.parse(readFileSync(join(root, "packages", "fleet-prime", "package.json"), "utf8"));

if (!existsSync(serverEntry) || !existsSync(clientSource)) {
	throw new Error("Missing web build output. Run pnpm --dir web --filter @prime-agent/web build first.");
}

rmSync(releaseRoot, { recursive: true, force: true });
mkdirSync(releaseRoot, { recursive: true });
cpSync(clientSource, join(releaseRoot, "client"), { recursive: true });

const packageDependencies = new Set([
	...Object.keys(fleetPackage.dependencies ?? {}),
	...Object.keys(fleetPackage.optionalDependencies ?? {}),
]);

await build({
	entryPoints: [serverEntry],
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node22",
	splitting: true,
	outdir: serverOutput,
	logLevel: "info",
	external: [
		...packageDependencies,
		...[...packageDependencies]
			.filter((dependency) => dependency.startsWith("@"))
			.map((dependency) => `${dependency}/*`),
		"prime-agent",
		"@mariozechner/clipboard",
		"@silvia-odwyer/photon-node",
		"debug",
		"hosted-git-info",
		"koffi",
		"react",
		"react/*",
		"react-dom",
		"react-dom/*",
		"use-sync-external-store",
		"use-sync-external-store/*",
		"undici",
		"zeromq",
	],
});

cpSync(
	join(root, "scripts", "prime-agent-web-launcher.mjs"),
	join(releaseRoot, "launcher.mjs"),
);

console.log(`Packaged web runtime in ${releaseRoot}`);
