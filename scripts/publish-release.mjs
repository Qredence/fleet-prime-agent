#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertReleaseVersion, compareVersions, NPM_REGISTRY, parseStableVersion } from "./release-utils.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageManifestPath = join(root, "packages", "fleet-web", "package.json");
const packageName = "@qredence/fleet";
const publicBaseline = "0.5.0";

/**
 * Reads and validates the package manifest for the expected package and npm registry.
 * @return {object} The validated package manifest.
 * @throws {Error} If the package name or publish registry does not match the expected values.
 */
function readManifest() {
	const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
	if (manifest.name !== packageName) throw new Error(`Expected the public package to be ${packageName}`);
	if (manifest.publishConfig?.registry !== NPM_REGISTRY) {
		throw new Error(`Fleet must publish only to ${NPM_REGISTRY}`);
	}
	return manifest;
}

/**
 * Fetches package metadata from the npm registry.
 * @returns {object|undefined} The package metadata, or `undefined` if the package is not found.
 * @throws {Error} If the registry responds with an unsuccessful HTTP status other than 404.
 */
async function readRegistryMetadata({ fetchImpl = fetch }) {
	const response = await fetchImpl(`${NPM_REGISTRY}${encodeURIComponent(packageName)}`, {
		headers: { Accept: "application/json" },
	});
	if (response.status === 404) return undefined;
	if (!response.ok) throw new Error(`npm registry metadata lookup failed with HTTP ${response.status}`);
	return response.json();
}

/**
 * Retrieves metadata for a specific published package version.
 * @param {Function} fetchImpl - The function used to request registry metadata.
 * @param {string} version - The package version to retrieve.
 * @return {Object|undefined} The published version metadata, or `undefined` if the version is not published.
 */
async function readRegistryPackage({ fetchImpl = fetch, version }) {
	const metadata = await readRegistryMetadata({ fetchImpl });
	const published = metadata?.versions?.[version];
	return published ? { ...published, version: published.version ?? version } : undefined;
}

/**
 * Retrieves the version currently assigned to the npm `latest` dist-tag.
 * @param {Object} [options]
 * @param {Function} [options.fetchImpl=fetch] - Function used to request registry metadata.
 * @returns {Promise<string|undefined>} The version assigned to `latest`, or `undefined` when unavailable.
 */
async function readRegistryLatest({ fetchImpl = fetch }) {
	const metadata = await readRegistryMetadata({ fetchImpl });
	return metadata?.["dist-tags"]?.latest;
}

/**
 * Computes the SHA-256 checksum of a published package tarball.
 * @param {object} metadata - Published package metadata containing the tarball URL.
 * @return {Promise<string>} The tarball's SHA-256 checksum in hexadecimal format.
 */
