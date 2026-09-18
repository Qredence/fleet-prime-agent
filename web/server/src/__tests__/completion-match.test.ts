import { describe, expect, it } from "vitest";
import {
	type CompletionCandidate,
	findCompletion,
	harvestPromptCandidates,
	normalizeCompletionText,
} from "../completion/match";

const at = (text: string, age: number): CompletionCandidate => ({ text, at: age });

describe("findCompletion", () => {
	const candidates: CompletionCandidate[] = [
		at("refactor the auth middleware and add tests", 100),
		at("refactor the auth middleware", 200),
		at("run the tests", 300),
		at("refactor the parser", 50),
	];

	it("matches a plain prefix", () => {
		expect(findCompletion("run the tes", candidates)).toBe("run the tests");
	});

	it("completes a prefix from history", () => {
		const only = [at("refactor the auth middleware and add tests", 100)];
		expect(findCompletion("refactor the auth mid", only)).toBe("refactor the auth middleware and add tests");
	});

	it("prefers the most recent candidate when several match", () => {
		// A later, shorter prompt wins over an earlier, longer one: recency is the
		// signal, and the user can always keep typing to narrow it.
		const overlapping: CompletionCandidate[] = [
			at("refactor the auth middleware and add tests", 100),
			at("refactor the auth middleware", 200),
		];
		expect(findCompletion("refactor the auth mid", overlapping)).toBe("refactor the auth middleware");
		expect(findCompletion("refactor the auth middleware", overlapping)).toBe(
			"refactor the auth middleware and add tests",
		);
	});

	it("breaks a recency tie with the longer candidate", () => {
		const tied: CompletionCandidate[] = [at("ship it now", 5), at("ship it now please", 5)];
		expect(findCompletion("ship it", tied)).toBe("ship it now please");
	});

	it("returns nothing below the minimum draft length", () => {
		expect(findCompletion("ref", candidates)).toBeUndefined();
		// The floor is configurable, and a caller may lower it deliberately.
		expect(findCompletion("ru", [at("run the tests", 1)], { minChars: 2 })).toBe("run the tests");
	});

	it("never returns a candidate that does not advance the draft", () => {
		expect(findCompletion("refactor the auth middleware", [at("refactor the auth middleware", 5)])).toBeUndefined();
		expect(findCompletion("nothing matches this at all", candidates)).toBeUndefined();
	});

	it("ignores candidates over the length cap", () => {
		const long = [at(`deploy ${"x".repeat(300)}`, 5)];
		expect(findCompletion("deploy", long)).toBeUndefined();
		expect(findCompletion("deploy", long, { maxChars: 400 })).toBeDefined();
	});

	it("collapses whitespace and keeps the candidate's own casing", () => {
		const cased = [at("Refactor   The Auth Middleware", 5)];
		// Comparisons are whitespace- and case-insensitive; the returned text keeps
		// the original casing but is whitespace-collapsed, which is the form the
		// caller measures the suffix against.
		expect(findCompletion("refactor the auth", cased)).toBe("Refactor The Auth Middleware");
	});

	it("handles an empty corpus", () => {
		expect(findCompletion("anything at all", [])).toBeUndefined();
	});
});

describe("harvestPromptCandidates", () => {
	it("keeps only user-authored prose", () => {
		const harvested = harvestPromptCandidates(
			[
				{ role: "user", text: "refactor the auth middleware and add tests" },
				{ role: "assistant", text: "I will start by reading the middleware" },
				{ role: "user", text: "short" },
			],
			42,
		);
		expect(harvested.map((c) => c.text)).toEqual(["refactor the auth middleware and add tests"]);
		expect(harvested[0]?.at).toBe(42);
	});

	it("drops harness scaffolding and injected context", () => {
		const harvested = harvestPromptCandidates(
			[
				{ role: "user", text: "<system-reminder>something injected here</system-reminder>" },
				{ role: "user", text: "[harness-digest] persistent memories produced across this session" },
				{ role: "user", text: "explain the <harness_state> block" },
				{ role: "user", text: "a genuine prompt from a person" },
			],
			1,
		);
		expect(harvested.map((c) => c.text)).toEqual(["a genuine prompt from a person"]);
	});

	it("drops entries too long to be something a person retypes", () => {
		const harvested = harvestPromptCandidates([{ role: "user", text: "x".repeat(400) }], 1);
		expect(harvested).toEqual([]);
	});
});

describe("normalizeCompletionText", () => {
	it("collapses whitespace and trims", () => {
		expect(normalizeCompletionText("  run   the\n tests ")).toBe("run the tests");
	});
});
