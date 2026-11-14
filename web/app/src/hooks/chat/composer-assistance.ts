import {
	COMPOSER_COMPLETION_MIN_CHARS,
	composerCompletionGhost,
	composerCompletionIgnores,
	normalizeCompletionDraft,
} from "@prime-agent/web-protocol/composer-completion";
import {
	type ComposerIntentKeySource,
	type ComposerIntentResponse,
	composerIntentCommand,
} from "@prime-agent/web-protocol/composer-intent";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatClient } from "@/lib/chat/chat-client";
import type { InlineCompletion } from "@/hooks/chat/inline-completion";

/**
 * Draft-keyed cache shared by the composer's speculative request hooks.
 *
 * Intent routing and history completion each own an instance of this bounded,
 * expiring cache. Shared normalization keeps client and server lookups aligned.
 */

/** Entries kept before the least recently read one is evicted. */
export const COMPOSER_DRAFT_CACHE_LIMIT = 32;

/** How long an answer stays usable. */
export const COMPOSER_DRAFT_CACHE_TTL_MS = 5 * 60_000;

/**
 * Cache key for a draft.
 *
 * `normalizeCompletionDraft` collapses whitespace exactly as the server does;
 * lowercasing on top matches the intent router's `normalizeIntentText`. A draft
 * that differs only in spacing or case is the same question, so it is the same
 * key.
 */
export function draftCacheKey(text: string): string {
	return normalizeCompletionDraft(text).toLowerCase();
}

export type DraftCache<T> = {
	/** The entry for `key`, or `undefined` when absent or expired. */
	read: (key: string) => T | undefined;
	remember: (key: string, value: T) => void;
	clear: () => void;
};

/**
 * Creates a bounded cache that expires entries after `ttlMs` and evicts the
 * least recently read entry once `limit` is reached.
 *
 * @param options - Override the defaults; `now` exists for deterministic tests.
 */
export function createDraftCache<T>(options?: { limit?: number; ttlMs?: number; now?: () => number }): DraftCache<T> {
	const limit = options?.limit ?? COMPOSER_DRAFT_CACHE_LIMIT;
	const ttlMs = options?.ttlMs ?? COMPOSER_DRAFT_CACHE_TTL_MS;
	const now = options?.now ?? Date.now;
	const entries = new Map<string, { value: T; at: number }>();

	const read = (key: string): T | undefined => {
		const entry = entries.get(key);
		if (!entry) return undefined;
		if (now() - entry.at > ttlMs) {
			entries.delete(key);
			return undefined;
		}
		// Re-insert so the least recently read key is the one evicted next.
		entries.delete(key);
		entries.set(key, entry);
		return entry.value;
	};

	const remember = (key: string, value: T) => {
		entries.delete(key);
		entries.set(key, { value, at: now() });
		while (entries.size > limit) {
			const oldest = entries.keys().next();
			if (oldest.done) break;
			entries.delete(oldest.value);
		}
	};

	return { read, remember, clear: () => entries.clear() };
}

/**
 * Speculative composer intent routing.
 *
 * The composer's submit path is synchronous, so submit can never await a
 * classification. Drafts are therefore classified on a debounce into a cache,
 * and submit only ever reads that cache. A miss — the common case — falls
 * through to sending the message, which is exactly what happens with the
 * feature switched off.
 */

const DEBOUNCE_MS = 300;
/** Below this a draft cannot be describing a command. */
const MIN_DRAFT_CHARS = 4;

/**
 * A command the router recognised behind the draft.
 *
 * `forValue` is the draft it was computed against. The composer compares it to
 * its live value and drops the offer the moment they differ, so Tab can never
 * run a command against text the user has since edited.
 */
export type ComposerIntentCommandOffer = {
	forValue: string;
	command: string;
};

/** True when a draft is worth classifying at all. */
function isClassifiable(draft: string): boolean {
	const text = draft.trim();
	if (text.length < MIN_DRAFT_CHARS) return false;
	// An explicit slash command is already unambiguous; a lone @mention is a
	// file reference. Neither is a described command.
	if (text.startsWith("/")) return false;
	if (text.startsWith("@") && !text.includes(" ")) return false;
	return true;
}

