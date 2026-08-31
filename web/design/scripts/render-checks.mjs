#!/usr/bin/env node

// Runs the independent web-design render/contract checks concurrently instead
// of the previous sequential &&-chain. Group-internal orderings that matter
// (openui contract before render, component contract before fixtures) stay
// inside their group scripts.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const designRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Script text stays the single source of truth in package.json; spawning it
// through sh with the package .bin on PATH skips the per-group pnpm wrapper
// process without duplicating command definitions here.
const pkg = JSON.parse(readFileSync(join(designRoot, "package.json"), "utf8"));
const env = {
	...process.env,
	PATH: `${join(designRoot, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
};

function runCheck(label, scriptName) {
	const command = pkg.scripts?.[scriptName];
	if (typeof command !== "string") {
		return Promise.resolve({ label, code: 1, output: `missing script ${scriptName}\n` });
	}
	return new Promise((resolvePromise) => {
		const child = spawn("sh", ["-c", command], {
			cwd: designRoot,
			env,
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

const groups = [
	["message-identities", "check:message-identities"],
	["openui-contract", "check:openui-contract"],
	["openui-render", "check:openui-render"],
	["components", "check:components"],
	["agent-plan-contract", "check:agent-plan-contract"],
	["registries", "check:registries"],
];

const results = await Promise.all(
	groups.map(([label, scriptName]) => runCheck(label, scriptName)),
);

let failed = false;
for (const { label, code, output } of results) {
	const status = code === 0 ? "PASS" : "FAIL";
	if (code !== 0) failed = true;
	console.log(`\n===== check:${label} [${status}] =====`);
	if (output.trim().length > 0) {
		process.stdout.write(output);
	}
}

console.log(failed ? "\nrender checks failed." : "\nAll render checks passed.");
process.exit(failed ? 1 : 0);
