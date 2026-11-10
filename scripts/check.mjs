#!/usr/bin/env node

// Quality-gate orchestrator. Replaces the sequential `pnpm run check` chain.
//
// Phase 1 (sequential, fast): the runtime manifest check fails fast before any
// other work, then Oxfmt and Oxlint check the repository. Formatting is
// read-only by default; pass --write only from the explicit developer
// formatting command.
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

// Spawn the package bin Node wrappers instead of the extensionless .bin shims:
// the wrappers resolve the platform binary (including the win32 .exe) and
// process.execPath works on every OS.
const oxfmtBin = resolve(root, "node_modules/oxfmt/bin/oxfmt");
const oxlintBin = resolve(root, "node_modules/oxlint/bin/oxlint");
// Oxfmt expands these globs. Oxlint does not, so lint uses directories instead.
const formatPaths = [
	"packages/fleet-web/bin/**/*.mjs",
	"web/*/src/**/*.ts",
	"web/*/src/**/*.tsx",
	"web/server/scripts/**/*.ts",
	"scripts/**/*.mjs",
	"scripts/**/*.ts",
];
const lintPaths = [
	"packages/fleet-web/bin",
	"web/app/src",
	"web/protocol/src",
	"web/server/src",
	"web/server/scripts",
	"scripts",
];

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

const format = await runStage(
	"format",
	process.execPath,
	write ? [oxfmtBin, ...formatPaths] : [oxfmtBin, "--check", ...formatPaths],
);
if (format.code !== 0) {
	report([runtime, format]);
	console.error("\ncheck:format failed; skipping remaining stages.");
	process.exit(1);
}

const lint = await runStage("lint", process.execPath, [
	oxlintBin,
	...(write ? ["--fix"] : []),
	"--deny-warnings",
	...lintPaths,
]);
if (lint.code !== 0) {
	report([runtime, format, lint]);
	console.error("\ncheck:lint failed; skipping remaining stages.");
	process.exit(1);
}

const pnpmTypecheck = pnpmInvocation(["run", "check:web"]);
const phase2 = await Promise.all([
	runStage("boundaries", process.execPath, ["scripts/check-web-boundaries.mjs"]),
	// Resolves the real browser import graph. The boundary check only scans
	// specifiers in web/app source; this catches transitive and unresolvable
	// browser imports that a static scan cannot see.
	runStage("browser-smoke", process.execPath, ["scripts/check-browser-smoke.mjs"]),
	runStage("installer", process.execPath, ["scripts/check-source-installer.mjs", "--static"]),
	runStage("rendering", process.execPath, ["web/app/scripts/render-checks.mjs"]),
	runStage("typecheck", pnpmTypecheck.command, pnpmTypecheck.args),
]);

const failed = report([runtime, format, lint, ...phase2]);
console.log(failed ? "\ncheck failed." : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