/**
 * The command offer for a response, if it has one.
 *
 * Both bands produce an offer: the router has already applied the confidence
 * floor and the code-task guard, so a `matched` outcome is the whole test.
 * Whether it would also run on submit is a separate question the composer
 * answers from `takeCached`.
 */
function commandOfferFor(response: ComposerIntentResponse, forValue: string): ComposerIntentCommandOffer | undefined {
	if (response.outcome !== "matched" || !response.command) return undefined;
	const command = composerIntentCommand(response.command);
	if (!command) return undefined;
	return { forValue, command: command.id };
}

export type UseComposerIntentRoutingResult = {
	/** Reports the current draft so it can be classified ahead of submit. */
	onDraftChange: (text: string) => void;
	/**
	 * Synchronous cache read for the submit path. Returns a response only for an
	 * execution-band match; everything else returns null.
	 */
	takeCached: (text: string) => ComposerIntentResponse | null;
	/** The command recognised behind the current draft, if any. */
	command: ComposerIntentCommandOffer | undefined;
	/**
	 * Clears the command ghost and suppresses execute for this draft until it
	 * changes. Escape calls this so Enter cannot still auto-run what the user
	 * just dismissed.
	 */
	dismissCommand: () => void;
};

/**
 * @param available - Whether the server reports the feature as enabled. When it
 *   is not, no request is ever made and every draft falls through.
 */
export function useComposerIntentRouting(available: boolean): UseComposerIntentRoutingResult {
	const [cache] = useState(() => createDraftCache<ComposerIntentResponse>());
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const inFlight = useRef<AbortController | null>(null);
	const latestDraft = useRef("");
	/** Normalized draft Escape dismissed; execute stays suppressed until the draft changes. */
	const suppressedKey = useRef<string | undefined>(undefined);
	const [command, setCommand] = useState<ComposerIntentCommandOffer | undefined>(undefined);

	const offerFor = useCallback((response: ComposerIntentResponse, forValue: string, key: string) => {
		if (suppressedKey.current === key) return undefined;
		return commandOfferFor(response, forValue);
	}, []);

	const classify = useCallback(
		async (draft: string) => {
			const key = draftCacheKey(draft);
			inFlight.current?.abort();
			const controller = new AbortController();
			inFlight.current = controller;
			try {
				const parsed = await chatClient.classifyComposerIntent({ text: draft }, controller.signal);
				if (controller.signal.aborted) return;
				cache.remember(key, parsed);
				// Only offer a command for the draft still in the composer.
				if (latestDraft.current !== draft) return;
				setCommand(offerFor(parsed, draft, key));
			} catch {
				// Aborted or offline: leave the cache empty so submit falls through.
			}
		},
		[cache, offerFor],
	);

	const onDraftChange = useCallback(
		(text: string) => {
			latestDraft.current = text;
			if (timer.current !== undefined) {
				clearTimeout(timer.current);
				timer.current = undefined;
			}
			const key = draftCacheKey(text);
			// Editing away from a dismissed draft lifts the suppress for later returns.
			if (suppressedKey.current !== undefined && suppressedKey.current !== key) {
				suppressedKey.current = undefined;
			}
			if (!available || !isClassifiable(text)) {
				setCommand(undefined);
				return;
			}
			const cached = cache.read(key);
			if (cached) {
				setCommand(offerFor(cached, text, key));
				return;
			}
			setCommand(undefined);
			timer.current = setTimeout(() => {
				timer.current = undefined;
				void classify(text);
			}, DEBOUNCE_MS);
		},
		[available, cache, classify, offerFor],
	);

	const takeCached = useCallback(
		(text: string): ComposerIntentResponse | null => {
			if (!available) return null;
			const key = draftCacheKey(text);
			if (suppressedKey.current === key) return null;
			const entry = cache.read(key);
			if (!entry || entry.outcome !== "matched" || entry.disposition !== "execute") return null;
			return entry;
		},
		[available, cache],
	);

	const dismissCommand = useCallback(() => {
		suppressedKey.current = draftCacheKey(latestDraft.current);
		setCommand(undefined);
	}, []);

	// Nothing should survive the feature being switched off: a debounce that is
	// still pending would classify anyway, a stale chip would keep offering a
	// command, and a cached execution decision would fire the moment routing came
	// back on.
	useEffect(() => {
		if (available) return;
		if (timer.current !== undefined) {
			clearTimeout(timer.current);
			timer.current = undefined;
		}
		inFlight.current?.abort();
		inFlight.current = null;
		cache.clear();
		suppressedKey.current = undefined;
	}, [available, cache]);

	// The mirror of the switch-off above, and the same gap `useComposerInlineCompletion`
	// closes with its re-ask: availability is resolved asynchronously (the key is
	// checked server-side) while the composer keeps whatever was already typed. No
	// keystroke follows the flip, so a draft typed while the check was in flight
	// would never be classified and would get no offer until it was edited again.
	// Schedule via timeout (not a sync setState in the effect) so fake timers and
	// React Compiler's set-state-in-effect rule both stay happy.
	useEffect(() => {
		if (!available) return;
		const draft = latestDraft.current;
		if (!draft) return;
		const timerId = setTimeout(() => {
			onDraftChange(draft);
		}, 0);
		return () => clearTimeout(timerId);
	}, [available, onDraftChange]);

	// Drop a pending debounce and any in-flight classification on unmount.
	useEffect(
		() => () => {
			if (timer.current !== undefined) clearTimeout(timer.current);
			inFlight.current?.abort();
		},
		[],
	);

	return { onDraftChange, takeCached, command: available ? command : undefined, dismissCommand };
}

