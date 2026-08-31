#!/usr/bin/env node

// Quality-gate orchestrator. Replaces the sequential `pnpm run check` chain.
//
// Phase 1 (sequential, fast): the runtime manifest check fails fast before any
// other work, then biome --write runs alone because it mutates files and
// concurrent readers must observe the formatted state.
//
// Phase 2 (concurrent): installer, rendering, and typecheck stages are
// independent read-only checks, so they run in parallel. Unlike the previous
// &&-chain, a phase-2 failure no longer hides the results of later stages;
// every stage always runs and all failures are reported.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Spawn the package's bin/biome Node wrapper instead of the extensionless
// .bin shim: the wrapper resolves the platform binary (including the win32
// .exe) and process.execPath works on every OS.
const biomeBin = resolve(root, "node_modules/@biomejs/biome/bin/biome");

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
	"--write",
	"--error-on-warnings",
	".",
]);
if (biome.code !== 0) {
	report([runtime, biome]);
	console.error("\ncheck:biome failed; skipping remaining stages.");
	process.exit(1);
}

const phase2 = await Promise.all([
	runStage("installer", process.execPath, ["scripts/check-source-installer.mjs", "--static"]),
	runStage("rendering", process.execPath, ["web/design/scripts/render-checks.mjs"]),
	runStage("typecheck", "pnpm", ["run", "check:web"]),
]);

const failed = report([runtime, biome, ...phase2]);
console.log(failed ? "\ncheck failed." : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