export async function readRemoteChecksum({ fetchImpl = fetch, metadata }) {
	const tarballUrl = metadata?.dist?.tarball;
	if (!tarballUrl) throw new Error("Published npm metadata has no tarball URL");
	const response = await fetchImpl(tarballUrl);
	if (!response.ok) throw new Error(`Could not download published tarball: HTTP ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Verifies that registry metadata describes the expected package version.
 * @param {object|undefined} metadata - The registry metadata to verify.
 * @param {string} expectedVersion - The version that the metadata must describe.
 * @throws {Error} If the metadata version does not match the expected version.
 */
function assertPublishedMetadata(metadata, expectedVersion) {
	if (metadata?.version !== expectedVersion) {
		throw new Error(`Registry returned ${metadata?.version ?? "no version"} while checking ${expectedVersion}`);
	}
}

/**
 * Computes the SHA-256 checksum of a file.
 * @param {string} path - The path to the file.
 * @return {string} The checksum as a hexadecimal string.
 */
export function sha256(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Determines whether a package version should be published or its release resumed.
 * @param {Object} options - Release version and checksum metadata.
 * @param {string} options.packageVersion - Version being released.
 * @param {string} options.latestVersion - Latest version published to the registry.
 * @param {string} [options.publishedVersion] - Version currently published for the release.
 * @param {string} [options.localChecksum] - SHA-256 checksum of the local artifact.
 * @param {string} [options.publishedChecksum] - SHA-256 checksum of the published artifact.
 * @returns {"publish"|"resume"} `"resume"` if the matching version and checksum are already published, or `"publish"` if the version can be released.
 * @throws {Error} If the version is unstable, published metadata is inconsistent, checksums differ, or release sequencing is invalid.
 */
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

/**
 * Determines whether the current commit versions the package.
 * @param {string} [branch=process.env.CIRCLE_BRANCH] - The branch containing the commit.
 * @param {boolean} [forceRelease=process.env.FORCE_RELEASE === "1"] - Whether to approve the commit regardless of branch and changed files.
 * @param {Function} [readChangedPaths] - Function that returns the paths changed by the commit.
 * @returns {boolean} `true` if the commit is eligible for release, `false` otherwise.
 * @throws {Error} If the changed paths cannot be determined.
 */
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
		const hasManifest = changedPaths.includes("packages/fleet-web/package.json");
		const hasChangelog = changedPaths.includes("packages/fleet-web/CHANGELOG.md");
		const releaseFilesOnly = changedPaths.every(
			(path) =>
				path === "packages/fleet-web/package.json" ||
				path === "packages/fleet-web/CHANGELOG.md" ||
				(path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md"),
		);
		return hasManifest && hasChangelog && releaseFilesOnly;
	} catch (error) {
		throw new Error(`Could not determine whether this commit versions the package: ${error.message}`);
	}
}

/**
 * Writes the artifact's SHA-256 checksum to a `SHA256SUMS` file in the same directory.
 * @param {string} artifact - Path to the artifact whose checksum is recorded.
 * @return {string} The path to the generated checksum file.
 */
function writeChecksumFile(artifact) {
	const checksumPath = join(dirname(artifact), "SHA256SUMS");
	writeFileSync(checksumPath, `${sha256(artifact)}  ${basename(artifact)}\n`, "utf8");
	return checksumPath;
}

/**
 * Obtains an npm OIDC token from the environment or CircleCI.
 * @return {string} The npm OIDC token.
 */
function getOidcToken() {
	if (process.env.NPM_ID_TOKEN) return process.env.NPM_ID_TOKEN;
	return execFileSync("circleci", ["run", "oidc", "get", "--claims", '{"aud": "npm:registry.npmjs.org"}'], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}).trim();
}

/**
 * Publishes a release artifact to npm with public access.
 * @param {string} artifact - The path to the package artifact.
 */
function publishToNpm(artifact) {
	const token = getOidcToken();
	if (!token) throw new Error("CircleCI did not return an npm OIDC token");
	execFileSync("npm", ["publish", artifact, "--access", "public"], {
		cwd: root,
		stdio: "inherit",
		env: { ...process.env, NPM_ID_TOKEN: token },
	});
}

/**
 * Wait for a published package version to become available in the npm registry.
 * @param {string} version - The package version to locate.
 * @returns {object} The published package metadata.
 * @throws {Error} If the version is not available within 30 seconds.
 */
export async function waitForPublishedVersion({ fetchImpl = fetch, version, sleepImpl } = {}) {
	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		const metadata = await readRegistryPackage({ fetchImpl, version });
		if (metadata) return metadata;
		await (
			sleepImpl ?? ((milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)))
		)(2000);
	}
	throw new Error(`npm did not expose ${packageName}@${version} within 30 seconds of publishing`);
}

/**
 * Publishes the package artifact to npm and creates its GitHub release.
 * @param {Object} options - Release configuration and dependency overrides.
 * @param {Object} [options.manifest] - Package manifest containing the release name and version.
 * @param {string} [options.artifact] - Path to the release artifact.
 * @returns {Promise<Object>} Publication status, including whether the release was published or skipped and, when published, its version.
 */
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
	const artifactPath = resolve(artifact ?? join(root, "dist-release", `qredence-fleet-${manifest.version}.tgz`));
	if (!existsSync(artifactPath)) throw new Error(`Release artifact not found: ${artifactPath}`);
	const localChecksum = sha256(artifactPath);
	const published = await readRegistryPackage({
		fetchImpl,
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
		const latestVersion = await readRegistryLatest({ fetchImpl });
		releaseDecision({ packageVersion: manifest.version, latestVersion, localChecksum });
		writeChecksumFileImpl(artifactPath);
		publishToNpmImpl(artifactPath);
		metadata = await waitForPublishedVersionImpl({
			fetchImpl,
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
