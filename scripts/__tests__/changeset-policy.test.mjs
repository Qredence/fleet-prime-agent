import assert from "node:assert/strict";
import test from "node:test";
import { assertChangesetPresent, isGeneratedVersionChange, isUserFacing } from "../check-changeset.mjs";

const releaseFiles = [
	"packages/fleet-prime/package.json",
	"packages/fleet-prime/CHANGELOG.md",
	".changeset/release.md",
];

test("rejects user-facing files without a pending Changeset", () => {
	assert.throws(
		() => assertChangesetPresent(["web/app/src/App.tsx"], []),
		/User-facing package files changed without a Changeset/,
	);
});

test("allows documentation and internal files without a Changeset", () => {
	assert.equal(isUserFacing("docs/guides/releasing.md"), false);
	assert.equal(isUserFacing("scripts/check-changeset.mjs"), false);
	assert.doesNotThrow(() => assertChangesetPresent([], []));
});

test("recognizes generated Changesets version commits", () => {
	assert.equal(
		isGeneratedVersionChange({
			files: releaseFiles,
			subject: "chore(release): version @qredence/fleet 0.5.2",
			deletedChangeset: false,
		}),
		true,
	);
	assert.equal(
		isGeneratedVersionChange({
			files: releaseFiles,
			subject: "feat: improve the chat experience",
			deletedChangeset: false,
		}),
		false,
	);
});
