import type { ComposerIntentKeySource, ComposerIntentResponse } from "@prime-agent/web-protocol/composer-intent";
import { composerIntentCommand } from "@prime-agent/web-protocol/composer-intent";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveChatApiUrl } from "@/components/chat/chat-runtime-url";

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
	const cache = useRef(new Map<string, CacheEntry>());
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const inFlight = useRef<AbortController | null>(null);
	const latestDraft = useRef("");
	/** Normalized draft Escape dismissed; execute stays suppressed until the draft changes. */
	const suppressedKey = useRef<string | undefined>(undefined);
	const [command, setCommand] = useState<ComposerIntentCommandOffer | undefined>(undefined);

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

	const offerFor = useCallback((response: ComposerIntentResponse, forValue: string, key: string) => {
		if (suppressedKey.current === key) return undefined;
		return commandOfferFor(response, forValue);
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
				// Only offer a command for the draft still in the composer.
				if (latestDraft.current !== draft) return;
				setCommand(offerFor(parsed, draft, key));
			} catch {
				// Aborted or offline: leave the cache empty so submit falls through.
			}
		},
		[offerFor, remember],
	);

	const onDraftChange = useCallback(
		(text: string) => {
			latestDraft.current = text;
			if (timer.current !== undefined) {
				clearTimeout(timer.current);
				timer.current = undefined;
			}
			const key = normalizeIntentDraft(text);
			// Editing away from a dismissed draft lifts the suppress for later returns.
			if (suppressedKey.current !== undefined && suppressedKey.current !== key) {
				suppressedKey.current = undefined;
			}
			if (!available || !isClassifiable(text)) {
				setCommand(undefined);
				return;
			}
			const cached = readCache(key);
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
		[available, classify, offerFor, readCache],
	);

	const takeCached = useCallback(
		(text: string): ComposerIntentResponse | null => {
			if (!available) return null;
			const key = normalizeIntentDraft(text);
			if (suppressedKey.current === key) return null;
			const entry = readCache(key);
			if (!entry || entry.outcome !== "matched" || entry.disposition !== "execute") return null;
			return entry;
		},
		[available, readCache],
	);

	const dismissCommand = useCallback(() => {
		suppressedKey.current = normalizeIntentDraft(latestDraft.current);
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
		cache.current.clear();
		suppressedKey.current = undefined;
		setCommand(undefined);
	}, [available]);

	// The mirror of the switch-off above, and the same gap `useComposerInlineCompletion`
	// closes with its re-ask: availability is resolved asynchronously (the key is
	// checked server-side) while the composer keeps whatever was already typed. No
	// keystroke follows the flip, so a draft typed while the check was in flight
	// would never be classified and would get no offer until it was edited again.
	useEffect(() => {
		if (!available) return;
		if (latestDraft.current) onDraftChange(latestDraft.current);
	}, [available, onDraftChange]);

	// Drop a pending debounce and any in-flight classification on unmount.
	useEffect(
		() => () => {
			if (timer.current !== undefined) clearTimeout(timer.current);
			inFlight.current?.abort();
		},
		[],
	);

	return { onDraftChange, takeCached, command, dismissCommand };
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
				const response = await fetch(resolveChatApiUrl("/api/chat/intent"));
				if (id !== requestId.current) return;
				if (!response.ok) {
					setState({ available: false, enabled: false, keySource: "none", status: "error" });
					return;
				}
				const body = (await response.json()) as { enabled?: unknown; keySource?: unknown; status?: unknown };
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
