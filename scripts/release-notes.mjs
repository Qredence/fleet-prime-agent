#!/usr/bin/env node

// Builds the GitHub release notes for a Fleet release.
//
// Every section is derived from artefacts the release already produces: the changes come from
// packages/fleet-web/CHANGELOG.md, which Changesets writes from the accumulated .changeset/*.md
// bodies, and the upgrading note from PRIME_AGENT_RUNTIME.json. Nothing here is hand-maintained,
// which is what AGENTS.md requires of the Fleet changelog.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const packageName = "@qredence/fleet";
// Resolved from this module rather than the working directory so the notes do not depend on how the
// publisher happened to be spawned.
const changelogFile = fileURLToPath(new URL("../packages/fleet-web/CHANGELOG.md", import.meta.url));
const runtimeManifestFile = "PRIME_AGENT_RUNTIME.json";
const runtimeManifestPath = fileURLToPath(new URL("../PRIME_AGENT_RUNTIME.json", import.meta.url));

/**
 * Reads the Fleet changelog.
 * @return {string|undefined} The changelog contents, or `undefined` when it cannot be read.
 */
export function readChangelog() {
	try {
		return readFileSync(changelogFile, "utf8");
	} catch {
		return undefined;
	}
}

/**
 * Reads the upstream Prime Agent runtime version this release pins.
 * @return {string|undefined} The pinned version, or `undefined` when the manifest cannot be read.
 */
export function readRuntimeVersion() {
	try {
		return JSON.parse(readFileSync(runtimeManifestPath, "utf8")).version;
	} catch {
		return undefined;
	}
}

/**
 * Splits a changelog into lines.
 * CRLF is normalised here so a stray carriage return cannot reach the release page: splitting on `\n`
 * alone would leave a trailing `\r` on every line, which the blank-line trimming below would then fail
 * to recognise.
 * @param {string} changelog - The changelog contents.
 * @returns {string[]} The changelog lines.
 */
function changelogLines(changelog) {
	return (changelog ?? "").split(/\r?\n/);
}

/**
 * Lists the version headings in a changelog, in order.
 *
 * The extractor and the predecessor lookup both go through this, so they cannot disagree about what
 * counts as a heading. The version is matched exactly against the heading text, so `0.6.5` still
 * cannot match a `0.6.50` heading, while surrounding whitespace is tolerated.
 * @param {string[]} lines - Changelog lines.
 * @returns {Array<{version: string, start: number}>} Each version and the line index of its heading.
 */
function versionHeadings(lines) {
	const headings = [];
	for (const [index, line] of lines.entries()) {
		// `### Patch Changes` cannot match: the third character is `#`, not whitespace.
		const match = /^##\s+(\S.*?)\s*$/.exec(line);
		if (match) headings.push({ version: match[1], start: index });
	}
	return headings;
}

/**
 * Extracts the changelog section recorded for a release version.
 *
 * Lines are returned verbatim: Changesets separates the paragraphs of a multi-paragraph entry with
 * lines holding only two spaces, and re-wrapping or trimming individual lines would collapse those
 * paragraphs and flatten the two-space-indented sub-bullets of entries such as 0.5.11 into top-level
 * bullets.
 * @param {string} changelog - The changelog contents.
 * @param {string} version - The release version to extract.
 * @returns {string|undefined} The section body, or `undefined` when the version is not recorded.
 */
export function extractVersionSection(changelog, version) {
	const lines = changelogLines(changelog);
	const headings = versionHeadings(lines);
	const position = headings.findIndex((heading) => heading.version === version);
	if (position === -1) return undefined;
	const body = lines.slice(headings[position].start + 1, headings[position + 1]?.start ?? lines.length);
	while (body.length > 0 && body[0] === "") body.shift();
	while (body.length > 0 && body[body.length - 1] === "") body.pop();
	return body.join("\n");
}

/**
 * Removes the Changesets commit-hash prefix from changelog bullets.
 *
 * Only a hash at the very start of a bullet is removed, so a hash quoted inside prose survives, and
 * continuation lines are left alone.
 * @param {string} section - A changelog section.
 * @returns {string} The section with bullet hash prefixes removed.
 */
export function stripCommitHashes(section) {
	return (section ?? "").replace(/^- [0-9a-fA-F]{7,40}: /gm, "- ");
}

