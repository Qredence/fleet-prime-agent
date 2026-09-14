#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function validateRuntimeManifest(manifest) {
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
}

export function deriveFamilyTarballs(manifest) {
	const expectedPrimeTarball = manifest.tarball;
	const releaseBase = expectedPrimeTarball.slice(0, -`/prime-agent-${manifest.version}.tgz`.length);
	return {
		prime: expectedPrimeTarball,
		core: `${releaseBase}/prime-agent-core-${manifest.version}.tgz`,
		ai: `${releaseBase}/prime-agent-ai-${manifest.version}.tgz`,
	};
}

export const runtimeFamilyDependencies = [
	{ dependency: "prime-agent", lockPackage: "prime-agent", tarballKey: "prime" },
	{
		dependency: "@earendil-works/pi-agent-core",
		lockPackage: "prime-agent-core",
		tarballKey: "core",
	},
	{ dependency: "@earendil-works/pi-ai", lockPackage: "prime-agent-ai", tarballKey: "ai" },
];

function readJson(relativePath) {
	return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
}

function assertPackagePins(packageJson, familyTarballs, label) {
	for (const { dependency, tarballKey } of runtimeFamilyDependencies) {
		const expectedTarball = familyTarballs[tarballKey];
		if (packageJson.dependencies?.[dependency] !== expectedTarball) {
			throw new Error(`${label} ${dependency} pin does not match the runtime manifest tarball`);
		}
	}
}

function assertLockfilePins(pnpmLock, familyTarballs) {
	for (const { lockPackage, tarballKey } of runtimeFamilyDependencies) {
		const expectedTarball = familyTarballs[tarballKey];
		if (!pnpmLock.includes(`specifier: ${expectedTarball}`)) {
			throw new Error(`pnpm-lock.yaml ${lockPackage} specifier does not match the runtime manifest tarball`);
		}
		const escapedTarball = expectedTarball.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const lockEntry = pnpmLock.match(new RegExp(`^  ${lockPackage}@${escapedTarball}:((?:\\n    .*)*)`, "m"));
		if (!lockEntry) {
			throw new Error(`pnpm-lock.yaml is missing the pinned ${lockPackage} resolution entry`);
		}
	}
}

async function verifyTarball(manifest, familyTarballs, pnpmLock) {
	const expectedTarball = familyTarballs.prime;
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
	const escapedTarball = expectedTarball.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const lockEntry = pnpmLock.match(new RegExp(`^  prime-agent@${escapedTarball}:((?:\\n    .*)*)`, "m"));
	const lockIntegrity = lockEntry?.[1].match(/integrity: (sha512-[A-Za-z0-9+/=]+)/)?.[1];
	if (lockIntegrity && lockIntegrity !== sha512) {
		throw new Error("Downloaded runtime tarball sha512 does not match pnpm-lock.yaml integrity");
	}
	console.log("Runtime tarball hash verification passed");
}

export async function checkPrimeAgentRuntime(options = {}) {
	const manifest = options.manifest ?? JSON.parse(readFileSync(resolve(root, "PRIME_AGENT_RUNTIME.json"), "utf8"));
	validateRuntimeManifest(manifest);
	const familyTarballs = deriveFamilyTarballs(manifest);

	assertPackagePins(readJson("packages/fleet-web/package.json"), familyTarballs, "packages/fleet-web/package.json");
	assertPackagePins(readJson("web/server/package.json"), familyTarballs, "web/server/package.json");

	const pnpmLock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
	assertLockfilePins(pnpmLock, familyTarballs);

	if (options.verifyTarball ?? process.env.PRIME_RUNTIME_VERIFY_TARBALL === "1") {
		await verifyTarball(manifest, familyTarballs, pnpmLock);
	}

	console.log(`Pinned Prime Agent runtime: ${manifest.package}@${manifest.version}`);
	console.log("Runtime manifest cross-checks passed");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await checkPrimeAgentRuntime();
}
