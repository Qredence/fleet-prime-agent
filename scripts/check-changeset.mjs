#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pnpmInvocation } from "./pnpm-command.mjs";

const RELEASE_BRANCH_PREFIX = "release/fleet-";
const PACKAGE_NAME = "@qredence/fleet";
const USER_FACING_PREFIXES = [
	"packages/fleet-web/bin/",
	"web/app/src/",
	"web/app/public/",
	"web/design/src/",
	"web/protocol/src/",
	"web/server/src/",
];
const INTERNAL_PATH_PATTERNS = [/(^|\/)__tests__(\/|$)/, /(^|\/)(?:fixtures?|mocks?)(\/|$)/, /\.(?:test|spec)\.[^/]+$/];
const USER_FACING_FILES = new Set([
	"fleet-prime.sh",
	"install.sh",
	"PRIME_AGENT_RUNTIME.json",
	"packages/fleet-web/package.json",
	"packages/fleet-web/README.md",
	"scripts/build-web-release.mjs",
	"scripts/prime-agent-web-launcher.mjs",
]);

/**
 * Executes a Git command and returns its trimmed standard output.
 * @param {string[]} args - Arguments passed to Git.
 * @return {string} The command's trimmed standard output.
 */
function gitOutput(args) {
	return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/**
 * Determines whether the script is running in CI comparison mode.
 * @return {boolean} `true` if `CI` or `CIRCLE_BASE_REVISION` is set, `false` otherwise.
 */
function isCiComparison() {
	return Boolean(process.env.CI || process.env.CIRCLE_BASE_REVISION);
}

/**
 * Resolves the Git reference used as the Changeset comparison base.
 * @returns {string} The configured CircleCI base revision, an available main reference, or `HEAD^`.
 * @throws {Error} If running in CI without an available comparison base.
 */
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

/**
 * Collects changed file paths relative to the specified base revision.
 *
 * @param {string} baseRef - The revision used as the comparison base.
 * @return {string[]} The sorted, deduplicated list of changed files.
 */
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

/**
 * Determines whether a path identifies a user-facing file.
 * @param {string} path - The file path to evaluate.
 * @return {boolean} `true` if the path is explicitly listed or matches a user-facing directory prefix, `false` otherwise.
 */
export function isUserFacing(path) {
	if (USER_FACING_FILES.has(path)) return true;
	if (INTERNAL_PATH_PATTERNS.some((pattern) => pattern.test(path))) return false;
	return USER_FACING_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Determines whether the comparison includes a deleted Changeset file.
 * @param {string} baseRef - The Git reference used as the comparison base.
 * @return {boolean} `true` if a Changeset Markdown file was deleted, `false` otherwise.
 */
function hasDeletedChangeset(baseRef) {
	return gitOutput(["diff", "--name-status", `${baseRef}...HEAD`, "--", ".changeset"])
		.split("\n")
		.filter(Boolean)
		.some((line) => /^D\t\.changeset\/[^/]+\.md$/.test(line));
}

/**
 * Determines whether the changes consist solely of generated release files.
 * @param {string[]} files - Changed file paths.
 * @param {string} subject - The latest commit subject.
 * @param {boolean} deletedChangeset - Whether a Changeset file was deleted.
 * @return {boolean} `true` if the changes represent a generated version commit, `false` otherwise.
 */
export function isGeneratedVersionChange({ files, subject, deletedChangeset }) {
	const releaseOnly =
		files.length > 0 &&
		files.every(
			(path) =>
				path === "packages/fleet-web/package.json" ||
				path === "packages/fleet-web/CHANGELOG.md" ||
				(path.startsWith(".changeset/") && path.endsWith(".md") && path !== ".changeset/README.md"),
		);
	if (!releaseOnly) return false;
	return subject.startsWith("chore(release):") || subject.includes("release/fleet-v") || deletedChangeset;
}

/**
 * Determines whether the current Git comparison is a generated version commit.
 * @param {string} baseRef - The Git reference used to identify deleted Changesets.
 * @param {string[]} files - Changed file paths.
 * @return {boolean} `true` when the changes are generated release output.
 */
function isGeneratedVersionCommit(baseRef, files) {
	return isGeneratedVersionChange({
		files,
		subject: gitOutput(["log", "-1", "--format=%s"]),
		deletedChangeset: hasDeletedChangeset(baseRef),
	});
}

/**
 * Lists pending Changeset Markdown files.
 * @returns {string[]} The names of Markdown files in `.changeset`, excluding `README.md`; an empty array if the directory is absent.
 */
function pendingChangesets() {
	const directory = ".changeset";
	if (!existsSync(directory)) return [];
	return readdirSync(directory).filter((entry) => entry.endsWith(".md") && entry !== "README.md");
}

/**
 * Verifies that user-facing files have an associated pending Changeset.
 * @param {string[]} userFacingFiles - User-facing files in the comparison.
 * @param {string[]} changesets - Pending Changeset filenames.
 * @throws {Error} If user-facing files have no pending Changeset.
 */
export function assertChangesetPresent(userFacingFiles, changesets) {
	if (userFacingFiles.length === 0 || changesets.length > 0) return;
	throw new Error(
		`User-facing package files changed without a Changeset: ${userFacingFiles.join(", ")}. ` +
			"Add .changeset/<name>.md or document and isolate a docs/CI/internal no-release change.",
	);
}

/**
 * Validates that the Changesets release plan includes `@qredence/fleet`.
 * @param {string} baseRef - The revision used as the comparison base in CI.
 * @throws {Error} If the release plan does not include `@qredence/fleet`.
 */
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

/**
 * Validates that user-facing package changes have an associated Changeset.
 *
 * Skips generated version commits and changes that do not affect user-facing files.
 * Throws an error when user-facing changes lack a pending Changeset or valid release status.
 */
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
	assertChangesetPresent(userFacingFiles, changesets);
	validateChangesetStatus(baseRef);
	console.log(`Changeset requirement passed for ${userFacingFiles.length} user-facing file(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main();
}
