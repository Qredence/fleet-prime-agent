/**
 * Composer ghost-text completion vocabulary.
 *
 * The composer offers one inline suggestion, painted after the caret, which Tab
 * accepts. There are two kinds, and they differ in what accepting means:
 *
 * - `append` — a completion drawn from the developer's own earlier prompts via
 *   `POST /api/chat/completion`. It always extends what was typed, so accepting
 *   splices it on. That endpoint never returns a mode — history is append-only.
 * - `replace` — a built-in command recognised behind a description by the intent
 *   router in the browser. It does not travel through the completion payload.
 *   Accepting replaces the draft; it does not run the command.
 *
 * Completion over history is model-free. Measured on 616 real prompt
 * occurrences, a model asked to choose between near-duplicate history candidates
 * scored no better than "most recent" (3/30 vs 2/30), so the length of a history
 * suggestion is instead driven by how far the matching candidates agree with each
 * other — see `completion/match.ts`. Command recognition does use the model,
 * because that is the one place it measurably wins, and it supplies its own
 * calibrated confidence.
 */

/** Nothing is asked of the server below this many characters. */
export const COMPOSER_COMPLETION_MIN_CHARS = 4;

/**
 * Longest completion the server will offer. A ghost that fills the composer is
 * worse than no ghost, so the corpus is capped rather than the display.
 */
export const COMPOSER_COMPLETION_MAX_CHARS = 200;

/**
 * Below this, nothing is shown. A suggestion needs enough agreement among the
 * matching candidates to be worth painting at all.
 */
export const COMPOSER_COMPLETION_FLOOR = 0.5;

/**
 * At or above this, a **session-tier** suggestion offers the whole best
 * candidate; between the floor and this, only the part every candidate agrees
 * on. Corpus-tier suggestions never extend — they always paint the agreed
 * prefix only.
 */
export const COMPOSER_COMPLETION_EXTEND_CONFIDENCE = 0.8;

/** Where an offered suggestion came from. */
export type ComposerCompletionSource =
	/** An earlier prompt from the session being typed in. */
	| "session"
	/** An earlier prompt from any other session. */
	| "corpus";

/**
 * What accepting the suggestion does to the draft.
 *
 * Used by the browser's inline surface. History completions are always
 * `append`; `replace` is synthesised locally from the intent router.
 */
export type ComposerCompletionMode = "append" | "replace";

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
	/**
	 * The session being typed in, so its own earlier prompts can be preferred
	 * over the cross-session corpus. Absent in a session with no identity yet.
	 */
	sessionId?: string;
	projectId?: string;
};

/**
 * Response for `POST /api/chat/completion`.
 *
 * Carries a verbatim string and its provenance — never model prose, question
 * instructions, or transport error text. An absent `completion` is the ordinary
 * answer. There is no `mode`: this endpoint always extends the draft.
 */
export type ComposerCompletionResponse = {
	/** The full text the draft should become when accepted. */
	completion?: string;
	/**
	 * `0`–`1`, always agreement-derived (see `completion/match.ts`).
	 *
	 * Deliberately not the router's calibrated model probability: that one is on a
	 * different scale and never enters this payload, and the two are never compared
	 * numerically. Preferring a command over a history completion is a rule about
	 * provenance, not a max().
	 */
	confidence?: number;
	source?: ComposerCompletionSource;
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
 * In `append` mode the completion must extend the draft: one that does not begin
 * with what was typed would have to replace it. In `replace` mode that is
 * exactly the point, so the whole completion is painted.
 */
export function composerCompletionGhost(
	draft: string,
	completion: string | undefined,
	mode: ComposerCompletionMode = "append",
): string | undefined {
	if (!completion) return undefined;
	const normalizedCompletion = normalizeCompletionDraft(completion);
	if (mode === "replace") return normalizedCompletion.length > 0 ? normalizedCompletion : undefined;

	const normalizedDraft = normalizeCompletionDraft(draft);
	if (normalizedCompletion.length <= normalizedDraft.length) return undefined;
	if (!normalizedCompletion.toLowerCase().startsWith(normalizedDraft.toLowerCase())) return undefined;
	const suffix = normalizedCompletion.slice(normalizedDraft.length);
	// The comparison is done on a trimmed draft, so a draft that already ends in
	// whitespace would otherwise gain a second space when the suffix is appended.
	return /\s$/.test(draft) ? suffix.replace(/^\s+/, "") : suffix;
}
