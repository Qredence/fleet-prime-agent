#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pnpmInvocation } from "./pnpm-command.mjs";
import { parseStableVersion, RELEASE_REPOSITORY } from "./release-utils.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageManifestPath = join(root, "packages", "fleet-web", "package.json");
const packageName = "@qredence/fleet";
const baseBranch = "main";
const oneTimeReleaseOverride = Object.freeze({
	fromVersion: "0.5.1",
	targetVersion: "0.5.5",
});

/**
 * Parses release preparation command-line options.
 * @param {string[]} argv - Command-line arguments to parse.
 * @returns {{dryRun: boolean, printVersion: boolean}} The parsed options.
 * @throws {Error} If an unknown option is provided.
 */
function parseArgs(argv) {
	let dryRun = false;
	let printVersion = false;
	for (const argument of argv) {
		if (argument === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (argument === "--print-version") {
			printVersion = true;
			continue;
		}
		if (argument === "--help" || argument === "-h") {
			console.log("Usage: node scripts/prepare-release.mjs [--dry-run|--print-version]");
			process.exit(0);
		}
		throw new Error(`Unknown option: ${argument}`);
	}
	return { dryRun, printVersion };
}

/**
 * Sends an authenticated request to the GitHub API.
 * @param {string} path - The GitHub API path.
 * @param {RequestInit} [options] - Additional request options.
 * @return {Promise<unknown>} The parsed response body, or `undefined` when the response has no body.
 * @throws {Error} If the GitHub API returns an unsuccessful response.
 */
async function githubRequest(path, token, options = {}) {
	const response = await fetch(`https://api.github.com${path}`, {
		...options,
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
			...(options.headers ?? {}),
		},
	});
	const body = await response.text();
	if (!response.ok) throw new Error(`GitHub API ${path} -> HTTP ${response.status}: ${body}`);
	return body ? JSON.parse(body) : undefined;
}

/**
 * Sends an authenticated GitHub API request and treats a missing resource as undefined.
 * @param {string} path - The GitHub API request path.
 * @param {string} token - The GitHub access token.
 * @return {Promise<unknown|undefined>} The parsed response body, or undefined for an empty response or HTTP 404.
 */
