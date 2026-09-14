import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	deriveFamilyTarballs,
	runtimeFamilyDependencies,
	validateRuntimeManifest,
} from "../check-prime-agent-runtime.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const sampleManifest = {
	package: "prime-agent",
	version: "0.9.3",
	tarball: "https://pub-728493de92a943e2a9b2d17b4719f318.r2.dev/releases/v0.9.3/prime-agent-0.9.3.tgz",
	sha256: "ce71049389877770aa31b9be64c473685a86159adbbd2466bd43e4a9113242f1",
};

test("validateRuntimeManifest accepts the pinned runtime manifest", () => {
	validateRuntimeManifest(sampleManifest);
});

test("deriveFamilyTarballs derives core and ai release archives from the prime-agent tarball", () => {
	assert.deepEqual(deriveFamilyTarballs(sampleManifest), {
		prime: sampleManifest.tarball,
		core: "https://pub-728493de92a943e2a9b2d17b4719f318.r2.dev/releases/v0.9.3/prime-agent-core-0.9.3.tgz",
		ai: "https://pub-728493de92a943e2a9b2d17b4719f318.r2.dev/releases/v0.9.3/prime-agent-ai-0.9.3.tgz",
	});
});

test("runtimeFamilyDependencies covers prime-agent and pi-family pins", () => {
	assert.deepEqual(
		runtimeFamilyDependencies.map(({ dependency }) => dependency),
		["prime-agent", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"],
	);
});

test("validateRuntimeManifest rejects a mismatched prime-agent tarball version", () => {
	assert.throws(
		() =>
			validateRuntimeManifest({
				...sampleManifest,
				tarball: "https://example.invalid/releases/v0.9.3/prime-agent-0.9.2.tgz",
			}),
		/Runtime tarball must be a versioned prime-agent release archive/,
	);
});

test("repository manifests and lockfile pin the derived runtime-family tarballs", () => {
	const manifest = JSON.parse(readFileSync(resolve(root, "PRIME_AGENT_RUNTIME.json"), "utf8"));
	const familyTarballs = deriveFamilyTarballs(manifest);
	const manifestPaths = ["packages/fleet-web/package.json", "web/server/package.json"];

	for (const manifestPath of manifestPaths) {
		const packageJson = JSON.parse(readFileSync(resolve(root, manifestPath), "utf8"));
		for (const { dependency, tarballKey } of runtimeFamilyDependencies) {
			assert.equal(
				packageJson.dependencies?.[dependency],
				familyTarballs[tarballKey],
				`${manifestPath} ${dependency} drifted from PRIME_AGENT_RUNTIME.json`,
			);
		}
	}

	const pnpmLock = readFileSync(resolve(root, "pnpm-lock.yaml"), "utf8");
	for (const { lockPackage, tarballKey } of runtimeFamilyDependencies) {
		const expectedTarball = familyTarballs[tarballKey];
		assert.match(pnpmLock, new RegExp(`specifier: ${expectedTarball.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		assert.match(
			pnpmLock,
			new RegExp(`^  ${lockPackage}@${expectedTarball.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`, "m"),
		);
	}
});
