import assert from "node:assert/strict";
import test from "node:test";
import {
	extractVersionSection,
	previousVersion,
	readChangelog,
	readRuntimeVersion,
	releaseNotes,
	stripCommitHashes,
	upgradingNote,
} from "../release-notes.mjs";

// Mirrors the real file's shape, including the two-space line Changesets uses between the paragraphs
// of a multi-paragraph entry.
const changelogFixture = [
	"# Changelog",
	"",
	"## 0.6.5",
	"",
	"### Patch Changes",
	"",
	"- 7cad8f4: First paragraph of the entry.",
	"  ",
	"  Second paragraph, separated by a line holding two spaces.",
	"",
	"## 0.6.4",
	"",
	"### Patch Changes",
	"",
	"- 2ce0f1b: An earlier change.",
	"",
	"All notable changes are recorded here by Changesets.",
	"",
	"## 0.5.0",
	"",
	"Initial release.",
].join("\n");

test("extracts the section recorded for a version", () => {
	assert.equal(
		extractVersionSection(changelogFixture, "0.6.5"),
		[
			"### Patch Changes",
			"",
			"- 7cad8f4: First paragraph of the entry.",
			"  ",
			"  Second paragraph, separated by a line holding two spaces.",
		].join("\n"),
	);
});

test("never matches a version against a longer version heading", () => {
	// A prefix-matching bug would return the 0.6.50 section here.
	assert.equal(extractVersionSection(["## 0.6.50", "", "### Patch Changes"].join("\n"), "0.6.5"), undefined);
	assert.equal(extractVersionSection(changelogFixture, "0.6"), undefined);
});

test("preserves the two-space paragraph separator verbatim", () => {
	const section = extractVersionSection(changelogFixture, "0.6.5");
	assert.ok(section.includes("\n  \n"), "the separator line must survive extraction");
	assert.equal(section.split("\n  \n").length, 2);
});

test("stops at the next version heading and keeps prose-only sections", () => {
	// The trailing sentence mirrors the real file, where a file-level note sits between the last
	// bullet of a section and the next version heading. It therefore belongs to the earlier section.
	assert.equal(
		extractVersionSection(changelogFixture, "0.6.4"),
		[
			"### Patch Changes",
			"",
			"- 2ce0f1b: An earlier change.",
			"",
			"All notable changes are recorded here by Changesets.",
		].join("\n"),
	);
	// 0.5.0 has no "### Patch Changes" heading and must still be extracted.
	assert.equal(extractVersionSection(changelogFixture, "0.5.0"), "Initial release.");
});

test("sections never bleed into each other", () => {
	const section = extractVersionSection(changelogFixture, "0.6.4");
	assert.doesNotMatch(section, /First paragraph of the entry/, "0.6.5 content must not leak into 0.6.4");
	assert.doesNotMatch(section, /Initial release/, "0.5.0 content must not leak into 0.6.4");
});

test("returns undefined for a version the changelog does not record", () => {
	assert.equal(extractVersionSection(changelogFixture, "9.9.9"), undefined);
	assert.equal(extractVersionSection("", "0.6.5"), undefined);
	assert.equal(extractVersionSection(undefined, "0.6.5"), undefined);
});

test("strips the commit-hash prefix from bullets only", () => {
	assert.equal(stripCommitHashes("- 7cad8f4: Make it adaptive."), "- Make it adaptive.");
	assert.equal(stripCommitHashes("- 2ce0f1b: Short."), "- Short.");
	// A hash quoted inside prose is not a bullet prefix and must survive.
	assert.equal(stripCommitHashes("- See 7cad8f4 for the original."), "- See 7cad8f4 for the original.");
	// An indented continuation line is not a bullet.
	assert.equal(stripCommitHashes("  - 7cad8f4: indented"), "  - 7cad8f4: indented");
	// A token shorter than a commit hash is ordinary prose.
	assert.equal(stripCommitHashes("- abc: not a hash"), "- abc: not a hash");
	// Multi-line input keeps its structure.
	assert.equal(
		stripCommitHashes(["- 7cad8f4: One.", "  ", "  continued", "", "- 2ce0f1b: Two."].join("\n")),
		["- One.", "  ", "  continued", "", "- Two."].join("\n"),
	);
});

