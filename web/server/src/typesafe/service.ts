/**
 * Composer intent routing service.
 *
 * Owns the TypeSafe transport, the draft cache, and the readiness probe. It
 * knows nothing about persistence or HTTP: the settings toggle and the route
 * handler live elsewhere, so this stays unit-testable with an injected `fetch`.
 *
 * Failure policy is fail-open throughout. Any transport problem, timeout, rate
 * limit, or unusable answer produces `outcome: "none"`, which the composer
 * treats exactly like a cache miss: the message is sent to the agent as usual.
 */
import type {
	ComposerIntentRequest,
	ComposerIntentResponse,
	ComposerIntentStatus,
} from "@prime-agent/web-protocol/composer-intent";
import {
	postSystemOne,
	probeConnection,
	TYPESAFE_RETRYABLE_STATUSES,
	type TypeSafeFetch,
	TypeSafeTransportError,
} from "./client";
import { readTypeSafeConfig, type TypeSafeRuntimeConfig } from "./config";
import { buildIntentQuestions, buildIntentState, interpretIntentResult } from "./intent-router";

/** Cached decisions held per process. */
const CACHE_LIMIT = 48;
const CACHE_TTL_MS = 5 * 60_000;
/** Shorter than this is never a described command. */
const MIN_INTENT_CHARS = 4;
/** How long a readiness probe result is trusted. */
const PROBE_TTL_MS = 5 * 60_000;

type CacheEntry = { response: ComposerIntentResponse; at: number };

export type TypeSafeService = {
	/** True when a key is present and the operator has not disabled the feature. */
	readonly configured: boolean;
	readonly model: string;
	/** Cached readiness of the key: `ready` only after a probe has succeeded. */
	status(): Promise<ComposerIntentStatus>;
	/**
	 * Routes one composer draft.
	 *
	 * `enabled` must already reflect the user's Settings choice; this method
	 * never decides whether the feature is on.
	 */
	routeComposerIntent(request: ComposerIntentRequest, enabled: boolean): Promise<ComposerIntentResponse>;
	/** Test seams. */
	resetCachesForTests(): void;
};

export type TypeSafeServiceOptions = {
	config?: TypeSafeRuntimeConfig;
	fetch?: TypeSafeFetch;
	now?: () => number;
};

/** Cache key for a draft. Case- and whitespace-insensitive so typing is free. */
export function normalizeIntentText(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function disabledResponse(enabled: boolean, reason: ComposerIntentResponse["reason"]): ComposerIntentResponse {
	return { enabled, outcome: "none", ...(reason ? { reason } : {}) };
}

export function createTypeSafeService(options: TypeSafeServiceOptions = {}): TypeSafeService {
	const config = options.config ?? readTypeSafeConfig();
	const fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
	const now = options.now ?? Date.now;

	const cache = new Map<string, CacheEntry>();
	let probe: { at: number; ok: boolean } | undefined;

	function readCache(key: string): ComposerIntentResponse | undefined {
		const entry = cache.get(key);
		if (!entry) return undefined;
		if (now() - entry.at > CACHE_TTL_MS) {
			cache.delete(key);
			return undefined;
		}
		return entry.response;
	}

	function writeCache(key: string, response: ComposerIntentResponse): void {
		cache.set(key, { response, at: now() });
		while (cache.size > CACHE_LIMIT) {
			const oldest = cache.keys().next();
			if (oldest.done) break;
			cache.delete(oldest.value);
		}
	}

	return {
		configured: config.configured,
		model: config.model,

		async status(): Promise<ComposerIntentStatus> {
			if (!config.configured) return "unconfigured";
			if (probe && now() - probe.at <= PROBE_TTL_MS) return probe.ok ? "ready" : "error";
			const ok = await probeConnection(config, fetchImpl);
			probe = { at: now(), ok };
			return ok ? "ready" : "error";
		},

		async routeComposerIntent(request: ComposerIntentRequest, enabled: boolean): Promise<ComposerIntentResponse> {
			if (!enabled) return disabledResponse(false, "disabled");
			if (!config.configured) return disabledResponse(false, "disabled");

			const text = request.text.trim();
			if (text.length < MIN_INTENT_CHARS) return disabledResponse(true, "empty");
			// A leading slash is already an explicit command; never re-interpret it.
			if (text.startsWith("/")) return disabledResponse(true, "empty");

			const key = normalizeIntentText(text);
			const cached = readCache(key);
			if (cached) return cached;

			const startedAt = now();
			try {
				const result = await postSystemOne(
					config,
					{ state: buildIntentState(text), questions: buildIntentQuestions() },
					{
						timeoutMs: config.intentTimeoutMs,
						maxRetries: config.intentMaxRetries,
						retryStatuses: TYPESAFE_RETRYABLE_STATUSES,
					},
					fetchImpl,
				);
				const decision = interpretIntentResult(result, text);
				const response: ComposerIntentResponse =
					decision.outcome === "matched"
						? {
								enabled: true,
								outcome: "matched",
								command: decision.command.id,
								confidence: decision.confidence,
								disposition: decision.disposition,
								model: result.model,
								latencyMs: now() - startedAt,
							}
						: {
								enabled: true,
								outcome: "none",
								reason: decision.reason,
								confidence: decision.confidence,
								model: result.model,
								latencyMs: now() - startedAt,
							};
				writeCache(key, response);
				return response;
			} catch (error) {
				const rateLimited = error instanceof TypeSafeTransportError && error.status === 429;
				if (config.logLevel !== "off") {
					// Never the draft text, never the key: only the failure kind.
					const kind = error instanceof TypeSafeTransportError ? error.kind : "unknown";
					process.stderr.write(`[typesafe] intent routing unavailable (${kind})\n`);
				}
				return disabledResponse(true, rateLimited ? "rate_limited" : "unavailable");
			}
		},

		resetCachesForTests(): void {
			cache.clear();
			probe = undefined;
		},
	};
}
