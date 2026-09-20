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

test("keeps two-space indented sub-bullets intact", () => {
	// v0.5.11's entry nests seven sub-bullets two spaces deep. Trimming individual lines would
	// flatten them into seven top-level bullets and change what the release notes claim.
	const nested = [
		"## 0.5.11",
		"",
		"### Patch Changes",
		"",
		"- 786027b: Improve chat-workspace reliability:",
		"  ",
		"  - Keep verified uploads renderable.",
		"  - Defer Settings until first opened.",
		"",
		"## 0.5.10",
	].join("\n");
	const section = extractVersionSection(nested, "0.5.11");
	assert.ok(section.includes("\n  - Keep verified uploads renderable."), "the nested indent must survive");
	assert.ok(section.includes("\n  - Defer Settings until first opened."));
	assert.equal(stripCommitHashes(section), section.replace("- 786027b: ", "- "));
});

test("normalises CRLF without leaving carriage returns in the notes", () => {
	const crlf = "## 0.6.5\r\n\r\n### Patch Changes\r\n\r\n- abc1234: x\r\n\r\n## 0.6.4\r\n";
	const section = extractVersionSection(crlf, "0.6.5");
	assert.equal(section, ["### Patch Changes", "", "- abc1234: x"].join("\n"));
	assert.doesNotMatch(section, /\r/);
	assert.doesNotMatch(releaseNotes({ version: "0.6.5", changelog: crlf }), /\r/);
});

test("treats a heading with extra spacing the same way everywhere", () => {
	// Previously the extractor missed this heading while the predecessor lookup accepted it, so the
	// notes claimed the changes could not be derived yet still compared against 0.6.4.
	const spaced = ["##  0.6.5", "", "### Patch Changes", "", "- abc1234: x", "", "## 0.6.4", "", "- y"].join("\n");
	assert.equal(extractVersionSection(spaced, "0.6.5"), ["### Patch Changes", "", "- abc1234: x"].join("\n"));
	assert.equal(previousVersion(spaced, "0.6.5"), "0.6.4");
});

test("never resolves a version as its own predecessor", () => {
	// A duplicated heading comes from merging two release branches, which this repo's release-branch
	// resume machinery makes reachable. Returning the version itself would compare its runtime pin
	// against its own tag and always report the pin as unchanged.
	const duplicated = ["## 0.6.5", "", "first", "", "## 0.6.5", "", "second", "", "## 0.6.4", "", "x"].join("\n");
	assert.equal(previousVersion(duplicated, "0.6.5"), "0.6.4");
	assert.equal(previousVersion(duplicated, "0.6.4"), undefined);
});

test("skips a patch gap rather than guessing the next version down", () => {
	// Fleet has no 0.5.2, 0.5.3 or 0.5.4 — the changelog goes 0.5.5 to 0.5.1. A "previous patch"
	// implementation would ask for v0.5.4, which does not exist.
	const gapped = ["## 0.5.5", "", "### Patch Changes", "", "- abc1234: x", "", "## 0.5.1", "", "- y"].join("\n");
	assert.equal(previousVersion(gapped, "0.5.5"), "0.5.1");
});

test("keeps every subheading when a version has more than one", () => {
	// Changesets emits up to three headings per version. Unwrapping a single `###` would erase the
	// only textual signal that a release was minor rather than patch.
	const multi = [
		"## 0.7.0",
		"",
		"### Minor Changes",
		"",
		"- aaaaaaa: big",
		"",
		"### Patch Changes",
		"",
		"- bbbbbbb: small",
		"",
		"## 0.6.5",
	].join("\n");
	const section = extractVersionSection(multi, "0.7.0");
	assert.ok(section.includes("### Minor Changes"));
	assert.ok(section.includes("### Patch Changes"));
	assert.equal(previousVersion(multi, "0.7.0"), "0.6.5");
});

test("leaves forms of commit reference it does not own", () => {
	// Pinned as deliberate: a bare number of hash-like length is stripped, a bracketed dependency
	// reference is not (Changesets uses that form for workspace dependency bumps).
	assert.equal(stripCommitHashes("- 1234567890: numeric token"), "- numeric token");
	assert.equal(stripCommitHashes("- Updated dependencies [244d1dc]"), "- Updated dependencies [244d1dc]");
});

test("returns undefined for a version the changelog does not record", () => {
	assert.equal(extractVersionSection(changelogFixture, "9.9.9"), undefined);
	assert.equal(extractVersionSection("", "0.6.5"), undefined);
	assert.equal(extractVersionSection(undefined, "0.6.5"), undefined);
});

test("distinguishes an empty section from an absent one", () => {
	// The section exists, so claiming the changelog "records no section" would be untrue.
	const empty = ["## 0.6.5", "", "", "", "## 0.6.4", "", "x"].join("\n");
	assert.equal(extractVersionSection(empty, "0.6.5"), "");
	const notes = releaseNotes({ version: "0.6.5", changelog: empty });
	assert.match(notes, /or the section is empty/);
	assert.doesNotMatch(notes, /records no/);
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
	assert.match(notes, /has no `## 9\.9\.9` section, or the section is empty/);
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

test("orders the sections changes, upgrading, artifacts", () => {
	const notes = releaseNotes({ version: "0.6.5", changelog: changelogFixture });
	const changes = notes.indexOf("\n## What changed\n");
	const upgrading = notes.indexOf("\n## Upgrading\n");
	const artifacts = notes.indexOf("\n## Artifacts\n");
	assert.ok(changes !== -1 && upgrading !== -1 && artifacts !== -1);
	assert.ok(changes < upgrading && upgrading < artifacts, "sections must appear in reading order");
});

test("derives intact notes for every version the changelog records", () => {
	const changelog = readChangelog();
	const versions = changelog
		.split("\n")
		.filter((line) => /^##\s+\S/.test(line))
		.map((line) => line.replace(/^##\s+/, "").trim());
	assert.ok(versions.length >= 10, `expected the real changelog, found ${versions.length} versions`);
	const runtimeVersion = readRuntimeVersion();
	for (const version of versions) {
		const notes = releaseNotes({
			version,
			changelog,
			currentRuntimeVersion: runtimeVersion,
			previousRuntimeVersion: runtimeVersion,
		});
		assert.doesNotMatch(notes, /^- [0-9a-f]{7,40}: /m, `${version} leaked a commit-hash bullet`);
		assert.ok(notes.includes(`qredence-fleet-${version}.tgz`), `${version} is missing its artifact name`);
		assert.ok(
			Buffer.byteLength(notes, "utf8") < 65536,
			`${version} produced an implausibly large body; check whether a changeset ran away`,
		);
	}
	// The changelog is the authoritative release order, and each version must resolve its predecessor.
	for (const [index, version] of versions.entries()) {
		assert.equal(previousVersion(changelog, version), versions[index + 1], `predecessor of ${version}`);
	}
});
