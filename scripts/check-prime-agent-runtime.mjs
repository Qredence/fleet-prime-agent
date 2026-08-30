#!/usr/bin/env node

import { createHash } from "node:crypto";
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

function readJson(relativePath) {
	return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

const expectedTarball = manifest.tarball;

const fleetPrimePackage = readJson("packages/fleet-prime/package.json");
if (fleetPrimePackage.dependencies?.["prime-agent"] !== expectedTarball) {
	throw new Error("packages/fleet-prime/package.json prime-agent pin does not match the runtime manifest tarball");
}

const webServerPackage = readJson("web/server/package.json");
if (webServerPackage.dependencies?.["prime-agent"] !== expectedTarball) {
	throw new Error("web/server/package.json prime-agent pin does not match the runtime manifest tarball");
}

const pnpmLock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
if (!pnpmLock.includes(`specifier: ${expectedTarball}`)) {
	throw new Error("pnpm-lock.yaml prime-agent specifier does not match the runtime manifest tarball");
}
if (!pnpmLock.includes(`prime-agent@${expectedTarball}`)) {
	throw new Error("pnpm-lock.yaml prime-agent resolution does not match the runtime manifest tarball");
}

function lockEntryIntegrity(pnpmLock, tarball) {
	const escapedTarball = tarball.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const entry = pnpmLock.match(new RegExp(`^  prime-agent@${escapedTarball}:((?:\\n    .*)*)`, "m"));
	const integrity = entry?.[1]?.match(/integrity: (sha512-[A-Za-z0-9+/=]+)/);
	return integrity?.[1];
}

if (process.env.PRIME_RUNTIME_VERIFY_TARBALL === "1") {
	const response = await fetch(expectedTarball);
	if (!response.ok) {
		throw new Error(`Unable to download runtime tarball for verification: HTTP ${response.status}`);
	}
	const tarball = Buffer.from(await response.arrayBuffer());
	const sha256 = createHash("sha256").update(tarball).digest("hex");
	if (sha256 !== manifest.sha256) {
		throw new Error("Downloaded runtime tarball sha256 does not match the runtime manifest");
	}
	const sha512 = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
	const lockIntegrity = lockEntryIntegrity(pnpmLock, expectedTarball);
	if (lockIntegrity && lockIntegrity !== sha512) {
		throw new Error("Downloaded runtime tarball sha512 does not match pnpm-lock.yaml integrity");
	}
	console.log("Runtime tarball hash verification passed");
}

console.log(`Pinned Prime Agent runtime: ${manifest.package}@${manifest.version}`);
console.log("Runtime manifest cross-checks passed");
