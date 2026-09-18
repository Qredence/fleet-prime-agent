import type { ComposerIntentResponse } from "@prime-agent/web-protocol/composer-intent";
import { composerIntentCommand } from "@prime-agent/web-protocol/composer-intent";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveChatApiUrl } from "@/lib/pi/chat-runtime-url";

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
const CACHE_LIMIT = 32;
const CACHE_TTL_MS = 5 * 60_000;
/** Below this a draft cannot be describing a command. */
const MIN_DRAFT_CHARS = 4;

/** Cache key for a draft. Matches the server's own normalisation. */
export function normalizeIntentDraft(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** A suggestion the composer may offer, ready to render. */
export type ComposerIntentSuggestion = {
	/**
	 * The draft this suggestion was computed against. The composer compares it to
	 * its live value and drops the chip the moment they differ, so a click can
	 * never run a command against text the user has since edited and discard the
	 * keystroke.
	 */
	forValue: string;
	command: string;
	label: string;
	description: string;
};

type CacheEntry = { response: ComposerIntentResponse; at: number };

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

/** The offer-band suggestion for a response, if it has one. */
function suggestionFor(response: ComposerIntentResponse, forValue: string): ComposerIntentSuggestion | undefined {
	if (response.outcome !== "matched" || response.disposition !== "suggest" || !response.command) return undefined;
	const command = composerIntentCommand(response.command);
	if (!command) return undefined;
	return { forValue, command: command.id, label: `/${command.id}`, description: command.description };
}

export type UseComposerIntentRoutingResult = {
	/** Reports the current draft so it can be classified ahead of submit. */
	onDraftChange: (text: string) => void;
	/**
	 * Synchronous cache read for the submit path. Returns a response only for an
	 * execution-band match; everything else returns null.
	 */
	takeCached: (text: string) => ComposerIntentResponse | null;
	/** The offer-band suggestion for the current draft, if any. */
	suggestion: ComposerIntentSuggestion | undefined;
	/** Hides the current suggestion without running it. */
	dismissSuggestion: () => void;
};

/**
 * @param available - Whether the server reports the feature as enabled. When it
 *   is not, no request is ever made and every draft falls through.
 */
export function useComposerIntentRouting(available: boolean): UseComposerIntentRoutingResult {
	const cache = useRef(new Map<string, CacheEntry>());
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const inFlight = useRef<AbortController | null>(null);
	const latestDraft = useRef("");
	const dismissedKey = useRef<string | undefined>(undefined);
	const [suggestion, setSuggestion] = useState<ComposerIntentSuggestion | undefined>(undefined);

	const readCache = useCallback((key: string): ComposerIntentResponse | undefined => {
		const entry = cache.current.get(key);
		if (!entry) return undefined;
		if (Date.now() - entry.at > CACHE_TTL_MS) {
			cache.current.delete(key);
			return undefined;
		}
		return entry.response;
	}, []);

	const remember = useCallback((key: string, response: ComposerIntentResponse) => {
		cache.current.set(key, { response, at: Date.now() });
		while (cache.current.size > CACHE_LIMIT) {
			const oldest = cache.current.keys().next();
			if (oldest.done) break;
			cache.current.delete(oldest.value);
		}
	}, []);

	const classify = useCallback(
		async (draft: string) => {
			const key = normalizeIntentDraft(draft);
			inFlight.current?.abort();
			const controller = new AbortController();
			inFlight.current = controller;
			try {
				const response = await fetch(resolveChatApiUrl("/api/chat/intent"), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text: draft }),
					signal: controller.signal,
				});
				if (!response.ok) return;
				const parsed = (await response.json()) as ComposerIntentResponse;
				remember(key, parsed);
				// Only offer a suggestion for the draft still in the composer, and
				// never re-offer one the user has already dismissed.
				if (latestDraft.current !== draft || dismissedKey.current === key) return;
				setSuggestion(suggestionFor(parsed, draft));
			} catch {
				// Aborted or offline: leave the cache empty so submit falls through.
			}
		},
		[remember],
	);

	const onDraftChange = useCallback(
		(text: string) => {
			latestDraft.current = text;
			if (timer.current !== undefined) {
				clearTimeout(timer.current);
				timer.current = undefined;
			}
			if (!available || !isClassifiable(text)) {
				setSuggestion(undefined);
				return;
			}
			const key = normalizeIntentDraft(text);
			if (dismissedKey.current !== undefined && dismissedKey.current !== key) {
				dismissedKey.current = undefined;
			}
			const cached = readCache(key);
			if (cached) {
				setSuggestion(suggestionFor(cached, text));
				return;
			}
			setSuggestion(undefined);
			timer.current = setTimeout(() => {
				timer.current = undefined;
				void classify(text);
			}, DEBOUNCE_MS);
		},
		[available, classify, readCache],
	);

	const takeCached = useCallback(
		(text: string): ComposerIntentResponse | null => {
			if (!available) return null;
			const entry = readCache(normalizeIntentDraft(text));
			if (!entry || entry.outcome !== "matched" || entry.disposition !== "execute") return null;
			return entry;
		},
		[available, readCache],
	);

	const dismissSuggestion = useCallback(() => {
		dismissedKey.current = normalizeIntentDraft(latestDraft.current);
		setSuggestion(undefined);
	}, []);

	// Drop a pending debounce and any in-flight classification on unmount.
	useEffect(
		() => () => {
			if (timer.current !== undefined) clearTimeout(timer.current);
			inFlight.current?.abort();
		},
		[],
	);

	return { onDraftChange, takeCached, suggestion, dismissSuggestion };
}

export type ComposerIntentAvailability = {
	/** True only once the server has confirmed both a key and the Settings toggle. */
	available: boolean;
	/** The user's own choice, as persisted server-side. */
	enabled: boolean;
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
		status: ComposerIntentAvailability["status"];
	}>({ available: false, enabled: false, status: "loading" });
	// Guards against an earlier request landing after a later one.
	const requestId = useRef(0);

	const refresh = useCallback(() => {
		const id = ++requestId.current;
		void (async () => {
			try {
				const response = await fetch(resolveChatApiUrl("/api/chat/intent"));
				if (id !== requestId.current) return;
				if (!response.ok) {
					setState({ available: false, enabled: false, status: "error" });
					return;
				}
				const body = (await response.json()) as { enabled?: unknown; status?: unknown };
				if (id !== requestId.current) return;
				const status = typeof body.status === "string" ? body.status : "error";
				const enabled = body.enabled === true;
				setState({
					available: enabled && status === "ready",
					enabled,
					status: status as ComposerIntentAvailability["status"],
				});
			} catch {
				if (id !== requestId.current) return;
				setState({ available: false, enabled: false, status: "error" });
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
