#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.resolve("prime-agent"))), "..");
const launcher = fileURLToPath(new URL("../dist/web/launcher.mjs", import.meta.url));
const sourceRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const sourceWebApp = resolve(sourceRoot, "web", "app");
const viteCli = resolve(sourceRoot, "web", "app", "node_modules", "vite", "bin", "vite.js");
const workspaceRoot = process.cwd();

function run(entrypoint, args, cwd) {
	const child = spawn(process.execPath, [entrypoint, ...args], {
		cwd,
		env: { ...process.env, PRIME_AGENT_WORKSPACE_ROOT: workspaceRoot },
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
	const cli = resolve(packageRoot, "dist", "bundle", "cli.js");
	run(cli, process.argv.slice(3));
} else if (existsSync(launcher)) {
	run(launcher, process.argv.slice(2));
} else if (existsSync(viteCli)) {
	console.warn("Fleet Prime production bundle is not built; starting the source web server.");
	run(viteCli, ["dev", ...process.argv.slice(2)], sourceWebApp);
} else {
	throw new Error("Fleet Prime is not built. Run npm run build:web:release before launching this installation.");
}
