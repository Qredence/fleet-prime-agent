import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertAllowedPath } from "../check-package.mjs";
import { pnpmInvocation } from "../pnpm-command.mjs";
import {
	createVersionPullRequest,
	prepareRelease,
	releasePlanFromStatus,
	releaseVersionFromStatus,
	run as runPrepareRelease,
} from "../prepare-release.mjs";
import {
	isPackageVersionCommit,
	publishRelease,
	readRemoteChecksum,
	releaseDecision,
	sha256,
	waitForPublishedVersion,
} from "../publish-release.mjs";
import { assertReleaseVersion, compareVersions, parseStableVersion } from "../release-utils.mjs";

const packageManifest = JSON.parse(
	readFileSync(new URL("../../packages/fleet-web/package.json", import.meta.url), "utf8"),
);
const packageVersion = packageManifest.version;
const [packageMajor, packageMinor, packagePatch] = parseStableVersion(packageVersion);
const nextPatchVersion = `${packageMajor}.${packageMinor}.${packagePatch + 1}`;

function releaseStatus() {
	return { releases: [{ name: "@qredence/fleet", oldVersion: packageVersion, newVersion: nextPatchVersion }] };
}

function response(status, payload = undefined) {
	const body = payload instanceof Uint8Array ? Buffer.from(payload) : payload;
	return {
		status,
		ok: status >= 200 && status < 300,
		async json() {
			if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
			return JSON.parse(Buffer.from(body ?? "").toString("utf8"));
		},
		async arrayBuffer() {
			return Buffer.from(body ?? "");
		},
	};
}

test("compares stable versions numerically", () => {
	assert.equal(compareVersions("0.5.10", "0.5.2"), 1);
	assert.equal(compareVersions("0.5.1", "0.5.1"), 0);
	assert.deepEqual(parseStableVersion("0.5.1"), [0, 5, 1]);
});

test("uses CircleCI's pinned pnpm launcher for child processes", () => {
	const previous = process.env.FLEET_PNPM_BIN;
	process.env.FLEET_PNPM_BIN = "/tmp/fleet-pnpm/bin/pnpm.cjs";
	try {
		assert.deepEqual(pnpmInvocation(["run", "check"]), {
			command: process.execPath,
			args: ["/tmp/fleet-pnpm/bin/pnpm.cjs", "run", "check"],
		});
	} finally {
		if (previous === undefined) delete process.env.FLEET_PNPM_BIN;
		else process.env.FLEET_PNPM_BIN = previous;
	}
});

test("rejects a release that is not newer than npm latest", () => {
	assert.throws(
		() => assertReleaseVersion({ packageName: "@qredence/fleet", packageVersion: "0.5.1", publishedLatest: "0.5.1" }),
		/not newer/,
	);
});

test("publishes a new version and resumes an identical already-published version", () => {
	assert.equal(
		releaseDecision({ packageVersion: "0.5.1", latestVersion: "0.5.0", localChecksum: "local" }),
		"publish",
	);
	assert.equal(
		releaseDecision({
			packageVersion: "0.5.1",
			latestVersion: "0.5.1",
			publishedVersion: "0.5.1",
			localChecksum: "same",
			publishedChecksum: "same",
		}),
		"resume",
	);
	assert.throws(
		() =>
			releaseDecision({
				packageVersion: "0.5.1",
				latestVersion: "0.5.1",
				publishedVersion: "0.5.1",
				localChecksum: "local",
				publishedChecksum: "different",
			}),
		/immutable version/,
	);
});

test("detects only package-version commits on main", () => {
	assert.equal(
		isPackageVersionCommit({
			branch: "main",
			readChangedPaths: () => [
				"packages/fleet-web/package.json",
				"packages/fleet-web/CHANGELOG.md",
				".changeset/release.md",
			],
		}),
		true,
	);
	assert.equal(
		isPackageVersionCommit({
			branch: "main",
			readChangedPaths: () => ["packages/fleet-web/package.json", "README.md"],
		}),
		false,
	);
	assert.equal(
		isPackageVersionCommit({
			branch: "feature/release",
			readChangedPaths: () => ["packages/fleet-web/package.json"],
		}),
		false,
	);
	assert.equal(isPackageVersionCommit({ branch: "feature/release", forceRelease: true }), true);
});

test("enforces the packed artifact allowlist", () => {
	assert.doesNotThrow(() => assertAllowedPath("bin/fleet-prime.mjs"));
	assert.doesNotThrow(() => assertAllowedPath("dist/web/server/server.js"));
	assert.throws(() => assertAllowedPath("src/server.ts"), /Unexpected file/);
	assert.throws(() => assertAllowedPath("dist/test/fixture.js"), /Development file/);
	assert.throws(() => assertAllowedPath("dist/client/app.js.map"), /Development file/);
});