export type ComposerIntentAvailability = {
	/** True only once the server has confirmed both a key and the Settings toggle. */
	available: boolean;
	/** The user's own choice, as persisted server-side. */
	enabled: boolean;
	/** Which key is in effect. Never the key itself. */
	keySource: ComposerIntentKeySource;
	status: "unconfigured" | "unverified" | "ready" | "error" | "loading";
	/** Re-reads availability, for the Settings toggle. */
	refresh: () => void;
};

/**
 * Reads whether composer routing is available.
 *
 * One request per mount: the answer only changes when the user toggles the
 * feature in Settings, which calls {@link ComposerIntentAvailability.refresh}.
 */
export function useComposerIntentAvailability(): ComposerIntentAvailability {
	const [state, setState] = useState<{
		available: boolean;
		enabled: boolean;
		keySource: ComposerIntentKeySource;
		status: ComposerIntentAvailability["status"];
	}>({ available: false, enabled: false, keySource: "none", status: "loading" });
	// Guards against an earlier request landing after a later one.
	const requestId = useRef(0);

	const refresh = useCallback(() => {
		const id = ++requestId.current;
		void (async () => {
			try {
				const body = (await chatClient.getComposerIntentSettings()) as {
					enabled?: unknown;
					keySource?: unknown;
					status?: unknown;
				};
				if (id !== requestId.current) return;
				const status = typeof body.status === "string" ? body.status : "error";
				const enabled = body.enabled === true;
				setState({
					available: enabled && status === "ready",
					enabled,
					keySource: (body.keySource ?? "none") as ComposerIntentKeySource,
					status: status as ComposerIntentAvailability["status"],
				});
			} catch {
				if (id !== requestId.current) return;
				setState({ available: false, enabled: false, keySource: "none", status: "error" });
			}
		})();
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// A fresh object here would invalidate every memo downstream of this hook on
	// each render, including the settings context values it feeds.
	return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}

/**
 * Ghost-text completions from the developer's own prompt history.
 *
 * Deliberately does **not** debounce: `InputBar` already publishes the
 * draft on a 300 ms pause (`onDraftChange`), so adding a second timer here would
 * only delay the offer and risk the two windows disagreeing.
 *
 * The returned `forValue` is the draft the completion was computed against. The
 * composer compares it to its live value and drops the ghost the moment they
 * differ, which is what keeps a completion for an older draft from being painted
 * onto a newer one.
 *
 * Command replacements are not produced here — the host coalesces a router offer
 * over this history completion. This endpoint is append-only by contract.
 */

/** An offer waiting to be painted. */
type Offer = { key: string; forValue: string; text: string };

/**
 * A draft shorter than this is not worth a request. Mirrors the intent floor.
 *
 * The trigger-token check duplicates the server's, deliberately: the server is
 * still the authority, but without it a slash or `@mention` draft would spend a
 * request per typing pause only to be rejected.
 */
function isCompletable(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < COMPOSER_COMPLETION_MIN_CHARS) return false;
	return !composerCompletionIgnores(text);
}

/**
 * Cache key for an offer.
 *
 * The session is part of the key because it is part of the question: the same
 * prefix resolves to a different completion depending on which session is being
 * typed in. Keyed on the draft alone, a draft cached in one session would be
 * replayed verbatim in the next — including in a brand-new chat, which would
 * show another session's history as though it were the corpus.
 */
function cacheKey(sessionId: string | undefined, text: string): string {
	return `${sessionId ?? ""}\u0000${draftCacheKey(text)}`;
}

export type UseComposerInlineCompletionOptions = {
	/** Whether history completions are wanted at all. */
	available: boolean;
	/** The session being typed in, so its own prompts are preferred. */
	sessionId?: string;
};

export type UseComposerInlineCompletionResult = {
	/** Feed the published draft here. */
	onDraftChange: (text: string) => void;
	/** Pass straight to the composer's `inlineCompletion` prop, or coalesce with a command. */
	inlineCompletion: InlineCompletion | undefined;
};

/**
 * @param available - Whether history completions are wanted at all. When false,
 *   no request is ever made and no history ghost is painted.
 */
export function useComposerInlineCompletion({
	available,
	sessionId,
}: UseComposerInlineCompletionOptions): UseComposerInlineCompletionResult {
	const [cache] = useState(() => createDraftCache<{ completion: string | undefined }>());
	const latestDraft = useRef("");
	const inFlight = useRef<AbortController | null>(null);
	const [offer, setOffer] = useState<Offer | undefined>(undefined);

	const fetchCompletion = useCallback(
		async (draft: string) => {
			const key = cacheKey(sessionId, draft);
			inFlight.current?.abort();
			const controller = new AbortController();
			inFlight.current = controller;
			try {
				const body = await chatClient.completeComposerDraft(
					sessionId ? { text: draft, sessionId } : { text: draft },
					controller.signal,
				);
				// Only positives are cached. A negative can simply mean the server's
				// corpus was still being read, and caching that for the TTL would keep
				// a perfectly completable draft silent.
				// History completions are always append — never honor a wire `mode`.
				if (body.completion) cache.remember(key, { completion: body.completion });
				// Only the latest request may publish. An aborted fetch can still resolve
				// when its implementation ignores the signal, including after a session switch.
				if (inFlight.current !== controller || latestDraft.current !== draft) return;
				setOffer(body.completion ? { key, forValue: draft, text: body.completion } : undefined);
			} catch {
				// Aborted or offline: leaving the previous offer absent is the safe
				// outcome, and the composer falls back to plain typing.
			}
		},
		[cache, sessionId],
	);

	const onDraftChange = useCallback(
		(text: string) => {
			latestDraft.current = text;
			if (!available || !isCompletable(text)) {
				inFlight.current?.abort();
				inFlight.current = null;
				setOffer(undefined);
				return;
			}
			const key = cacheKey(sessionId, text);
			const cached = cache.read(key);
			if (cached) {
				inFlight.current?.abort();
				inFlight.current = null;
				setOffer(cached.completion ? { key, forValue: text, text: cached.completion } : undefined);
				return;
			}
			setOffer(undefined);
			void fetchCompletion(text);
		},
		[available, cache, fetchCompletion, sessionId],
	);

	useEffect(
		() => () => {
			inFlight.current?.abort();
			inFlight.current = null;
		},
		[],
	);

	// The answer depends on the session as well as the draft, so a session switch
	// has to re-ask. The composer keeps its draft across a switch, and no keystroke
	// follows one, so without this the ghost would stay blank until the user typed.
	useEffect(() => {
		if (latestDraft.current) onDraftChange(latestDraft.current);
	}, [onDraftChange]);

	// Uses the protocol's own rule rather than slicing here, so the suffix the
	// composer paints and the one the ghost check validates can never disagree.
	const currentOffer = offer && offer.key === cacheKey(sessionId, offer.forValue) ? offer : undefined;
	const ghost = currentOffer ? composerCompletionGhost(currentOffer.forValue, currentOffer.text, "append") : undefined;
	const inlineCompletion: InlineCompletion | undefined =
		currentOffer && ghost
			? {
					forValue: currentOffer.forValue,
					text: ghost,
					mode: "append",
					onDismiss: () => setOffer(undefined),
				}
			: undefined;

	return { onDraftChange, inlineCompletion };
}
