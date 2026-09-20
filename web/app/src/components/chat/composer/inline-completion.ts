/**
 * Inline completion (ghost text) for the composer.
 *
 * There is one suggestion surface. A completion is either an `append` — history
 * that extends the draft — or a `replace` — a recognised command, which does not.
 * Both are accepted with Tab.
 *
 * Pure logic and the shared text-metric recipe. The ghost is painted by a second
 * mirror of the textarea, so the only thing keeping the ghost under the caret is
 * that the mirror, the measurement div and the textarea wrap identically. They
 * therefore all read {@link PROMPT_TEXT_METRICS}; never write those tokens out
 * by hand, and never let one node drift from the others.
 */
import type { ComposerCompletionMode } from "@prime-agent/web-protocol/composer-completion";

/**
 * The text metric recipe shared by the textarea, its auto-resize measurement
 * mirror, and the ghost mirror.
 *
 * `whitespace-pre-wrap` and `overflow-wrap:break-word` are already the user-agent
 * values for `textarea`, so repeating them there is a no-op in the browser that
 * turns an implicit dependency into an enforced one.
 */
export const PROMPT_TEXT_METRICS = "px-2 text-sm leading-6 whitespace-pre-wrap [overflow-wrap:break-word]";

/** Opposite the ghost's dimmed colour so only the ghost itself is painted. */
export const PROMPT_GHOST_PREFIX_CLASS = "text-transparent";
export const PROMPT_GHOST_CLASS = "text-foreground/55";

/**
 * An offered completion.
 *
 * `forValue` is the draft the completion was computed against. It is required,
 * not incidental: the draft reaches the provider through a debounce, so without
 * this gate a completion computed for `"ship"` would still be painted after the
 * user typed `"x"`, proposing a sentence the provider never saw. One string
 * comparison is the whole staleness mechanism.
 */
export type InlineCompletion = {
	forValue: string;
	text: string;
	/** `append` splices the text on; `replace` sets the draft to it. */
	mode: ComposerCompletionMode;
	onAccept?: (next: string) => void;
	onDismiss?: () => void;
};

/** Live textarea editing state, published by native listeners on the element. */
export type EditingState = {
	focused: boolean;
	composing: boolean;
	/** `null` means "unknown", which fails closed. */
	caretStart: number | null;
	caretEnd: number | null;
};

export const INITIAL_EDITING_STATE: EditingState = {
	focused: false,
	composing: false,
	caretStart: null,
	caretEnd: null,
};

/** Referential-stability helper so the caret publisher can skip no-op renders. */
export function sameEditingState(a: EditingState, b: EditingState): boolean {
	return (
		a.focused === b.focused &&
		a.composing === b.composing &&
		a.caretStart === b.caretStart &&
		a.caretEnd === b.caretEnd
	);
}

export type InlineCompletionContext = {
	completion: InlineCompletion | undefined;
	/** The live composer value. */
	value: string;
	editing: EditingState;
	streaming: boolean;
	disabled: boolean;
	/** A `/` or `@` trigger menu is open and owns the interaction. */
	triggerOpen: boolean;
	/** Set once the user has dismissed this exact draft's completion. */
	dismissed: { forValue: string; text: string } | undefined;
};

/**
 * Decides whether a completion should be painted, and which text.
 *
 * Returning `null` rather than an empty string keeps "nothing to show" and
 * "show nothing" the same state, so Tab can never be swallowed with nothing to
 * accept. Every reason to hide lives here so that the render gate and the
 * accept path cannot disagree — which is why the accepted `mode` travels back
 * out with the text rather than being re-read from the prop by the accept path.
 */
export function resolveInlineCompletion(
	context: InlineCompletionContext,
): { text: string; mode: ComposerCompletionMode } | null {
	const { completion, value, editing } = context;
	if (!completion) return null;
	// Stale, or already accepted.
	if (completion.forValue !== value) return null;

	const text = completion.text;
	// An invisible ghost would trap Tab.
	if (text.length === 0 || text.trim().length === 0) return null;
	// Already present: appending would duplicate it. A `replace` is not a
	// duplicate, and a draft merely *ending* with the command is the case
	// replacement exists for ("please run the /compact"), so the guard is
	// append-only. Applied to both modes it would hide an offer the command chip
	// used to make.
	if (completion.mode !== "replace" && value.endsWith(text)) return null;
	if (value.length === 0) return null;

	if (context.streaming || context.disabled) return null;
	if (context.triggerOpen) return null;

	if (context.dismissed && context.dismissed.forValue === value && context.dismissed.text === text) return null;

	// Fail closed on an unknown caret: hiding is benign, painting in the wrong
	// place is not.
	if (!editing.focused || editing.composing) return null;
	if (editing.caretStart === null || editing.caretEnd === null) return null;
	// A pending replacement, not a caret.
	if (editing.caretStart !== editing.caretEnd) return null;
	// Drafting happens at the end of the text. Anywhere else the completion was
	// conditioned on a draft whose end is not where the text would be inserted.
	if (editing.caretStart !== value.length) return null;

	return { text, mode: completion.mode };
}

/**
 * Applies an accepted completion.
 *
 * Trivial because {@link resolveInlineCompletion} has already established that
 * the caret is at the end; it exists as a named function so the contract has
 * exactly one home if mid-string insertion is ever enabled.
 *
 * `mode` defaults to `append` so a caller that predates commands cannot
 * silently stop splicing.
 */
export function spliceCompletion(value: string, text: string, mode: ComposerCompletionMode = "append"): string {
	return mode === "replace" ? text : `${value}${text}`;
}

/**
 * The ghost as painted after the draft.
 *
 * For `append` this is the completion itself. For `replace` the draft is not a
 * prefix of the suggestion, so painting the two flush would run them together
 * into one unreadable string ("make this shorter/compact"); a separating space
 * is inserted when the draft does not already end in whitespace.
 *
 * The separator is display-only. The accepted text is the completion alone, so
 * it never reaches the draft.
 */
export function ghostPaintText(
	value: string,
	completion: { text: string; mode: ComposerCompletionMode } | null,
): string | undefined {
	if (!completion) return undefined;
	if (completion.mode === "append") return completion.text;
	return /\s$/.test(value) ? completion.text : ` ${completion.text}`;
}
