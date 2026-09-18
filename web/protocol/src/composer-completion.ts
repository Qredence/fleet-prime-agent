/**
 * Composer ghost-text completion vocabulary.
 *
 * The composer can offer an inline completion after the caret that Tab accepts.
 *
 * A completion is always a **verbatim copy** of a string the developer already
 * wrote, never generated text — System One models return typed judgments rather
 * than prose, so "code finds candidates, the model only selects" is the only
 * architecture available, and here it is also the right one. Measured on 616
 * real prompt occurrences from this machine's session history:
 *
 * - prefix matching over the 50 most recently updated sessions completes 64% of
 *   drafts at eight typed characters, at zero latency;
 * - a model asked to choose between near-duplicate history candidates scored no
 *   better than "most recent" (3/30 vs 2/30);
 * - a model asked to guess a command from a 40%-typed draft was *confidently*
 *   wrong (7/14 genuine tasks mis-suggested, and tasks scored higher confidence
 *   than commands).
 *
 * So this layer is model-free by design. The one place the model measurably
 * wins — recognising a mistyped command token — is already served by the
 * composer intent router, which offers those through its suggestion chip.
 */

/** Nothing is asked of the server below this many characters. */
export const COMPOSER_COMPLETION_MIN_CHARS = 4;

/**
 * Longest completion the server will offer. A ghost that fills the composer is
 * worse than no ghost, so the corpus is capped rather than the display.
 */
export const COMPOSER_COMPLETION_MAX_CHARS = 200;

/**
 * True when a draft is already owned by another interaction, or is not prose.
 * The `/` and `@` trigger popovers own those keystrokes, and returning nothing
 * here is what keeps Tab from being double-booked by construction.
 */
export function composerCompletionIgnores(draft: string): boolean {
	if (draft.trimStart().startsWith("/")) return true;
	// A trailing, still-open @mention token.
	return /(?:^|\s)@[^\s@]*$/.test(draft);
}

/** Request body for `POST /api/chat/completion`. */
export type ComposerCompletionRequest = {
	/** The composer draft. Truncated server-side before any matching runs. */
	text: string;
	projectId?: string;
};

/**
 * Response for `POST /api/chat/completion`.
 *
 * Carries a verbatim string or nothing at all — never model prose, question
 * instructions, probabilities, or transport error text. An absent `completion`
 * is the ordinary answer.
 */
export type ComposerCompletionResponse = {
	/** The full text the draft should become when accepted. */
	completion?: string;
};

/**
 * The comparison form of a draft: trimmed, whitespace collapsed.
 *
 * The server matches and returns completions in this form, so the client must
 * measure the suffix against the same form rather than against the raw text the
 * user typed. Otherwise a draft with irregular spacing would be rejected, or
 * worse, spliced at the wrong offset.
 */
export function normalizeCompletionDraft(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

/**
 * The text to render after the caret, or `undefined` when there is nothing
 * worth showing.
 *
 * Returns `undefined` rather than an empty string, and requires the completion
 * to extend the draft: a string that does not begin with what the developer has
 * already typed would have to *replace* it, which is a different interaction
 * (that is the intent router's chip, not an inline ghost).
 */
export function composerCompletionGhost(draft: string, completion: string | undefined): string | undefined {
	if (!completion) return undefined;
	const normalizedDraft = normalizeCompletionDraft(draft);
	const normalizedCompletion = normalizeCompletionDraft(completion);
	if (normalizedCompletion.length <= normalizedDraft.length) return undefined;
	if (!normalizedCompletion.toLowerCase().startsWith(normalizedDraft.toLowerCase())) return undefined;
	const suffix = normalizedCompletion.slice(normalizedDraft.length);
	// The comparison is done on a trimmed draft, so a draft that already ends in
	// whitespace would otherwise gain a second space when the suffix is appended.
	return /\s$/.test(draft) ? suffix.replace(/^\s+/, "") : suffix;
}
