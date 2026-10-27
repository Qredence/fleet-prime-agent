#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensurePrimeRuntime } from "./prime-runtime.mjs";

const packagedManifestPath = fileURLToPath(new URL("../dist/runtime-manifest.json", import.meta.url));
const sourceManifestPath = fileURLToPath(new URL("../../../PRIME_AGENT_RUNTIME.json", import.meta.url));
const runtimeManifestPath = existsSync(packagedManifestPath) ? packagedManifestPath : sourceManifestPath;
const launcher = fileURLToPath(new URL("../dist/web/launcher.mjs", import.meta.url));
const isAgentCommand = process.argv[2] === "agent";
const nativeBinary =
	isAgentCommand || existsSync(launcher)
		? (process.env.FLEET_PRIME_AGENT_BIN ??
			(await ensurePrimeRuntime({ manifest: JSON.parse(await readFile(runtimeManifestPath, "utf8")) })))
		: undefined;
const sourceRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sourceWebApp = resolve(sourceRoot, "web", "app");
const viteCli = resolve(sourceRoot, "web", "app", "node_modules", "vite", "bin", "vite.js");
const workspaceRoot = process.cwd();

/**
 * Launch a Node.js entry point and mirror its signals and exit status.
 * @param {string} entrypoint - Path to the Node.js entry point.
 * @param {string[]} args - Arguments passed to the entry point.
 * @param {string} cwd - Working directory for the child process.
 */
function run(entrypoint, args, cwd) {
	const child = spawn(process.execPath, [entrypoint, ...args], {
		cwd,
		env: {
			...process.env,
			PRIME_AGENT_WORKSPACE_ROOT: workspaceRoot,
			...(nativeBinary ? { FLEET_PRIME_AGENT_BIN: nativeBinary } : {}),
		},
		stdio: "inherit",
	});
	const forwardSignal = (signal) => {
		child.kill(signal);
	};
	process.once("SIGINT", () => forwardSignal("SIGINT"));
	process.once("SIGTERM", () => forwardSignal("SIGTERM"));
	child.on("exit", (code, signal) => {
		if (signal) process.kill(process.pid, signal);
		else process.exitCode = code ?? 1;
	});
}

if (process.argv[2] === "agent") {
	const args = process.argv.slice(3);
	const child = spawn(nativeBinary, args, { cwd: workspaceRoot, env: process.env, stdio: "inherit" });
	child.on("error", (error) => {
		console.error(
			error.code === "ENOENT"
				? `Prime Agent binary not found: ${nativeBinary}`
				: `Could not start Prime Agent: ${error.code || error.message}`,
		);
		process.exitCode = 1;
	});
	process.once("SIGINT", () => child.kill("SIGINT"));
	process.once("SIGTERM", () => child.kill("SIGTERM"));
	child.on("exit", (code, signal) => {
		if (signal) process.kill(process.pid, signal);
		else process.exitCode = code ?? 1;
	});
} else if (existsSync(launcher)) {
	run(launcher, process.argv.slice(2), workspaceRoot);
} else if (existsSync(viteCli)) {
	console.warn("Fleet Prime production bundle is not built; starting the source web server.");
	run(viteCli, ["dev", ...process.argv.slice(2)], sourceWebApp);
} else {
	throw new Error("Fleet Prime is not built. Run pnpm run build:web:release before launching this installation.");
}
