#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertReleaseVersion, compareVersions, parseStableVersion, registryPackageUrl } from "./release-utils.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageManifestPath = join(root, "packages", "fleet-prime", "package.json");
const publicBaseline = "0.5.0";

function readManifest() {
	return JSON.parse(readFileSync(packageManifestPath, "utf8"));
}

async function readRegistryPackage({ fetchImpl = fetch, registry, packageName, version }) {
	const response = await fetchImpl(registryPackageUrl(registry, packageName, version), {
		headers: { Accept: "application/json" },
	});
	if (response.status === 404) return undefined;
	if (!response.ok) throw new Error(`npm registry lookup failed with HTTP ${response.status}`);
	return response.json();
}

async function readRegistryLatest({ fetchImpl = fetch, registry, packageName }) {
	const response = await fetchImpl(`${registry.replace(/\/$/, "")}/${encodeURIComponent(packageName)}`, {
		headers: { Accept: "application/json" },
	});
	if (response.status === 404) return undefined;
	if (!response.ok) throw new Error(`npm registry latest lookup failed with HTTP ${response.status}`);
	const metadata = await response.json();
	return metadata["dist-tags"]?.latest;
}

export async function readRemoteChecksum({ fetchImpl = fetch, metadata }) {
	const tarballUrl = metadata?.dist?.tarball;
	if (!tarballUrl) throw new Error("Published npm metadata has no tarball URL");
	const response = await fetchImpl(tarballUrl);
	if (!response.ok) throw new Error(`Could not download published tarball: HTTP ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	return createHash("sha256").update(bytes).digest("hex");
}

function assertPublishedMetadata(metadata, expectedVersion) {
	if (metadata?.version !== expectedVersion) {
		throw new Error(`Registry returned ${metadata?.version ?? "no version"} while checking ${expectedVersion}`);
	}
}

export function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function releaseDecision({ packageVersion, latestVersion, publishedVersion, localChecksum, publishedChecksum }) {
	parseStableVersion(packageVersion);
	if (publishedVersion) {
		if (publishedVersion !== packageVersion) {
			throw new Error(`Registry returned ${publishedVersion} while checking ${packageVersion}`);
		}
		if (localChecksum !== publishedChecksum) {
			throw new Error(
				`${packageVersion} is already published with a different tarball checksum; refusing to republish an immutable version.`,
			);
		}
		return "resume";
	}
	assertReleaseVersion({ packageName: "@qredence/fleet", packageVersion, publishedLatest: latestVersion });
	return "publish";
}

export function isPackageVersionCommit({
	branch = process.env.CIRCLE_BRANCH,
	forceRelease = process.env.FORCE_RELEASE === "1",
	readChangedPaths,
} = {}) {
	if (forceRelease) return true;
	if (branch && branch !== "main") return false;
	try {
		const changedPaths =
			readChangedPaths?.() ??
			(() => {
				const parent = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8" }).trim();
				return execFileSync("git", ["diff", "--name-only", parent, "HEAD", "--"], { cwd: root, encoding: "utf8" })
					.trim()
					.split("\n")
					.filter(Boolean);
			})();
		const hasManifest = changedPaths.includes("packages/fleet-prime/package.json");
		const hasChangelog = changedPaths.includes("packages/fleet-prime/CHANGELOG.md");
		const releaseFilesOnly = changedPaths.every(
			(path) =>
				path === "packages/fleet-prime/package.json" ||
				path === "packages/fleet-prime/CHANGELOG.md" ||
				(path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md"),
		);
		return hasManifest && hasChangelog && releaseFilesOnly;
	} catch (error) {
		throw new Error(`Could not determine whether this commit versions the package: ${error.message}`);
	}
}

function writeChecksumFile(artifact) {
	const checksumPath = join(dirname(artifact), "SHA256SUMS");
	writeFileSync(checksumPath, `${sha256(artifact)}  ${basename(artifact)}\n`, "utf8");
	return checksumPath;
}

function getOidcToken() {
	if (process.env.NPM_ID_TOKEN) return process.env.NPM_ID_TOKEN;
	return execFileSync("circleci", ["run", "oidc", "get", "--claims", '{"aud": "npm:registry.npmjs.org"}'], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}).trim();
}

function publishToNpm(artifact) {
	const token = getOidcToken();
	if (!token) throw new Error("CircleCI did not return an npm OIDC token");
	execFileSync("npm", ["publish", artifact, "--access", "public"], {
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, NPM_ID_TOKEN: token },
	});
}

export async function waitForPublishedVersion({ fetchImpl = fetch, registry, packageName, version, sleepImpl } = {}) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const metadata = await readRegistryPackage({ fetchImpl, registry, packageName, version });
		if (metadata) return metadata;
		await (
			sleepImpl ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)))
		)(2000);
	}
	throw new Error(`npm did not expose ${packageName}@${version} within 30 seconds of publishing`);
}

export async function publishRelease({
	fetchImpl = fetch,
	manifest = readManifest(),
	artifact,
	isPackageVersionCommitImpl = isPackageVersionCommit,
	readRemoteChecksumImpl = readRemoteChecksum,
	waitForPublishedVersionImpl = waitForPublishedVersion,
	writeChecksumFileImpl = writeChecksumFile,
	publishToNpmImpl = publishToNpm,
	publishGithubReleaseImpl = (environment) =>
		execFileSync(process.execPath, [join(root, "scripts", "publish-github-release.mjs")], {
			cwd: root,
			stdio: "inherit",
			env: environment,
		}),
} = {}) {
	if (!isPackageVersionCommitImpl()) {
		console.log("This commit does not version @qredence/fleet; release publication is a no-op.");
		return { published: false, skipped: true };
	}
	if (compareVersions(manifest.version, publicBaseline) <= 0) {
		console.log(`Skipping historical public baseline ${manifest.version}; no new release is required.`);
		return { published: false, skipped: true };
	}
	const registry = manifest.publishConfig?.registry ?? "https://registry.npmjs.org";
	const artifactPath = resolve(artifact ?? join(root, "dist-release", `qredence-fleet-${manifest.version}.tgz`));
	if (!existsSync(artifactPath)) throw new Error(`Release artifact not found: ${artifactPath}`);
	const localChecksum = sha256(artifactPath);
	const published = await readRegistryPackage({
		fetchImpl,
		registry,
		packageName: manifest.name,
		version: manifest.version,
	});
	let metadata;
	if (published) {
		assertPublishedMetadata(published, manifest.version);
		const publishedChecksum = await readRemoteChecksumImpl({ fetchImpl, metadata: published });
		const decision = releaseDecision({
			packageVersion: manifest.version,
			publishedVersion: published.version,
			localChecksum,
			publishedChecksum,
		});
		console.log(
			`${manifest.name}@${manifest.version} is already published; verified the immutable tarball and resuming release assets.`,
		);
		metadata = published;
		if (decision !== "resume") throw new Error(`Unexpected release decision: ${decision}`);
	} else {
		const latestVersion = await readRegistryLatest({ fetchImpl, registry, packageName: manifest.name });
		releaseDecision({ packageVersion: manifest.version, latestVersion, localChecksum });
		writeChecksumFileImpl(artifactPath);
		publishToNpmImpl(artifactPath);
		metadata = await waitForPublishedVersionImpl({
			fetchImpl,
			registry,
			packageName: manifest.name,
			version: manifest.version,
		});
		assertPublishedMetadata(metadata, manifest.version);
		const publishedChecksum = await readRemoteChecksumImpl({ fetchImpl, metadata });
		if (publishedChecksum !== localChecksum)
			throw new Error("Published npm tarball checksum does not match the verified CI artifact");
	}

	const checksumPath = writeChecksumFileImpl(artifactPath);
	const environment = {
		...process.env,
		RELEASE_VERSION: manifest.version,
		RELEASE_ARTIFACT: artifactPath,
		RELEASE_CHECKSUMS: checksumPath,
	};
	await publishGithubReleaseImpl(environment);
	return { published: !published, skipped: false, version: metadata.version };
}

async function main() {
	await publishRelease();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