/**
 * Finds the version released immediately before the given one.
 *
 * Changesets prepends new sections, so the changelog is newest-first and the predecessor is the next
 * version heading. This is read from the changelog rather than from refs so the comparison is against
 * the same document the changes are read from, and because the local tag namespace is not a list of
 * Fleet releases: the `upstream` remote contributes `prime-agent` tags (v0.7.0 through v0.9.4) that
 * interleave with Fleet's, and Fleet has no 0.5.2, 0.5.3 or 0.5.4, so a "previous patch" guess would
 * request a tag that does not exist.
 * @param {string} changelog - The changelog contents.
 * @param {string} version - The release version.
 * @returns {string|undefined} The previous version, or `undefined` when there is none.
 */
export function previousVersion(changelog, version) {
	const headings = versionHeadings(changelogLines(changelog));
	const position = headings.findIndex((heading) => heading.version === version);
	if (position === -1) return undefined;
	// A duplicated heading for the version being released must not resolve to itself, which would
	// compare the runtime pin against the tag being published and always report it as unchanged.
	const next = headings.slice(position + 1).find((heading) => heading.version !== version);
	return next?.version;
}

/**
 * Describes the upstream runtime pin for the upgrading section.
 * @param {Object} [versions] - The runtime versions to compare.
 * @param {string} [versions.currentRuntimeVersion] - The runtime version this release pins.
 * @param {string} [versions.previousRuntimeVersion] - The runtime version the previous release pinned.
 * @returns {string} The upgrading paragraph.
 */
export function upgradingNote({ currentRuntimeVersion, previousRuntimeVersion } = {}) {
	if (currentRuntimeVersion && previousRuntimeVersion) {
		if (currentRuntimeVersion !== previousRuntimeVersion) {
			return (
				`This release moves the upstream Prime Agent runtime from \`prime-agent\` ${previousRuntimeVersion} ` +
				`to ${currentRuntimeVersion}. Existing local installs are unaffected until you upgrade; verify the ` +
				`checksum pinned in \`${runtimeManifestFile}\` before installing.`
			);
		}
		return (
			`The upstream Prime Agent runtime is unchanged in this release: it remains \`prime-agent\` ` +
			`${currentRuntimeVersion}, the stock tarball pinned in \`${runtimeManifestFile}\`. Verify that ` +
			"checksum before installing."
		);
	}
	return (
		`The upstream Prime Agent runtime is the stock tarball pinned in \`${runtimeManifestFile}\`. ` +
		"Verify that checksum before installing."
	);
}

/**
 * Builds the release notes shown on the GitHub release page.
 *
 * A changelog section that cannot be derived is reported inside the notes rather than thrown: these
 * are written after the npm publish, which cannot be undone, so failing here would fail a release that
 * has already shipped.
 * @param {Object} [options] - The release facts to render.
 * @param {string} options.version - The release version.
 * @param {string} [options.changelog] - The changelog contents.
 * @param {string} [options.currentRuntimeVersion] - The runtime version this release pins.
 * @param {string} [options.previousRuntimeVersion] - The runtime version the previous release pinned.
 * @returns {string} Markdown release notes.
 */
export function releaseNotes({ version, changelog, currentRuntimeVersion, previousRuntimeVersion } = {}) {
	const section = extractVersionSection(changelog, version);
	const changes = section
		? stripCommitHashes(section)
		: [
				`This release's changes could not be derived from \`packages/fleet-web/CHANGELOG.md\`: it has no ` +
					`\`## ${version}\` section, or the section is empty.`,
				"",
				"Review the release pull request and the commit history for what changed.",
			].join("\n");
	return [
		`Fleet Prime v${version}.`,
		"",
		"## What changed",
		"",
		changes,
		"",
		"## Upgrading",
		"",
		upgradingNote({ currentRuntimeVersion, previousRuntimeVersion }),
		"",
		"## Artifacts",
		"",
		`- \`qredence-fleet-${version}.tgz\` — packed \`${packageName}\` launcher package`,
		"- `SHA256SUMS` — checksum for the packed tarball",
		"",
		`Published to npm as \`${packageName}@${version}\` via CircleCI trusted publishing (no provenance ` +
			"attestations; CircleCI trusted publishing does not support them yet). Verify `SHA256SUMS` before " +
			"installing the tarball.",
	].join("\n");
}
