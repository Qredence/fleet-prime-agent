import { describe, expect, it } from "vitest";
import {
	COMPOSER_COMPLETION_MIN_CHARS,
	composerCompletionGhost,
	composerCompletionIgnores,
} from "../composer-completion";

describe("composerCompletionIgnores", () => {
	it("stays out of the way of the trigger popovers", () => {
		// The `/` and `@` popovers own these drafts and their Tab binding.
		expect(composerCompletionIgnores("/compact")).toBe(true);
		expect(composerCompletionIgnores("  /set")).toBe(true);
		expect(composerCompletionIgnores("look at @src/lib")).toBe(true);
		expect(composerCompletionIgnores("see @")).toBe(true);
	});

	it("allows ordinary prose", () => {
		expect(composerCompletionIgnores("refactor the auth middleware")).toBe(false);
		// A completed mention is no longer an open trigger token.
		expect(composerCompletionIgnores("read @src/lib/a.ts now")).toBe(false);
	});
});

describe("composerCompletionGhost", () => {
	it("returns only the suffix the composer should paint", () => {
		expect(composerCompletionGhost("refactor the auth", "refactor the auth middleware and add tests")).toBe(
			" middleware and add tests",
		);
	});

	it("refuses a completion that does not extend the draft", () => {
		// A replacement is the intent router's chip, not an inline ghost.
		expect(composerCompletionGhost("hotskeys", "/hotkeys")).toBeUndefined();
		expect(composerCompletionGhost("abc", "xyzabc")).toBeUndefined();
	});

	it("refuses an empty or non-advancing completion", () => {
		expect(composerCompletionGhost("abc", undefined)).toBeUndefined();
		expect(composerCompletionGhost("abc", "")).toBeUndefined();
		expect(composerCompletionGhost("abc", "abc")).toBeUndefined();
		expect(composerCompletionGhost("abc", "ab")).toBeUndefined();
	});

	it("matches case-insensitively but returns the candidate's own casing", () => {
		expect(composerCompletionGhost("REFACTOR the", "refactor the parser")).toBe(" parser");
	});

	it("keeps a sane floor for how little typing earns a suggestion", () => {
		expect(COMPOSER_COMPLETION_MIN_CHARS).toBeGreaterThanOrEqual(3);
	});
});
