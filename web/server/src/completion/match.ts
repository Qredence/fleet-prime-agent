/**
 * Pure completion matching.
 *
 * Deliberately model-free. A history completion is a prefix match against strings
 * the developer already wrote, so it can never contradict what they typed: the
 * ghost always begins with the exact characters already in the composer.
 *
 * How *long* the suggestion is comes from how far the matching candidates agree
 * with each other — and from which tier won. Session-tier suggestions may extend
 * to the whole best remainder when agreement is high; corpus-tier suggestions
 * always stop at the agreed prefix. Softening corpus confidence with a discount
 * and then comparing to the same extend threshold made "extend" unreachable for
 * corpus while pretending the three-band rule still applied.
 *
 * The confidence is a code heuristic, not a calibrated probability, and it is
 * never compared against the router's — that one is a model probability on a
 * different scale. See `web/protocol/src/composer-completion.ts`.
 *
 * Choosing *which* candidate represents the tier is still recency-first, and the
 * evidence for that rule is weak and worth restating: over 30 held-out cases where
 * several candidates matched, the most recent was right 2 times and the longest
 * 1 time. Near-duplicate prompts ("check 1" vs "check 5") are genuinely
 * unresolvable, so this only picks which candidate's tail to offer — it no longer
 * decides how much of it to show.
 */
import {
	COMPOSER_COMPLETION_EXTEND_CONFIDENCE,
	COMPOSER_COMPLETION_FLOOR,
	COMPOSER_COMPLETION_MAX_CHARS,
	COMPOSER_COMPLETION_MIN_CHARS,
	normalizeCompletionDraft,
} from "@prime-agent/web-protocol/composer-completion";

/** One candidate completion, with the recency needed to rank it. */
export type CompletionCandidate = {
	/** The verbatim text the developer wrote before. */
	text: string;
	/** Sort key for recency; larger is more recent. */
	at: number;
	/** The session this prompt came from, when the corpus knows it. */
	sessionFile?: string;
	/** Session id stamped at flatten time; preferred over parsing `sessionFile`. */
	sessionId?: string;
};

/** A completion worth showing, and how much to trust it. */
export type CompletionSuggestion = {
	/** The full text the draft should become when accepted. */
	completion: string;
	/** `0`–`1`, derived from candidate agreement. */
	confidence: number;
	/** The tier the suggestion came from. */
	source: "session" | "corpus";
	/** How many candidates agreed closely enough to be counted. */
	candidateCount: number;
};

export type FindCompletionOptions = {
	minChars?: number;
	maxChars?: number;
	/** The session being typed in. Its own prompts win outright. */
	sessionId?: string;
	/**
	 * Confidence below which nothing is offered.
	 *
	 * Overridable so `scripts/eval-composer-completion.ts` can measure the
	 * counterfactual rules — "never commit to a contested tail", "always commit" —
	 * by re-running this function rather than by reimplementing it. An evaluation
	 * that copies the logic it is evaluating measures the copy.
	 */
	floor?: number;
	/** Confidence at or above which a session-tier representative's whole tail is offered. */
	extendConfidence?: number;
};

/**
 * Normalises a draft or candidate for comparison: whitespace collapsed, trimmed.
 *
 * Comparisons are case-insensitive and whitespace-insensitive; only collapsing
 * and trimming happen here. `findCompletion` then composes its answer as the
 * normalised draft plus the agreed suffix, so the casing the developer typed is
 * the casing they keep — the client splices the same way, and a completion the
 * server composed differently would be a second, unreachable version of the
 * same string.
 */
export function normalizeCompletionText(text: string): string {
	return normalizeCompletionDraft(text);
}

/** Longest prefix shared by every value, case-insensitively, in the first value's casing. */
export function longestCommonPrefix(values: ReadonlyArray<string>): string {
	const first = values[0];
	if (first === undefined) return "";
	let prefix = first;
	for (let index = 1; index < values.length; index += 1) {
		const value = values[index] ?? "";
		const limit = Math.min(prefix.length, value.length);
		let shared = 0;
		while (shared < limit && prefix[shared]?.toLowerCase() === value[shared]?.toLowerCase()) shared += 1;
		prefix = prefix.slice(0, shared);
		if (prefix.length === 0) break;
	}
	return prefix;
}

/** Session id from a session file path (`…/<id>.jsonl`), tolerant of `/` and `\\`. */
export function sessionIdFromFile(sessionFile: string): string {
	const base = sessionFile.split(/[/\\]/).pop() ?? "";
	return base.replace(/\.jsonl$/i, "");
}

/** Whether a candidate came from the session currently being typed in. */
function isFromSession(candidate: CompletionCandidate, sessionId: string | undefined): boolean {
	if (!sessionId) return false;
	if (candidate.sessionId) return candidate.sessionId === sessionId;
	if (!candidate.sessionFile) return false;
	return sessionIdFromFile(candidate.sessionFile) === sessionId;
}

