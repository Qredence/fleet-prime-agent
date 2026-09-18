/**
 * TypeSafe (System One) runtime configuration.
 *
 * Environment is read here and nowhere else in the server, mirroring how
 * `prime-config.ts` owns the `~/.prime/agent` surface. The API key never leaves
 * this process: it is not logged, not returned by any handler, and not part of
 * any response envelope.
 *
 * Absence of a key means the feature is off by construction. There is no second
 * switch that can turn it on without one.
 */

export type TypeSafeLogLevel = "debug" | "info" | "warn" | "error" | "off";

export type TypeSafeRuntimeConfig = {
	/** True when a key is present and the operator has not disabled the feature. */
	readonly configured: boolean;
	readonly apiKey: string | undefined;
	readonly baseUrl: string;
	readonly model: string;
	/** Per-attempt ceiling for composer intent routing. */
	readonly intentTimeoutMs: number;
	/** Retries after the initial attempt, for intent routing only. */
	readonly intentMaxRetries: number;
	readonly logLevel: TypeSafeLogLevel;
};

export const DEFAULT_TYPESAFE_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_TYPESAFE_MODEL = "jev-latest";
export const DEFAULT_TYPESAFE_INTENT_TIMEOUT_MS = 1_500;
export const DEFAULT_TYPESAFE_INTENT_MAX_RETRIES = 1;

const LOG_LEVELS: ReadonlyArray<TypeSafeLogLevel> = ["debug", "info", "warn", "error", "off"];

function positiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Whether a configured base URL may carry a credential.
 *
 * The API key travels as a bearer token on every request, so an `http:` endpoint
 * would put it on the wire in cleartext for any network observer. Only HTTPS is
 * accepted, with loopback HTTP allowed because that traffic never leaves the
 * machine.
 */
function isCredentialSafeBaseUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol === "https:") return true;
	if (url.protocol !== "http:") return false;
	const host = url.hostname.replace(/^\[|\]$/g, "");
	return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLogLevel(value: string | undefined): value is TypeSafeLogLevel {
	return value !== undefined && (LOG_LEVELS as ReadonlyArray<string>).includes(value);
}

/**
 * Reads the TypeSafe configuration.
 *
 * `storedKey` is a key the user saved in Settings. It **wins** over the
 * environment variable, matching the runtime's own credential order (auth.json
 * before environment) so every credential in the app resolves the same way. The
 * environment remains the fallback, so deployments that set it are unaffected.
 *
 * `TYPESAFE_BASE_URL` and `TYPESAFE_MODEL` use the same names the official
 * SDK reads, so moving to the SDK later needs no environment change.
 */
export function readTypeSafeConfig(env: NodeJS.Dict<string> = process.env, storedKey?: string): TypeSafeRuntimeConfig {
	const apiKey = (storedKey ?? "").trim() || (env.TYPESAFE_API_KEY ?? "").trim() || undefined;
	const killed = (env.FLEET_TYPESAFE_ENABLED ?? "").trim() === "0";
	const requestedBaseUrl = (env.TYPESAFE_BASE_URL ?? "").trim().replace(/\/+$/, "");
	// An endpoint that would leak the key is treated as unusable rather than
	// silently replaced with the default: falling back would send the credential
	// to a host the operator did not configure.
	const baseUrlUsable = requestedBaseUrl === "" || isCredentialSafeBaseUrl(requestedBaseUrl);
	return {
		configured: Boolean(apiKey) && !killed && baseUrlUsable,
		apiKey,
		baseUrl: requestedBaseUrl || DEFAULT_TYPESAFE_BASE_URL,
		model: (env.TYPESAFE_MODEL ?? "").trim() || DEFAULT_TYPESAFE_MODEL,
		intentTimeoutMs: positiveInt(env.TYPESAFE_INTENT_TIMEOUT_MS, DEFAULT_TYPESAFE_INTENT_TIMEOUT_MS),
		intentMaxRetries: nonNegativeInt(env.TYPESAFE_INTENT_MAX_RETRIES, DEFAULT_TYPESAFE_INTENT_MAX_RETRIES),
		logLevel: isLogLevel(env.TYPESAFE_LOG_LEVEL) ? env.TYPESAFE_LOG_LEVEL : "warn",
	};
}
