#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, "PRIME_AGENT_RUNTIME.json"), "utf8"));

if (manifest.package !== "prime-agent") throw new Error("Runtime package must be prime-agent");
if (!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*$/.test(manifest.version)) {
	throw new Error(`Invalid Prime Agent runtime version: ${manifest.version}`);
}
if (
	typeof manifest.tarball !== "string" ||
	!new URL(manifest.tarball).pathname.endsWith(`/prime-agent-${manifest.version}.tgz`)
) {
	throw new Error("Runtime tarball must be a versioned prime-agent release archive");
}
if (typeof manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
	throw new Error("Runtime sha256 must be a lowercase SHA-256 digest");
}

console.log(`Pinned Prime Agent runtime: ${manifest.package}@${manifest.version}`);