/**
 * Picks the completion to offer for a draft, or `undefined`.
 *
 * `undefined` — never an empty string — means show nothing, so a caller cannot
 * paint an empty ghost.
 */
export function findCompletion(
	draft: string,
	candidates: ReadonlyArray<CompletionCandidate>,
	options: FindCompletionOptions = {},
): CompletionSuggestion | undefined {
	const minChars = options.minChars ?? COMPOSER_COMPLETION_MIN_CHARS;
	const maxChars = options.maxChars ?? COMPOSER_COMPLETION_MAX_CHARS;

	const normalizedDraft = normalizeCompletionText(draft);
	if (normalizedDraft.length < minChars) return undefined;
	const needle = normalizedDraft.toLowerCase();

	const matched: Array<{ candidate: CompletionCandidate; text: string }> = [];
	for (const candidate of candidates) {
		const text = normalizeCompletionText(candidate.text);
		// Strictly longer: equal adds nothing, shorter could not extend it.
		if (text.length <= normalizedDraft.length) continue;
		if (text.length > maxChars) continue;
		if (!text.toLowerCase().startsWith(needle)) continue;
		matched.push({ candidate, text });
	}
	if (matched.length === 0) return undefined;

	// This session first; the cross-session corpus only supplies a suggestion when
	// the session being typed in has nothing that matches. A fresh session
	// therefore behaves exactly as it did before.
	const sessionMatches = matched.filter((entry) => isFromSession(entry.candidate, options.sessionId));
	const tier = sessionMatches.length > 0 ? sessionMatches : matched;
	const source: CompletionSuggestion["source"] = sessionMatches.length > 0 ? "session" : "corpus";

	// Recency first, then length. Copy before sort so corpus-tier ranking never
	// mutates the shared `matched` array through an alias.
	const ranked = [...tier].sort((a, b) => b.candidate.at - a.candidate.at || b.text.length - a.text.length);
	const best = ranked[0];
	if (!best) return undefined;
	const bestRemainder = best.text.slice(normalizedDraft.length);

	// The part every candidate agrees on, in the best candidate's casing. The best
	// candidate is first so the shared prefix inherits its casing.
	const remainders = [
		bestRemainder,
		...ranked.filter((entry) => entry !== best).map((entry) => entry.text.slice(normalizedDraft.length)),
	];
	const agreed = longestCommonPrefix(remainders);
	// Nothing shared beyond the draft means any suggestion would be a guess.
	if (agreed.length === 0) return undefined;

	// How far the *field* agrees, measured against the shortest continuation any
	// candidate offers rather than against the representative's own tail. The
	// representative's tail is the obvious denominator and the wrong one: it
	// penalises length diversity, so "ship it now" alongside "ship it now please"
	// would score 4/11 and paint nothing even though " now" is beyond dispute —
	// exactly the case the agreed-prefix rule exists to serve. A long candidate is
	// not evidence against the short one.
	const shortestRemainder = Math.min(...remainders.map((remainder) => remainder.length));
	const agreement = shortestRemainder === 0 ? 0 : agreed.length / shortestRemainder;
	const confidence = Math.min(1, agreement);
	if (confidence < (options.floor ?? COMPOSER_COMPLETION_FLOOR)) return undefined;

	// Corpus never extends: only the agreed prefix. Session may take the whole
	// representative tail once agreement clears the extend gate.
	const extendConfidence = options.extendConfidence ?? COMPOSER_COMPLETION_EXTEND_CONFIDENCE;
	const ghost = source === "corpus" ? agreed : confidence >= extendConfidence ? bestRemainder : agreed;
	return {
		completion: normalizedDraft + ghost,
		confidence,
		source,
		candidateCount: ranked.length,
	};
}

/**
 * Harvests the candidate completions out of one session's messages.
 *
 * Only user-authored text is kept; assistant output is never indexed. Entries
 * that are harness scaffolding, placeholder labels, or too long to be a prompt a
 * person would retype are dropped.
 */
export function harvestPromptCandidates(
	messages: ReadonlyArray<{ role?: string; text: string }>,
	at: number,
	maxChars: number = COMPOSER_COMPLETION_MAX_CHARS,
): Array<CompletionCandidate> {
	const out: Array<CompletionCandidate> = [];
	for (const message of messages) {
		if (message.role !== "user") continue;
		const text = normalizeCompletionText(message.text);
		if (text.length < 8 || text.length > maxChars) continue;
		// Harness scaffolding and injected context are not written by a person.
		if (text.startsWith("<") || text.startsWith("[harness") || text.includes("<harness_state>")) continue;
		out.push({ text, at });
	}
	return out;
}
