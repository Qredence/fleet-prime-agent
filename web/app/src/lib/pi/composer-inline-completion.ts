import type { InlineCompletion } from "@prime-agent/web-design/components/qredence-ui/chat/composer/inline-completion";
import {
	COMPOSER_COMPLETION_MIN_CHARS,
	type ComposerCompletionResponse,
	composerCompletionIgnores,
	normalizeCompletionDraft,
} from "@prime-agent/web-protocol/composer-completion";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveChatApiUrl } from "@/lib/pi/chat-runtime-url";

/**
 * Ghost-text completions for the composer.
 *
 * Deliberately does **not** debounce: `useInputBarState` already publishes the
 * draft on a 300 ms pause (`onDraftChange`), so adding a second timer here would
 * only delay the offer and risk the two windows disagreeing.
 *
 * The returned `forValue` is the draft the completion was computed against. The
 * composer compares it to its live value and drops the ghost the moment they
 * differ, which is what keeps a completion for an older draft from being painted
 * onto a newer one.
 */

const CACHE_LIMIT = 32;
const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { completion: string | undefined; at: number };

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

export type UseComposerInlineCompletionResult = {
	/** Feed the published draft here. */
	onDraftChange: (text: string) => void;
	/** Pass straight to the composer's `inlineCompletion` prop. */
	inlineCompletion: InlineCompletion | undefined;
};

/**
 * @param available - Whether the host wants completions at all. When false, no
 *   request is ever made and the composer behaves exactly as it did before.
 */
export function useComposerInlineCompletion(available: boolean): UseComposerInlineCompletionResult {
	const cache = useRef(new Map<string, CacheEntry>());
	const latestDraft = useRef("");
	const inFlight = useRef<AbortController | null>(null);
	const [offer, setOffer] = useState<{ forValue: string; text: string } | undefined>(undefined);

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
			const key = normalizedKey(draft);
			inFlight.current?.abort();
			const controller = new AbortController();
			inFlight.current = controller;
			try {
				const response = await fetch(resolveChatApiUrl("/api/chat/completion"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text: draft }),
					signal: controller.signal,
				});
				if (!response.ok) return;
				const body = (await response.json()) as ComposerCompletionResponse;
				remember(key, body.completion);
				// Only offer for the draft the user is still on.
				if (latestDraft.current !== draft) return;
				setOffer(body.completion ? { forValue: draft, text: body.completion } : undefined);
			} catch {
				// Aborted or offline: leaving the previous offer absent is the safe
				// outcome, and the composer falls back to plain typing.
			}
		},
		[remember],
	);

	const onDraftChange = useCallback(
		(text: string) => {
			latestDraft.current = text;
			if (!available || !isCompletable(text)) {
				setOffer(undefined);
				return;
			}
			const cached = readCache(normalizedKey(text));
			if (cached) {
				setOffer(cached.completion ? { forValue: text, text: cached.completion } : undefined);
				return;
			}
			setOffer(undefined);
			void fetchCompletion(text);
		},
		[available, fetchCompletion, readCache],
	);

	useEffect(() => () => inFlight.current?.abort(), []);

	const inlineCompletion: InlineCompletion | undefined = offer && {
		forValue: offer.forValue,
		// The server returns the whole accepted string, normalised; the composer
		// needs only the suffix to paint, measured against the same normalised form.
		text: offer.text.slice(normalizeCompletionDraft(offer.forValue).length),
		onDismiss: () => setOffer(undefined),
	};

	return { onDraftChange, inlineCompletion };
}