test("reuses an existing release pull request without versioning again", async () => {
	const calls = [];
	const result = await createVersionPullRequest("token", "0.5.1", "base-sha", {
		githubRequestImpl: async (path) => {
			calls.push(path);
			return [{ html_url: "https://github.com/Qredence/fleet-prime-agent/pull/1" }];
		},
	});
	assert.equal(result, undefined);
	assert.deepEqual(calls, [
		"/repos/Qredence/fleet-prime-agent/pulls?state=open&head=Qredence%3Arelease%2Ffleet-v0.5.1&per_page=1",
	]);
});

test("does not create a second release pull request while another is open", async () => {
	const calls = [];
	const result = await createVersionPullRequest("token", "0.5.2", "base-sha", {
		githubRequestImpl: async (path) => {
			calls.push(path);
			if (path.includes("head=")) return [];
			return [
				{
					html_url: "https://github.com/Qredence/fleet-prime-agent/pull/1",
					head: {
						ref: "release/fleet-v0.5.1",
						repo: { full_name: "Qredence/fleet-prime-agent" },
					},
				},
			];
		},
		githubRequestAllow404Impl: async () => {
			throw new Error("branch lookup should not run while another release PR is open");
		},
	});
	assert.equal(result, undefined);
	assert.deepEqual(calls, [
		"/repos/Qredence/fleet-prime-agent/pulls?state=open&head=Qredence%3Arelease%2Ffleet-v0.5.2&per_page=1",
		"/repos/Qredence/fleet-prime-agent/pulls?state=open&base=main&per_page=100",
	]);
});

test("dry-runs release preparation without requiring GitHub credentials", async () => {
	const previousBranch = process.env.CIRCLE_BRANCH;
	process.env.CIRCLE_BRANCH = "main";
	try {
		const result = await prepareRelease({
			baseSha: "base-sha",
			status: releaseStatus(),
			dryRun: true,
		});
		assert.deepEqual(result, {
			prepared: false,
			dryRun: true,
			plan: { packageName: "@qredence/fleet", currentVersion: packageVersion, version: nextPatchVersion },
		});
	} finally {
		if (previousBranch === undefined) delete process.env.CIRCLE_BRANCH;
		else process.env.CIRCLE_BRANCH = previousBranch;
	}
});

test("treats no pending Changesets as a release-preparation no-op", async () => {
	const result = await prepareRelease({ status: null, branch: "main" });
	assert.deepEqual(result, { prepared: false });
});

test("prints no version for an empty release plan and the next version for a patch plan", async () => {
	const noVersionOutput = [];
	await runPrepareRelease(["--print-version"], {
		readStatus: () => undefined,
		log: (message) => noVersionOutput.push(message),
	});
	assert.deepEqual(noVersionOutput, []);

	const versionOutput = [];
	await runPrepareRelease(["--print-version"], {
		readStatus: releaseStatus,
		log: (message) => versionOutput.push(message),
	});
	assert.deepEqual(versionOutput, [nextPatchVersion]);
	assert.equal(releaseVersionFromStatus(undefined), undefined);
	assert.equal(releaseVersionFromStatus(releaseStatus()), nextPatchVersion);
});

test("requires CircleCI to provide the release version before creating a release PR", async () => {
	const previousVersion = process.env.FLEET_RELEASE_VERSION;
	delete process.env.FLEET_RELEASE_VERSION;
	try {
		await assert.rejects(
			prepareRelease({
				token: "token",
				baseSha: "base-sha",
				branch: "main",
				status: releaseStatus(),
			}),
			/FLEET_RELEASE_VERSION is required/,
		);
	} finally {
		if (previousVersion === undefined) delete process.env.FLEET_RELEASE_VERSION;
		else process.env.FLEET_RELEASE_VERSION = previousVersion;
	}
});

test("rejects release preparation from a non-main branch", async () => {
	await assert.rejects(
		prepareRelease({
			baseSha: "base-sha",
			branch: "feature/release",
			status: releaseStatus(),
			dryRun: true,
		}),
		/must run on main, found feature\/release/,
	);
});

test("verifies a registry tarball with an injected fetch implementation", async () => {
	const bytes = Buffer.from("published tarball");
	const calls = [];
	const checksum = await readRemoteChecksum({
		metadata: { dist: { tarball: "https://registry.example.test/fleet.tgz" } },
		fetchImpl: async (url) => {
			calls.push(url);
			return response(200, bytes);
		},
	});
	assert.equal(checksum, "1d7164eca77a618c053944fada94250e17034176840053af8b02962792abd89a");
	assert.deepEqual(calls, ["https://registry.example.test/fleet.tgz"]);
});

