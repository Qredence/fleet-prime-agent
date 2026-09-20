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
 * Extracts the changelog section recorded for a release version.
 *
 * The heading is matched exactly, so `0.6.5` cannot match a `0.6.50` heading. Lines are returned
 * verbatim: Changesets separates the paragraphs of a multi-paragraph entry with lines holding only two
 * spaces, and re-wrapping or blank-line filtering would collapse them into one paragraph.
 * @param {string} changelog - The changelog contents.
 * @param {string} version - The release version to extract.
 * @returns {string|undefined} The section body, or `undefined` when the version is not recorded.
 */
export function extractVersionSection(changelog, version) {
	const lines = (changelog ?? "").split("\n");
	const heading = `## ${version}`;
	const start = lines.findIndex((line) => line.trimEnd() === heading);
	if (start === -1) return undefined;
	const body = [];
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith("## ")) break;
		body.push(line);
	}
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
 * version heading. This is read from the changelog rather than the releases API so the comparison is
 * against the same document the changes are read from.
 * @param {string} changelog - The changelog contents.
 * @param {string} version - The release version.
 * @returns {string|undefined} The previous version, or `undefined` when there is none.
 */
export function previousVersion(changelog, version) {
	const versions = (changelog ?? "")
		.split("\n")
		.filter((line) => line.startsWith("## "))
		.map((line) => line.slice(3).trim());
	const index = versions.indexOf(version);
	if (index === -1) return undefined;
	return versions[index + 1];
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
				`This release's changes could not be derived from \`packages/fleet-web/CHANGELOG.md\`, which ` +
					`records no \`## ${version}\` section.`,
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
