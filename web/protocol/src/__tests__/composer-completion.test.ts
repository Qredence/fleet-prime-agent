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
		// In `append` mode the ghost must begin with what was typed.
		expect(composerCompletionGhost("hotskeys", "/hotkeys")).toBeUndefined();
		expect(composerCompletionGhost("abc", "xyzabc")).toBeUndefined();
	});

	it("paints the whole completion in replace mode, which by definition does not extend the draft", () => {
		expect(composerCompletionGhost("hotskeys", "/hotkeys", "replace")).toBe("/hotkeys");
		expect(composerCompletionGhost("make this shorter", "/compact", "replace")).toBe("/compact");
	});

	it("still refuses an empty replacement", () => {
		expect(composerCompletionGhost("make this shorter", "", "replace")).toBeUndefined();
		expect(composerCompletionGhost("make this shorter", "   ", "replace")).toBeUndefined();
		expect(composerCompletionGhost("make this shorter", undefined, "replace")).toBeUndefined();
	});

	it("normalises a replacement's whitespace", () => {
		expect(composerCompletionGhost("make this shorter", "  /compact  ", "replace")).toBe("/compact");
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

	it("defaults to append, so a caller that predates commands keeps splicing", () => {
		expect(composerCompletionGhost("ship", "ship it now")).toBe(" it now");
		expect(composerCompletionGhost("ship", "ship it now", "append")).toBe(" it now");
	});

	it("keeps a sane floor for how little typing earns a suggestion", () => {
		expect(COMPOSER_COMPLETION_MIN_CHARS).toBeGreaterThanOrEqual(3);
	});
});
