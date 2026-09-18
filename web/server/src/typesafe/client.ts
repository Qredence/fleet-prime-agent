/**
 * The only module in Fleet that speaks the TypeSafe HTTP protocol.
 *
 * Types mirror the documented v1 contract so that swapping in the official
 * `@typesafe-ai/sdk` later replaces this file and nothing else. The SDK is not
 * used today because every published version is younger than the workspace's
 * `minimumReleaseAge` policy.
 *
 * Two invariants this file exists to hold:
 * - the API key never appears in a thrown message, a log line, or a response;
 * - `fetch` is injectable, so tests never reach the network.
 */
import type { TypeSafeRuntimeConfig } from "./config";

export type TypeSafeFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A question's instruction or criteria entry: text, or structured JSON. */
export type TypeSafeEntry = string | Record<string, unknown> | Array<unknown> | null;

export type NoulQuestion = {
	type: "noul";
	instructions?: TypeSafeEntry;
	criteria?: { true?: TypeSafeEntry; false?: TypeSafeEntry } | null;
};

export type ChoiceQuestion = {
	type: "choice";
	instructions?: TypeSafeEntry;
	criteria: Record<string, TypeSafeEntry>;
};

export type ScoreQuestion = {
	type: "score";
	instructions?: TypeSafeEntry;
	criteria: ReadonlyArray<TypeSafeEntry>;
};

export type SystemOneQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export type NoulAnswer = { type: "noul"; noul: number };

export type ChoiceAnswer = {
	type: "choice";
	choice: string;
	confidence: number;
	probabilities: Record<string, number>;
};

export type ScoreAnswer = {
	type: "score";
	score: number;
	confidence: number;
	legend: Record<string, TypeSafeEntry>;
	probabilities: Record<string, number>;
};

export type SystemOneAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type SystemOneUsage = { input_tokens: number; output_tokens: number };

export type SystemOneResult = {
	model: string;
	answers: Record<string, SystemOneAnswer>;
	usage: SystemOneUsage;
};

export type SystemOneCallOptions = {
	/** Per-attempt timeout. There is no separate total budget. */
	timeoutMs?: number;
	/** Retries after the initial attempt. 0 disables. */
	maxRetries?: number;
	/** Retry only these HTTP statuses. Default: none. */
	retryStatuses?: ReadonlySet<number>;
	/** Caller-supplied cancellation, combined with the timeout. */
	signal?: AbortSignal;
};

export type TypeSafeTransportErrorKind = "unconfigured" | "http" | "timeout" | "aborted" | "malformed";

/** A transport failure. Never carries the API key or response bodies. */
export class TypeSafeTransportError extends Error {
	readonly kind: TypeSafeTransportErrorKind;
	readonly status: number | undefined;

	constructor(message: string, kind: TypeSafeTransportErrorKind, status?: number, options?: ErrorOptions) {
		super(message, options);
		this.name = "TypeSafeTransportError";
		this.kind = kind;
		this.status = status;
	}
}

/** HTTP statuses worth a second attempt. */
export const TYPESAFE_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504, 529]);

const NO_RETRY_STATUSES: ReadonlySet<number> = new Set();

/** Base delay for a retry when the service gives no `Retry-After`. */
export const RETRY_BASE_DELAY_MS = 250;
/** Ceiling for a single computed backoff. */
export const RETRY_MAX_DELAY_MS = 5_000;

/**
 * How long to wait before the next attempt.
 *
 * Retrying immediately on a 429 or a 5xx is the one thing that reliably makes a
 * throttled service worse, so an explicit `Retry-After` is honoured when present
 * and a bounded exponential backoff with jitter is used otherwise.
 */
