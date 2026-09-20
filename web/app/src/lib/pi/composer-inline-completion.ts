import {
	COMPOSER_COMPLETION_MIN_CHARS,
	type ComposerCompletionResponse,
	composerCompletionGhost,
	composerCompletionIgnores,
} from "@prime-agent/web-protocol/composer-completion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InlineCompletion } from "@/components/qredence-ui/chat/composer/inline-completion";
import { resolveChatApiUrl } from "@/lib/pi/chat-runtime-url";

/**
 * Ghost-text completions from the developer's own prompt history.
 *
 * Deliberately does **not** debounce: `useInputBarState` already publishes the
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

const CACHE_LIMIT = 32;
const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { completion: string | undefined; at: number };

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

function normalizedKey(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
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
	return `${sessionId ?? ""}\u0000${normalizedKey(text)}`;
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
	const cache = useRef(new Map<string, CacheEntry>());
	const latestDraft = useRef("");
	const inFlight = useRef<AbortController | null>(null);
	const [offer, setOffer] = useState<Offer | undefined>(undefined);

	const remember = useCallback((key: string, completion: string | undefined) => {
		cache.current.set(key, { completion, at: Date.now() });
		while (cache.current.size > CACHE_LIMIT) {
			const oldest = cache.current.keys().next();
			if (oldest.done) break;
			cache.current.delete(oldest.value);
		}
	}, []);

	const readCache = useCallback((key: string): CacheEntry | undefined => {
		const entry = cache.current.get(key);
		if (!entry) return undefined;
		if (Date.now() - entry.at > CACHE_TTL_MS) {
			cache.current.delete(key);
			return undefined;
		}
		return entry;
	}, []);

	const fetchCompletion = useCallback(
		async (draft: string) => {
			const key = cacheKey(sessionId, draft);
			inFlight.current?.abort();
			const controller = new AbortController();
			inFlight.current = controller;
			try {
				const response = await fetch(resolveChatApiUrl("/api/chat/completion"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(sessionId ? { text: draft, sessionId } : { text: draft }),
					signal: controller.signal,
				});
				if (!response.ok) return;
				const body = (await response.json()) as ComposerCompletionResponse;
				// Only positives are cached. A negative can simply mean the server's
				// corpus was still being read, and caching that for the TTL would keep
				// a perfectly completable draft silent.
				// History completions are always append — never honor a wire `mode`.
				if (body.completion) remember(key, body.completion);
				// Only the latest request may publish. An aborted fetch can still resolve
				// when its implementation ignores the signal, including after a session switch.
				if (inFlight.current !== controller || latestDraft.current !== draft) return;
				setOffer(body.completion ? { key, forValue: draft, text: body.completion } : undefined);
			} catch {
				// Aborted or offline: leaving the previous offer absent is the safe
				// outcome, and the composer falls back to plain typing.
			}
		},
		[remember, sessionId],
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
			const cached = readCache(key);
			if (cached) {
				inFlight.current?.abort();
				inFlight.current = null;
				setOffer(cached.completion ? { key, forValue: text, text: cached.completion } : undefined);
				return;
			}
			setOffer(undefined);
			void fetchCompletion(text);
		},
		[available, fetchCompletion, readCache, sessionId],
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
