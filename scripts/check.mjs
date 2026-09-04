#!/usr/bin/env node

// Quality-gate orchestrator. Replaces the sequential `pnpm run check` chain.
//
// Phase 1 (sequential, fast): the runtime manifest check fails fast before any
// other work, then Biome checks the repository. Formatting is read-only by
// default; pass --write only from the explicit developer formatting command.
//
// Phase 2 (concurrent): boundary, installer, rendering, and typecheck stages
// are independent read-only checks, so they run in parallel. Unlike the
// previous &&-chain, a phase-2 failure no longer hides the results of later
// stages; every stage always runs and all failures are reported.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pnpmInvocation } from "./pnpm-command.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const write = process.argv.includes("--write");
const unexpectedArguments = process.argv.slice(2).filter((argument) => argument !== "--write");
if (unexpectedArguments.length > 0) {
	console.error(`Unknown option: ${unexpectedArguments[0]}`);
	process.exit(1);
}

// Spawn the package's bin/biome Node wrapper instead of the extensionless
// .bin shim: the wrapper resolves the platform binary (including the win32
// .exe) and process.execPath works on every OS.
const biomeBin = resolve(root, "node_modules/@biomejs/biome/bin/biome");
if (existsSync(resolve(root, "package-lock.json"))) {
	console.error("Root package-lock.json is not allowed; use the pnpm workspace lockfile.");
	process.exit(1);
}

function runStage(label, command, args) {
	return new Promise((resolvePromise) => {
		const child = spawn(command, args, {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		child.on("error", (error) => {
			resolvePromise({ label, code: 1, output: `${error.message}\n` });
		});
		child.on("close", (code) => {
			resolvePromise({ label, code: code ?? 1, output });
		});
	});
}

function report(results) {
	let failed = false;
	for (const { label, code, output } of results) {
		const status = code === 0 ? "PASS" : "FAIL";
		if (code !== 0) failed = true;
		console.log(`\n===== check:${label} [${status}] =====`);
		if (output.trim().length > 0) {
			process.stdout.write(output);
		}
	}
	return failed;
}

const runtime = await runStage("runtime", process.execPath, ["scripts/check-prime-agent-runtime.mjs"]);
if (runtime.code !== 0) {
	report([runtime]);
	console.error("\ncheck:runtime failed; skipping remaining stages.");
	process.exit(1);
}

const biome = await runStage("biome", process.execPath, [
	biomeBin,
	"check",
	...(write ? ["--write"] : []),
	"--error-on-warnings",
	".",
]);
if (biome.code !== 0) {
	report([runtime, biome]);
	console.error("\ncheck:biome failed; skipping remaining stages.");
	process.exit(1);
}

const pnpmTypecheck = pnpmInvocation(["run", "check:web"]);
const phase2 = await Promise.all([
	runStage("boundaries", process.execPath, ["scripts/check-web-boundaries.mjs"]),
	runStage("installer", process.execPath, ["scripts/check-source-installer.mjs", "--static"]),
	runStage("rendering", process.execPath, ["web/design/scripts/render-checks.mjs"]),
	runStage("typecheck", pnpmTypecheck.command, pnpmTypecheck.args),
]);

const failed = report([runtime, biome, ...phase2]);
console.log(failed ? "\ncheck failed." : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
