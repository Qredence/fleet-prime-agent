#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pnpmInvocation } from "./pnpm-command.mjs";
import { parseStableVersion, RELEASE_REPOSITORY } from "./release-utils.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageManifestPath = join(root, "packages", "fleet-prime", "package.json");
const packageName = "@qredence/fleet";
const baseBranch = "main";

function parseArgs(argv) {
	let dryRun = false;
	for (const argument of argv) {
		if (argument === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (argument === "--help" || argument === "-h") {
			console.log("Usage: node scripts/prepare-release.mjs [--dry-run]");
			process.exit(0);
		}
		throw new Error(`Unknown option: ${argument}`);
	}
	return { dryRun };
}

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

function readChangesetNames() {
	const directory = join(root, ".changeset");
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((entry) => entry.endsWith(".md") && entry !== "README.md")
		.sort();
}

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
	return { packageName, currentVersion: release.oldVersion, version: release.newVersion };
}

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

function assertVersionChangesOnly(files) {
	const allowed = (path, status) => {
		if (path === "packages/fleet-prime/package.json" && status !== "D") return true;
		if (path === "packages/fleet-prime/CHANGELOG.md" && status !== "D") return true;
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

export async function createVersionPullRequest(
	token,
	plan,
	baseSha,
	{ githubRequestImpl = githubRequest, githubRequestAllow404Impl = githubRequestAllow404 } = {},
) {
	const { owner, repo } = RELEASE_REPOSITORY;
	const branch = `release/fleet-v${plan.version}`;
	const existingPullRequests = await githubRequestImpl(
		`/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&per_page=1`,
		token,
	);
	if (existingPullRequests.length > 0) {
		console.log(`Release pull request already exists for ${plan.version}; leaving it unchanged.`);
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
			`Release pull request ${anotherReleasePullRequest.html_url ?? "already open"} is active; waiting before preparing ${plan.version}.`,
		);
		return;
	}

	if (await githubRequestAllow404Impl(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token)) {
		throw new Error(
			`Release branch ${branch} already exists without an open pull request; refusing to overwrite it.`,
		);
	}

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
			message: `chore(release): version ${packageName} ${plan.version}`,
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
			title: `chore(release): ${packageName}@${plan.version}`,
			head: branch,
			base: baseBranch,
			body:
				`This release PR was generated from the accumulated Changesets.\n\n` +
				`After merge, CircleCI will build, verify, and publish ${packageName}@${plan.version}.`,
		}),
	});
	console.log(`Created release pull request ${pullRequest.html_url} for ${packageName}@${plan.version}.`);
}

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
	await createVersionPullRequest(token, plan, resolvedBaseSha);
	return { prepared: true, plan };
}

async function main() {
	const { dryRun } = parseArgs(process.argv.slice(2));
	await prepareRelease({ token: process.env.GITHUB_TOKEN, dryRun });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