test("finds the version released before the given one", () => {
	assert.equal(previousVersion(changelogFixture, "0.6.5"), "0.6.4");
	assert.equal(previousVersion(changelogFixture, "0.6.4"), "0.5.0");
	// The oldest recorded version has no predecessor.
	assert.equal(previousVersion(changelogFixture, "0.5.0"), undefined);
	assert.equal(previousVersion(changelogFixture, "9.9.9"), undefined);
});

test("describes a moved, unchanged, and unknown runtime pin", () => {
	assert.match(
		upgradingNote({ currentRuntimeVersion: "0.9.4", previousRuntimeVersion: "0.9.3" }),
		/moves the upstream Prime Agent runtime from `prime-agent` 0\.9\.3 to 0\.9\.4/,
	);
	assert.match(
		upgradingNote({ currentRuntimeVersion: "0.9.3", previousRuntimeVersion: "0.9.3" }),
		/unchanged in this release: it remains `prime-agent` 0\.9\.3/,
	);
	const unknown = upgradingNote({});
	assert.match(unknown, /stock tarball pinned in `PRIME_AGENT_RUNTIME\.json`/);
	assert.doesNotMatch(unknown, /unchanged|moves/);
	assert.match(upgradingNote({ currentRuntimeVersion: "0.9.3" }), /stock tarball/);
});

test("assembles every section of the release notes", () => {
	const notes = releaseNotes({
		version: "0.6.5",
		changelog: changelogFixture,
		currentRuntimeVersion: "0.9.3",
		previousRuntimeVersion: "0.9.3",
	});
	assert.match(notes, /^Fleet Prime v0\.6\.5\.\n/);
	for (const heading of ["## What changed", "## Upgrading", "## Artifacts"]) {
		assert.ok(notes.includes(`\n${heading}\n`), `missing ${heading}`);
	}
	assert.ok(notes.includes("First paragraph of the entry."));
	assert.ok(notes.includes("Second paragraph, separated by a line holding two spaces."));
	assert.ok(notes.includes("`qredence-fleet-0.6.5.tgz` — packed `@qredence/fleet` launcher package"));
	assert.ok(notes.includes("`SHA256SUMS` — checksum for the packed tarball"));
	assert.ok(notes.includes("trusted publishing"));
	assert.doesNotMatch(notes, /7cad8f4/, "commit hashes must not reach the release page");
});

test("names the missing source instead of throwing when the section is absent", () => {
	// These notes are written after an irreversible npm publish, so this must not throw.
	const notes = releaseNotes({ version: "9.9.9", changelog: changelogFixture });
	assert.match(notes, /could not be derived from `packages\/fleet-web\/CHANGELOG\.md`/);
	assert.match(notes, /records no `## 9\.9\.9` section/);
	assert.match(notes, /\n## Artifacts\n/);
	assert.doesNotThrow(() => releaseNotes({ version: "9.9.9" }));
	assert.doesNotThrow(() => releaseNotes({}));
});

test("derives notes for a real recorded release from the repository changelog", () => {
	const changelog = readChangelog();
	assert.equal(typeof changelog, "string");
	const runtimeVersion = readRuntimeVersion();
	assert.equal(typeof runtimeVersion, "string");

	const notes = releaseNotes({
		version: "0.6.5",
		changelog,
		currentRuntimeVersion: runtimeVersion,
		previousRuntimeVersion: readRuntimeVersion(),
	});
	// The prose that Changesets recorded for 0.6.5 must reach the release page.
	assert.match(notes, /adaptive and session-aware/);
	assert.match(notes, /`qredence-fleet-0\.6\.5\.tgz`/);
	assert.doesNotMatch(notes, /^7cad8f4:/m);
	// A release must not describe a different release's changes.
	const earlier = releaseNotes({ version: "0.6.4", changelog, currentRuntimeVersion: runtimeVersion });
	assert.match(earlier, /`qredence-fleet-0\.6\.4\.tgz`/);
	assert.doesNotMatch(earlier, /adaptive and session-aware/);
});
