import {
	COMPOSER_COMPLETION_EXTEND_CONFIDENCE,
	COMPOSER_COMPLETION_FLOOR,
} from "@prime-agent/web-protocol/composer-completion";
import { describe, expect, it } from "vitest";
import {
	type CompletionCandidate,
	type CompletionSuggestion,
	findCompletion,
	harvestPromptCandidates,
	longestCommonPrefix,
	normalizeCompletionText,
} from "../completion/match";

const at = (text: string, age: number, sessionFile?: string): CompletionCandidate => ({
	text,
	at: age,
	...(sessionFile ? { sessionFile } : {}),
});

/** The accepted text, which is what every caller ultimately cares about. */
const text = (suggestion: CompletionSuggestion | undefined): string | undefined => suggestion?.completion;

describe("findCompletion", () => {
	const candidates: CompletionCandidate[] = [
		at("refactor the auth middleware and add tests", 100),
		at("refactor the auth middleware", 200),
		at("run the tests", 300),
		at("refactor the parser", 50),
	];

	it("matches a plain prefix", () => {
		expect(text(findCompletion("run the tes", candidates))).toBe("run the tests");
	});

	it("completes a prefix from history", () => {
		const only = [at("refactor the auth middleware and add tests", 100)];
		expect(text(findCompletion("refactor the auth mid", only))).toBe("refactor the auth middleware and add tests");
	});

	it("prefers the most recent candidate when several match", () => {
		// A later, shorter prompt wins over an earlier, longer one: recency is the
		// signal, and the user can always keep typing to narrow it.
		const overlapping: CompletionCandidate[] = [
			at("refactor the auth middleware and add tests", 100),
			at("refactor the auth middleware", 200),
		];
		expect(text(findCompletion("refactor the auth mid", overlapping))).toBe("refactor the auth middleware");
	});

	it("breaks a recency tie with the longer candidate", () => {
		const tied: CompletionCandidate[] = [at("ship it now", 5), at("ship it now please", 5)];
		// The longer candidate represents the tier, but only as far as the shorter
		// one agrees: " now" is beyond dispute, " please" is not.
		expect(text(findCompletion("ship it", tied))).toBe("ship it now");
	});

	it("returns nothing below the minimum draft length", () => {
		expect(findCompletion("ref", candidates)).toBeUndefined();
		// The floor is configurable, and a caller may lower it deliberately.
		expect(text(findCompletion("ru", [at("run the tests", 1)], { minChars: 2 }))).toBe("run the tests");
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

	it("collapses the candidate's whitespace and composes the answer in the draft's casing", () => {
		const cased = [at("Refactor   The Auth Middleware", 5)];
		// Comparison is whitespace- and case-insensitive, and the answer is the
		// draft as typed plus the collapsed tail — never a candidate's casing grafted
		// onto a draft that was typed differently.
		expect(text(findCompletion("refactor the auth", cased))).toBe("refactor the auth Middleware");
		// Whitespace typed into the draft is collapsed the same way, so the suffix is
		// measured against the normalised form on both sides.
		expect(text(findCompletion("refactor   the   auth", cased))).toBe("refactor the auth Middleware");
	});

	it("handles an empty corpus", () => {
		expect(findCompletion("anything at all", [])).toBeUndefined();
	});
});

describe("findCompletion length rule", () => {
	it("paints the whole agreed tail when a single corpus candidate matches", () => {
		const only = [at("refactor the auth middleware and add tests", 100)];
		const suggestion = findCompletion("refactor the auth mid", only);
		expect(text(suggestion)).toBe("refactor the auth middleware and add tests");
		expect(suggestion?.candidateCount).toBe(1);
		expect(suggestion?.source).toBe("corpus");
		// One candidate: agreed === bestRemainder, so the corpus-never-extends rule
		// still paints the whole continuation. Confidence is raw agreement (1).
		expect(suggestion?.confidence).toBe(1);
	});

	it("paints only the agreed part when two candidates diverge", () => {
		// The remainder of the better-ranked candidate is 21 chars, of which the two
		// agree on the first 16 — agreement lands at the extend gate, but corpus
		// never extends, so the contested tail stays off.
		const divergent: CompletionCandidate[] = [
			at("refactor the auth middleware and add tests", 300),
			at("refactor the auth middleware and add docs", 200),
		];
		const suggestion = findCompletion("refactor the auth mid", divergent);

		expect(text(suggestion)).toBe("refactor the auth middleware and add ");
		expect(text(suggestion)).not.toBe("refactor the auth middleware and add tests");
		expect(suggestion?.source).toBe("corpus");
		expect(suggestion?.confidence).toBeGreaterThanOrEqual(COMPOSER_COMPLETION_FLOOR);
	});

	it("never extends a contested corpus field even when agreement is high", () => {
		// Two corpus candidates agree on almost everything; session tier would
		// extend, corpus must stop at the agreed prefix.
		const agreeing: CompletionCandidate[] = [
			at("deploy the worker to staging and watch the logs", 100),
			at("deploy the worker to staging and watch the queue", 90),
		];
		const suggestion = findCompletion("deploy the worker to", agreeing);
		expect(suggestion?.source).toBe("corpus");
		expect(text(suggestion)).toBe("deploy the worker to staging and watch the ");
		expect(text(suggestion)).not.toBe("deploy the worker to staging and watch the logs");
	});

	it("paints the whole tail when the session's own candidates agree", () => {
		const agreeing: CompletionCandidate[] = [
			at("deploy the worker to staging and watch the logs", 100, "/sessions/session-a.jsonl"),
			at("deploy the worker to staging and watch the queue", 90, "/sessions/session-a.jsonl"),
		];
		const suggestion = findCompletion("deploy the worker to", agreeing, { sessionId: "session-a" });

		expect(text(suggestion)).toBe("deploy the worker to staging and watch the logs");
		expect(suggestion?.source).toBe("session");
		// In-session, 22 of the 27 agreed characters is enough to commit to the rest.
		expect(suggestion?.confidence).toBeGreaterThanOrEqual(COMPOSER_COMPLETION_EXTEND_CONFIDENCE);
	});

	it("offers nothing when the candidates share too little", () => {
		const noAgreement: CompletionCandidate[] = [
			at("refactor the auth middleware", 300),
			at("refactor the database layer", 200),
		];
		expect(findCompletion("refactor the", noAgreement)).toBeUndefined();
	});

	it("offers nothing when the candidates are only barely agreeing", () => {
		// "sts now" against "st suite": two agreed characters out of the seven the
		// shortest candidate offers, which lands under the floor.
		const barely: CompletionCandidate[] = [at("run the tests now", 300), at("run the test suite", 200)];
		expect(findCompletion("run the te", barely)).toBeUndefined();
	});

	it("offers nothing when the candidates agree on nothing beyond the draft", () => {
		const split: CompletionCandidate[] = [at("run the tests", 300), at("run the tempos", 200)];
		expect(findCompletion("run the te", split)).toBeUndefined();
	});

	it("scales the confidence with how much the candidates agree", () => {
		const shape = (tailA: string, tailB: string): CompletionCandidate[] => [
			at(`summarise the incident report and ${tailA}`, 100, "/s.jsonl"),
			at(`summarise the incident report and ${tailB}`, 90, "/s.jsonl"),
		];
		// "timeline" against "timelines": the shorter tail is a prefix of the longer,
		// so nothing is in dispute.
		const aligned = findCompletion("summarise the incident report", shape("timeline", "timelines"), {
			sessionId: "s",
		});
		// "timeline" against "timetable": only " time" is shared.
		const split = findCompletion("summarise the incident report", shape("timeline", "timetable"), { sessionId: "s" });
		expect(aligned?.confidence).toBe(1);
		expect(split?.confidence).toBeGreaterThanOrEqual(COMPOSER_COMPLETION_FLOOR);
		expect(aligned?.confidence).toBeGreaterThan(split?.confidence ?? 1);
	});

	it("reports the same confidence for identical agreement regardless of tier", () => {
		const shape = (sessionFile?: string): CompletionCandidate[] => [
			at("deploy the worker to staging and watch the logs", 100, sessionFile),
			at("deploy the worker to staging and watch the queue", 90, sessionFile),
		];
		const session = findCompletion("deploy the worker to", shape("/sessions/s.jsonl"), { sessionId: "s" });
		const corpus = findCompletion("deploy the worker to", shape());
		expect(session?.confidence).toBe(corpus?.confidence);
		// Length policy differs: session extends; corpus stops at the agreed prefix.
		expect(text(session)).toBe("deploy the worker to staging and watch the logs");
		expect(text(corpus)).toBe("deploy the worker to staging and watch the ");
	});
});

describe("session tiering", () => {
	const sessionFile = "/Users/dev/.fleet/sessions/session-a.jsonl";

	it("prefers this session's own prompt over a more recent one from elsewhere", () => {
		const mixed: CompletionCandidate[] = [
			at("deploy the worker to staging and restart the queue", 999),
			at("deploy the worker to staging", 1, sessionFile),
		];
		const suggestion = findCompletion("deploy the work", mixed, { sessionId: "session-a" });
		expect(text(suggestion)).toBe("deploy the worker to staging");
		expect(suggestion?.source).toBe("session");
		expect(suggestion?.candidateCount).toBe(1);
	});

	it("falls back to the corpus when this session has nothing", () => {
		// Another session's prompt is corpus here, not session: it is offered, but
		// only as far as it agrees with the rest of the corpus.
		const mixed: CompletionCandidate[] = [at("deploy the worker to staging", 1, sessionFile)];
		const suggestion = findCompletion("deploy the work", mixed, { sessionId: "session-b" });
		expect(text(suggestion)).toBe("deploy the worker to staging");
		expect(suggestion?.source).toBe("corpus");
	});

	it("treats another session's prompt as corpus, not as a session tier", () => {
		const mixed: CompletionCandidate[] = [
			at("deploy the worker to staging and restart the queue", 999),
			at("deploy the worker to staging", 1, sessionFile),
		];
		const suggestion = findCompletion("deploy the work", mixed, { sessionId: "session-b" });
		expect(suggestion?.source).toBe("corpus");
		expect(suggestion?.candidateCount).toBe(2);
	});

	it("falls back to the corpus when no session is named", () => {
		const mixed: CompletionCandidate[] = [at("deploy the worker to staging", 1, sessionFile)];
		const suggestion = findCompletion("deploy the work", mixed);
		expect(suggestion?.source).toBe("corpus");
	});

	it("does not mistake a session id for a prefix of another", () => {
		// `session-a` must not match `session-ab`'s file, which ends with a different
		// basename even though the string contains it.
		const other = "/Users/dev/.fleet/sessions/session-ab.jsonl";
		const mixed: CompletionCandidate[] = [at("deploy the worker to staging", 1, other)];
		expect(findCompletion("deploy the work", mixed, { sessionId: "session-a" })?.source).toBe("corpus");
	});

	it("matches session id stamped on the candidate without a path", () => {
		const stamped: CompletionCandidate[] = [{ text: "deploy the worker to staging", at: 1, sessionId: "session-a" }];
		expect(findCompletion("deploy the work", stamped, { sessionId: "session-a" })?.source).toBe("session");
	});

	it("matches a Windows-style session path via basename", () => {
		const win = [at("deploy the worker to staging", 1, "C:\\Users\\dev\\.fleet\\sessions\\session-a.jsonl")];
		expect(findCompletion("deploy the work", win, { sessionId: "session-a" })?.source).toBe("session");
	});
});

describe("longestCommonPrefix", () => {
	it("returns the shared prefix in the first value's casing", () => {
		expect(longestCommonPrefix(["Refactor The", "refactor the auth"])).toBe("Refactor The");
	});

	it("handles a single value, an empty list, and an empty string", () => {
		expect(longestCommonPrefix(["abc"])).toBe("abc");
		expect(longestCommonPrefix([])).toBe("");
		expect(longestCommonPrefix(["", "abc"])).toBe("");
		expect(longestCommonPrefix(["abc", ""])).toBe("");
	});

	it("stops at the shorter value", () => {
		expect(longestCommonPrefix(["ab", "abc"])).toBe("ab");
	});

	it("returns nothing when the values diverge immediately", () => {
		expect(longestCommonPrefix(["alpha", "beta"])).toBe("");
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