export function retryDelayMs(response: Response, attempt: number): number {
	const header = response.headers.get("retry-after")?.trim();
	if (header) {
		const seconds = Number(header);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RETRY_MAX_DELAY_MS);
		const date = Date.parse(header);
		if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), RETRY_MAX_DELAY_MS);
	}
	const exponential = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
	// Jitter keeps a burst of failures from retrying in lockstep.
	return Math.round(exponential * (0.5 + Math.random() / 2));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function noul(instructions: TypeSafeEntry, criteria?: NoulQuestion["criteria"]): NoulQuestion {
	return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

export function choice(instructions: TypeSafeEntry, criteria: Record<string, TypeSafeEntry>): ChoiceQuestion {
	return { type: "choice", instructions, criteria };
}

export function score(instructions: TypeSafeEntry, criteria: ReadonlyArray<TypeSafeEntry>): ScoreQuestion {
	return { type: "score", instructions, criteria };
}

/** Narrows a result to its Choice answer, or `undefined` when the shape differs. */
export function choiceAnswer(result: SystemOneResult, id: string): ChoiceAnswer | undefined {
	const answer = result.answers[id];
	return answer?.type === "choice" ? answer : undefined;
}

/** Narrows a result to its Noul answer, or `undefined` when the shape differs. */
export function noulAnswer(result: SystemOneResult, id: string): NoulAnswer | undefined {
	const answer = result.answers[id];
	return answer?.type === "noul" ? answer : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sends one System One request and returns its typed answers.
 *
 * Every question in `questions` is evaluated in parallel by the model against
 * the same `state`, so callers should batch rather than call repeatedly.
 */
export async function postSystemOne(
	config: TypeSafeRuntimeConfig,
	body: { state: TypeSafeEntry; questions: Record<string, SystemOneQuestion> },
	options: SystemOneCallOptions = {},
	fetchImpl: TypeSafeFetch = globalThis.fetch,
): Promise<SystemOneResult> {
	if (!config.configured || !config.apiKey) {
		throw new TypeSafeTransportError("TypeSafe is not configured", "unconfigured");
	}
	const apiKey = config.apiKey;
	const timeoutMs = options.timeoutMs ?? config.intentTimeoutMs;
	const maxRetries = options.maxRetries ?? 0;
	const retryStatuses = options.retryStatuses ?? NO_RETRY_STATUSES;
	let lastError: TypeSafeTransportError | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
		try {
			const response = await fetchImpl(`${config.baseUrl}/v1/systemone`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ state: body.state, model: config.model, questions: body.questions }),
				signal,
			});

			if (!response.ok) {
				// Drain without surfacing the body: it may echo request state.
				await response.text().catch(() => "");
				const error = new TypeSafeTransportError(
					`TypeSafe request failed with HTTP ${response.status}`,
					"http",
					response.status,
				);
				if (attempt < maxRetries && retryStatuses.has(response.status)) {
					lastError = error;
					await sleep(retryDelayMs(response, attempt));
					continue;
				}
				throw error;
			}

			const parsed: unknown = await response.json().catch(() => undefined);
			if (!isRecord(parsed) || !isRecord(parsed.answers)) {
				throw new TypeSafeTransportError("TypeSafe returned an unreadable body", "malformed");
			}
			const usage = isRecord(parsed.usage) ? parsed.usage : {};
			return {
				model: typeof parsed.model === "string" ? parsed.model : config.model,
				answers: parsed.answers as Record<string, SystemOneAnswer>,
				usage: {
					input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
					output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
				},
			};
		} catch (error) {
			if (error instanceof TypeSafeTransportError) throw error;
			const kind: TypeSafeTransportErrorKind = timeoutSignal.aborted
				? "timeout"
				: options.signal?.aborted
					? "aborted"
					: "http";
			lastError = new TypeSafeTransportError(
				kind === "timeout" ? `TypeSafe request exceeded ${timeoutMs}ms` : "TypeSafe request failed",
				kind,
				undefined,
				{ cause: error },
			);
			if (attempt >= maxRetries) throw lastError;
		}
	}

	throw lastError ?? new TypeSafeTransportError("TypeSafe request failed", "http");
}

/**
 * Cheap readiness probe: confirms the key resolves and the service answers,
 * without spending a System One request. Used by the Settings surface; the
 * caller caches the outcome rather than calling per request.
 */
export async function probeConnection(
	config: TypeSafeRuntimeConfig,
	fetchImpl: TypeSafeFetch = globalThis.fetch,
	timeoutMs = 3_000,
): Promise<boolean> {
	if (!config.configured || !config.apiKey) return false;
	try {
		const response = await fetchImpl(`${config.baseUrl}/v1/models`, {
			method: "GET",
			headers: { Authorization: `Bearer ${config.apiKey}` },
			signal: AbortSignal.timeout(timeoutMs),
		});
		await response.text().catch(() => "");
		return response.ok;
	} catch {
		return false;
	}
}
