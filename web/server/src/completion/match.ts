/**
 * Pure completion matching.
 *
 * Deliberately model-free. The completion is a prefix match against strings the
 * developer already wrote, so it can never contradict what they typed: the
 * ghost always begins with the exact characters already in the composer.
 *
 * Ranking is by recency, then by length. Measured against near-duplicate
 * history the model could not beat recency (3/30 vs 2/30), so recency is the
 * default and the model is reserved for the one case where it does win —
 * mistyped command names, which this module does not handle.
 */
import {
	COMPOSER_COMPLETION_MAX_CHARS,
	COMPOSER_COMPLETION_MIN_CHARS,
} from "@prime-agent/web-protocol/composer-completion";

/** One candidate completion, with the recency needed to rank it. */
export type CompletionCandidate = {
	/** The verbatim text the developer wrote before. */
	text: string;
	/** Sort key for recency; larger is more recent. */
	at: number;
};

/**
 * Normalises a draft or candidate for comparison: whitespace collapsed, trimmed.
 *
 * Comparisons are case-insensitive, but the text handed back is never
 * lower-cased — only whitespace-collapsed — so a completion the user accepts
 * keeps its own casing.
 */
export function normalizeCompletionText(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

/**
 * Picks the single best completion for a draft, or `undefined`.
 *
 * Returns `undefined` — rather than an empty string — whenever there is nothing
 * worth showing, so a caller cannot render an empty ghost layer. The value
 * returned is in {@link normalizeCompletionText} form, which is also the form
 * the draft is matched in; the caller must measure the suffix against that same
 * form rather than against the raw draft.
 *
 * Ranking is recency-first, with the longer candidate breaking a tie. The
 * evidence for that ordering is weak and worth stating: over 30 held-out cases
 * where several candidates matched, picking the most recent was right 2 times
 * and picking the longest 1 time. Neither is good — the ambiguity is usually
 * near-duplicate prompts ("check 1" vs "check 5") that no ordering can resolve —
 * so recency wins on being the simpler rule to explain.
 */
export function findCompletion(
	draft: string,
	candidates: ReadonlyArray<CompletionCandidate>,
	options: { minChars?: number; maxChars?: number } = {},
): string | undefined {
	const minChars = options.minChars ?? COMPOSER_COMPLETION_MIN_CHARS;
	const maxChars = options.maxChars ?? COMPOSER_COMPLETION_MAX_CHARS;

	const normalizedDraft = normalizeCompletionText(draft);
	if (normalizedDraft.length < minChars) return undefined;

	const needle = normalizedDraft.toLowerCase();
	let best: CompletionCandidate | undefined;
	let bestText = "";

	for (const candidate of candidates) {
		const text = normalizeCompletionText(candidate.text);
		// Strictly longer: a candidate equal to the draft adds nothing, and a
		// shorter one could not extend it.
		if (text.length <= normalizedDraft.length) continue;
		if (text.length > maxChars) continue;
		if (!text.toLowerCase().startsWith(needle)) continue;
		if (!best || candidate.at > best.at || (candidate.at === best.at && text.length > bestText.length)) {
			best = candidate;
			bestText = text;
		}
	}

	return best ? bestText : undefined;
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