async function githubRequestAllow404(path, token) {
	const response = await fetch(`https://api.github.com${path}`, {
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${token}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (response.status === 404) return undefined;
	const body = await response.text();
	if (!response.ok) throw new Error(`GitHub API ${path} -> HTTP ${response.status}: ${body}`);
	return body ? JSON.parse(body) : undefined;
}

/**
 * Lists the Markdown Changeset files in the Changesets directory.
 * @return {string[]} Sorted Changeset filenames, excluding `README.md`.
 */
function readChangesetNames() {
	const directory = join(root, ".changeset");
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((entry) => entry.endsWith(".md") && entry !== "README.md")
		.sort();
}

/**
 * Reads the current Changesets release status.
 * @return {object|undefined} The parsed release status, or `undefined` when no Changesets are present.
 * @throws {Error} If the Changesets status command fails or produces no output.
 */
function readChangesetStatus() {
	if (readChangesetNames().length === 0) return undefined;
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fleet-changeset-status-"));
	const outputPath = join(temporaryDirectory, "status.json");
	try {
		const pnpm = pnpmInvocation(["exec", "changeset", "status", "--output", outputPath]);
		const result = spawnSync(pnpm.command, pnpm.args, {
			cwd: root,
			encoding: "utf8",
		});
		if (result.error || result.status !== 0 || !existsSync(outputPath)) {
			throw new Error(`changeset status failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
		}
		return JSON.parse(readFileSync(outputPath, "utf8"));
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

/**
 * Builds the package release plan from Changesets status data.
 * @param {object} status - Changesets status data containing package release entries.
 * @returns {{packageName: string, currentVersion: string, version: string}} The package name, current manifest version, and resolved release version.
 * @throws {Error} If the package has no release plan, its expected version differs from the manifest, or the planned version is unstable.
 */
export function releasePlanFromStatus(status) {
	const release = status?.releases?.find((entry) => entry.name === packageName);
	if (!release) throw new Error(`Changesets contain no release plan for ${packageName}`);
	const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
	if (release.oldVersion !== manifest.version) {
		throw new Error(
			`Changesets expects ${packageName}@${release.oldVersion}, but the repository manifest is ${manifest.version}`,
		);
	}
	parseStableVersion(release.newVersion);
	return {
		packageName,
		currentVersion: release.oldVersion,
		version: resolveReleaseVersion(release.oldVersion, release.newVersion),
	};
}

/**
 * Applies the one-time target for the pending 0.5.1 patch release.
 * @param {string} currentVersion - The package version before Changesets runs.
 * @param {string} plannedVersion - The version calculated by Changesets.
 * @returns {string} The version to use for the release PR.
 */
export function resolveReleaseVersion(currentVersion, plannedVersion) {
	const [major, minor, patch] = parseStableVersion(currentVersion);
	const nextPatchVersion = `${major}.${minor}.${patch + 1}`;
	return currentVersion === oneTimeReleaseOverride.fromVersion && plannedVersion === nextPatchVersion
		? oneTimeReleaseOverride.targetVersion
		: plannedVersion;
}

/**
 * Derives the preceding patch version for a stable release target.
 * @param {string} targetVersion - The target release version.
 * @returns {string} The preceding patch version.
 */
export function releaseTargetBaselineVersion(targetVersion) {
	const [major, minor, patch] = parseStableVersion(targetVersion);
	if (patch === 0) throw new Error(`Cannot derive a patch baseline from ${targetVersion}`);
	return `${major}.${minor}.${patch - 1}`;
}

/**
 * Temporarily moves the manifest to the preceding patch so `changeset version` emits the target release.
 * @param {{currentVersion: string, version: string}} releasePlan - The resolved release plan.
 */
function prepareManifestForReleaseTarget(releasePlan) {
	if (
		releasePlan.currentVersion !== oneTimeReleaseOverride.fromVersion ||
		releasePlan.version !== oneTimeReleaseOverride.targetVersion
	) {
		return;
	}
	const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
	if (manifest.version !== releasePlan.currentVersion) {
		throw new Error(
			`Release target ${releasePlan.version} expects ${packageName}@${releasePlan.currentVersion}, but the repository manifest is ${manifest.version}`,
		);
	}
	writeFileSync(
		packageManifestPath,
		`${JSON.stringify({ ...manifest, version: releaseTargetBaselineVersion(releasePlan.version) }, null, 2)}\n`,
	);
}

/**
 * Returns the planned package version, or `undefined` when no Changesets are pending.
 * @param {object|undefined|null} status - Changesets status data, when available.
 * @returns {string|undefined} The planned stable version.
 */
export function releaseVersionFromStatus(status) {
	return status ? releasePlanFromStatus(status).version : undefined;
}

/**
 * Lists files changed from a specified Git commit.
 * @param {string} baseSha - The commit to compare against.
 * @returns {{status: string, path: string}[]} The changed files and their Git status codes.
 */
function changedFiles(baseSha) {
	return execFileSync("git", ["diff", "--name-status", baseSha, "--"], { cwd: root, encoding: "utf8" })
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [status, path] = line.split("\t");
			return { status: status[0], path };
		});
}

/**
 * Validates that release versioning changes affect only approved package, changelog, and Changeset files.
 * @param {Array<{path: string, status: string}>} files - Changed files and their Git statuses.
 */
function assertVersionChangesOnly(files) {
	const allowed = (path, status) => {
		if (path === "packages/fleet-web/package.json" && status !== "D") return true;
		if (path === "packages/fleet-web/CHANGELOG.md" && status !== "D") return true;
		return (
			status === "D" && path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md"
		);
	};
	const unexpected = files.filter(({ path, status }) => !allowed(path, status));
	if (unexpected.length > 0) {
		throw new Error(
			`changeset version modified unexpected files: ${unexpected.map(({ status, path }) => `${status} ${path}`).join(", ")}`,
		);
	}
}

/**
 * Creates a release branch and pull request for the specified package version.
 * Skips creation when the target release pull request already exists, another release pull request is active, or the release branch is unmanaged.
 * @param {string} token - GitHub authentication token.
 * @param {string} version - Stable release version.
 * @param {string} baseSha - Commit SHA from which to create the release.
 * @param {Object} [options] - Release preparation options.
 * @param {Function} [options.githubRequestImpl] - GitHub request implementation.
 * @param {Function} [options.githubRequestAllow404Impl] - GitHub request implementation that allows a 404 response.
 * @param {Object} [options.releasePlan] - Release plan used to prepare the manifest for the target version.
 * @throws {Error} If the version is invalid, an unmanaged release branch exists, or versioning produces invalid or empty changes.
 */
export async function createVersionPullRequest(
	token,
	version,
	baseSha,
	{ githubRequestImpl = githubRequest, githubRequestAllow404Impl = githubRequestAllow404, releasePlan } = {},
) {
	const { owner, repo } = RELEASE_REPOSITORY;
	parseStableVersion(version);
	const branch = `release/fleet-v${version}`;
	const existingPullRequests = await githubRequestImpl(
		`/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`,
		token,
	);
	if (existingPullRequests.length > 0) {
		console.log(`Release pull request already exists for ${version}; leaving it unchanged.`);
		return;
	}
	const repositoryFullName = `${owner}/${repo}`.toLowerCase();
	const openReleasePullRequests = await githubRequestImpl(
		`/repos/${owner}/${repo}/pulls?state=open&base=${baseBranch}&per_page=100`,
		token,
	);
	const anotherReleasePullRequest = openReleasePullRequests.find(
		(pullRequest) =>
			pullRequest.head?.ref?.startsWith("release/fleet-") &&
			pullRequest.head?.repo?.full_name?.toLowerCase() === repositoryFullName,
	);
	if (anotherReleasePullRequest) {
		console.log(
			`Release pull request ${anotherReleasePullRequest.html_url ?? "already open"} is active; waiting before preparing ${version}.`,
		);
		return;
	}

	if (await githubRequestAllow404Impl(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token)) {
		throw new Error(
			`Release branch ${branch} already exists without an open pull request; refusing to overwrite it.`,
		);
	}

	if (releasePlan) prepareManifestForReleaseTarget(releasePlan);
	const pnpm = pnpmInvocation(["exec", "changeset", "version"]);
	execFileSync(pnpm.command, pnpm.args, { cwd: root, stdio: "inherit" });
	const files = changedFiles(baseSha);
	assertVersionChangesOnly(files);
	if (files.length === 0) throw new Error("changeset version produced no changes");

	const baseCommit = await githubRequestImpl(`/repos/${owner}/${repo}/git/commits/${baseSha}`, token);
	const tree = await githubRequestImpl(`/repos/${owner}/${repo}/git/trees`, token, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			base_tree: baseCommit.tree.sha,
			tree: files.map(({ path, status }) =>
				status === "D"
					? { path, mode: "100644", type: "blob", sha: null }
					: { path, mode: "100644", type: "blob", content: readFileSync(join(root, path), "utf8") },
			),
		}),
	});
	const commit = await githubRequestImpl(`/repos/${owner}/${repo}/git/commits`, token, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			message: `chore(release): version ${packageName} ${version}`,
			tree: tree.sha,
			parents: [baseSha],
		}),
	});
	await githubRequestImpl(`/repos/${owner}/${repo}/git/refs`, token, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
	});
	const pullRequest = await githubRequestImpl(`/repos/${owner}/${repo}/pulls`, token, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: `chore(release): ${packageName}@${version}`,
			head: branch,
			base: baseBranch,
			body:
				`This release PR was generated from the accumulated Changesets.\n\n` +
				`After merge, CircleCI will build, verify, and publish ${packageName}@${version}.`,
		}),
	});
	console.log(`Created release pull request ${pullRequest.html_url} for ${packageName}@${version}.`);
}

/**
 * Prepares a pull request for the pending Changesets release.
 * @param {Object} [options] - Release preparation options.
 * @param {string} [options.baseSha] - Commit to use as the release base.
 * @param {Object} [options.status] - Changeset status data.
 * @param {boolean} [options.dryRun=false] - Whether to report the planned release without creating changes.
 * @param {string} [options.branch] - Current branch name, which must be `main`.
 * @returns {Promise<Object>} Preparation result, including the release plan when applicable.
 * @throws {Error} If the current branch is not `main`, required release environment values are missing, or the configured release version does not match the planned version.
 */
export async function prepareRelease({
	token,
	baseSha,
	status = readChangesetStatus(),
	dryRun = false,
	branch = process.env.CIRCLE_BRANCH ??
		execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim(),
} = {}) {
	if (!status) {
		console.log("No pending Changesets; release preparation is a no-op.");
		return { prepared: false };
	}
	const plan = releasePlanFromStatus(status);
	const resolvedBaseSha =
		baseSha ??
		process.env.CIRCLE_SHA1 ??
		execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
	if (branch !== baseBranch) {
		throw new Error(`Release preparation must run on ${baseBranch}, found ${branch || "detached HEAD"}`);
	}
	if (dryRun) {
		console.log(`Release preparation dry-run: would prepare ${packageName}@${plan.version}.`);
		return { prepared: false, dryRun: true, plan };
	}
	if (!token) throw new Error("GITHUB_TOKEN is required for release-PR preparation");
	const releaseVersion = process.env.FLEET_RELEASE_VERSION;
	if (!releaseVersion) throw new Error("FLEET_RELEASE_VERSION is required for release-PR preparation");
	if (releaseVersion !== plan.version) {
		throw new Error(`FLEET_RELEASE_VERSION ${releaseVersion} does not match the Changesets version ${plan.version}`);
	}
	await createVersionPullRequest(token, releaseVersion, resolvedBaseSha, { releasePlan: plan });
	return { prepared: true, plan };
}

/**
 * Runs the release-preparation command.
 * @param {string[]} [argv=process.argv.slice(2)] - Command-line arguments.
 * @param {{readStatus?: () => object|undefined|null, log?: (message: string) => void}} [dependencies] - Injectable command dependencies for tests.
 * @returns {Promise<void>} Resolves when preparation completes or is a no-op.
 */
export async function run(argv = process.argv.slice(2), { readStatus = readChangesetStatus, log = console.log } = {}) {
	const { dryRun, printVersion } = parseArgs(argv);
	if (printVersion) {
		const version = releaseVersionFromStatus(readStatus());
		if (version) log(version);
		return;
	}
	await prepareRelease({ token: process.env.GITHUB_TOKEN, dryRun });
}

async function main() {
	await run();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
