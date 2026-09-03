#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pnpmInvocation } from "./pnpm-command.mjs";

const RELEASE_BRANCH_PREFIX = "release/fleet-";
const PACKAGE_NAME = "@qredence/fleet";
const USER_FACING_PREFIXES = ["packages/fleet-prime/bin/", "web/app/", "web/design/", "web/protocol/", "web/server/"];
const USER_FACING_FILES = new Set([
	"fleet-prime.sh",
	"install.sh",
	"PRIME_AGENT_RUNTIME.json",
	"packages/fleet-prime/package.json",
	"packages/fleet-prime/README.md",
	"scripts/build-web-release.mjs",
	"scripts/prime-agent-web-launcher.mjs",
]);

function gitOutput(args) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function isCiComparison() {
	return Boolean(process.env.CI || process.env.CIRCLE_BASE_REVISION);
}

function resolveBaseRef() {
	if (process.env.CIRCLE_BASE_REVISION) return process.env.CIRCLE_BASE_REVISION;
	for (const candidate of ["origin/main", "main"]) {
		try {
			gitOutput(["rev-parse", "--verify", candidate]);
			return candidate;
		} catch {
			// Try the next local ref.
		}
	}
	if (process.env.CI) throw new Error("Could not resolve main as the Changeset comparison base in CI");
	return "HEAD^";
}

function changedFiles(baseRef) {
	const committed = gitOutput(["diff", "--name-only", `${baseRef}...HEAD`, "--"])
		.split("\n")
		.filter(Boolean);
	if (isCiComparison()) return committed;
	const worktree = gitOutput(["diff", "--name-only", "HEAD", "--"]).split("\n").filter(Boolean);
	const staged = gitOutput(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
	const untracked = gitOutput(["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
	return [...new Set([...committed, ...worktree, ...staged, ...untracked])].sort();
}

function isUserFacing(path) {
	return USER_FACING_FILES.has(path) || USER_FACING_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function hasDeletedChangeset(baseRef) {
	return gitOutput(["diff", "--name-status", `${baseRef}...HEAD`, "--", ".changeset"])
		.split("\n")
		.filter(Boolean)
		.some((line) => /^D\t\.changeset\/[^/]+\.md$/.test(line));
}

function isGeneratedVersionCommit(baseRef, files) {
	const releaseOnly =
		files.length > 0 &&
		files.every(
			(path) =>
				path === "packages/fleet-prime/package.json" ||
				path === "packages/fleet-prime/CHANGELOG.md" ||
				(path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md"),
		);
	if (!releaseOnly) return false;
	const subject = gitOutput(["log", "-1", "--format=%s"]);
	return subject.startsWith("chore(release):") || subject.includes("release/fleet-v") || hasDeletedChangeset(baseRef);
}

function pendingChangesets() {
	const directory = ".changeset";
	if (!existsSync(directory)) return [];
	return readdirSync(directory).filter((entry) => entry.endsWith(".md") && entry !== "README.md");
}

function validateChangesetStatus(baseRef) {
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fleet-changeset-check-"));
	const outputPath = join(temporaryDirectory, "status.json");
	try {
		const statusArguments = ["exec", "changeset", "status"];
		if (isCiComparison()) statusArguments.push("--since", baseRef);
		statusArguments.push("--output", outputPath);
		const pnpm = pnpmInvocation(statusArguments);
		execFileSync(pnpm.command, pnpm.args, {
			cwd: process.cwd(),
			stdio: "inherit",
		});
		const status = JSON.parse(readFileSync(outputPath, "utf8"));
		if (!status.releases?.some((release) => release.name === PACKAGE_NAME)) {
			throw new Error(`The Changesets release plan does not include ${PACKAGE_NAME}.`);
		}
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

function main() {
	const branch = process.env.CIRCLE_BRANCH ?? gitOutput(["branch", "--show-current"]);
	const baseRef = resolveBaseRef();
	const files = changedFiles(baseRef);
	if (isGeneratedVersionCommit(baseRef, files)) {
		console.log(
			branch.startsWith(RELEASE_BRANCH_PREFIX)
				? `Generated release version branch ${branch} does not require a new Changeset.`
				: "Generated Changesets version commit detected; no new Changeset is required.",
		);
		return;
	}
	const userFacingFiles = files.filter(isUserFacing);
	if (userFacingFiles.length === 0) {
		console.log("No user-facing package files changed; no Changeset is required.");
		return;
	}

	const changesets = pendingChangesets();
	if (changesets.length === 0) {
		throw new Error(
			`User-facing package files changed without a Changeset: ${userFacingFiles.join(", ")}. ` +
				"Add .changeset/<name>.md or document and isolate a docs/CI/internal no-release change.",
		);
	}
	validateChangesetStatus(baseRef);
	console.log(`Changeset requirement passed for ${userFacingFiles.length} user-facing file(s).`);
}

main();