test("waits for registry visibility with deterministic polling", async () => {
	let calls = 0;
	const metadata = { version: "0.5.1", dist: { tarball: "https://registry.example.test/fleet.tgz" } };
	const result = await waitForPublishedVersion({
		version: "0.5.1",
		fetchImpl: async () => {
			calls += 1;
			return calls === 1 ? response(404) : response(200, { versions: { "0.5.1": metadata } });
		},
		sleepImpl: async () => {},
	});
	assert.deepEqual(result, metadata);
	assert.equal(calls, 2);
});

test("publishes a new version once and verifies the post-publish tarball", async () => {
	const directory = mkdtempSync(join(tmpdir(), "fleet-release-test-"));
	const artifact = join(directory, "qredence-fleet-0.5.1.tgz");
	const bytes = Buffer.from("verified release artifact");
	writeFileSync(artifact, bytes);
	let versionLookups = 0;
	let npmPublishes = 0;
	let githubReleaseEnvironment;
	const publishedMetadata = { version: "0.5.1", dist: { tarball: "https://registry.example.test/fleet.tgz" } };
	try {
		const result = await publishRelease({
			manifest: {
				name: "@qredence/fleet",
				version: "0.5.1",
				publishConfig: { registry: "https://registry.example.test" },
			},
			artifact,
			isPackageVersionCommitImpl: () => true,
			fetchImpl: async (url) => {
				if (url === "https://registry.npmjs.org/%40qredence%2Ffleet") {
					versionLookups += 1;
					return versionLookups < 3
						? response(200, { "dist-tags": { latest: "0.5.0" }, versions: {} })
						: response(200, { "dist-tags": { latest: "0.5.0" }, versions: { "0.5.1": publishedMetadata } });
				}
				if (url === publishedMetadata.dist.tarball) return response(200, bytes);
				throw new Error(`Unexpected registry request: ${url}`);
			},
			publishToNpmImpl: () => {
				npmPublishes += 1;
			},
			publishGithubReleaseImpl: (environment) => {
				githubReleaseEnvironment = environment;
			},
			waitForPublishedVersionImpl: async ({ fetchImpl, version }) =>
				waitForPublishedVersion({ fetchImpl, version, sleepImpl: async () => {} }),
		});
		assert.deepEqual(result, { published: true, skipped: false, version: "0.5.1" });
		assert.equal(npmPublishes, 1);
		assert.equal(
			readFileSync(githubReleaseEnvironment.RELEASE_CHECKSUMS, "utf8"),
			`${sha256(artifact)}  qredence-fleet-0.5.1.tgz\n`,
		);
		assert.equal(githubReleaseEnvironment.RELEASE_VERSION, "0.5.1");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("resumes an already-published version without a second npm publish", async () => {
	const directory = mkdtempSync(join(tmpdir(), "fleet-release-resume-test-"));
	const artifact = join(directory, "qredence-fleet-0.5.1.tgz");
	const bytes = Buffer.from("verified release artifact");
	writeFileSync(artifact, bytes);
	const publishedMetadata = { version: "0.5.1", dist: { tarball: "https://registry.example.test/fleet.tgz" } };
	let githubReleaseCalls = 0;
	try {
		const result = await publishRelease({
			manifest: {
				name: "@qredence/fleet",
				version: "0.5.1",
				publishConfig: { registry: "https://registry.example.test" },
			},
			artifact,
			isPackageVersionCommitImpl: () => true,
			fetchImpl: async (url) => {
				if (url === "https://registry.npmjs.org/%40qredence%2Ffleet")
					return response(200, { "dist-tags": { latest: "0.5.1" }, versions: { "0.5.1": publishedMetadata } });
				if (url === publishedMetadata.dist.tarball) return response(200, bytes);
				throw new Error(`Unexpected registry request: ${url}`);
			},
			publishToNpmImpl: () => {
				throw new Error("immutable version was republished");
			},
			publishGithubReleaseImpl: () => {
				githubReleaseCalls += 1;
			},
		});
		assert.deepEqual(result, { published: false, skipped: false, version: "0.5.1" });
		assert.equal(githubReleaseCalls, 1);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("derives the single-package release plan from Changesets status", () => {
	assert.deepEqual(releasePlanFromStatus(releaseStatus()), {
		packageName: "@qredence/fleet",
		currentVersion: packageVersion,
		version: nextPatchVersion,
	});
	assert.throws(() => releasePlanFromStatus({ releases: [] }), /no release plan/);
});
