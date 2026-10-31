/**
 * Fleet's browser-safe view of the Prime Agent model catalog.
 *
 * The catalog itself comes from the Rust daemon (`get_model_catalog`), which
 * reads `models.json` and `auth.json` from disk on every call. This module is
 * the pure mapping layer: it turns `DaemonModel` records into the
 * `ChatModelInfo` shape the browser protocol declares.
 *
 * Two protocol fields are not on the daemon record:
 *
 * - `available` is provider-level only. The daemon's `configuredProviders` is a
 *   positive signal but over-reports: it counts any non-empty `models.json`
 *   `apiKey` string, including one that names an env var which is not set and
 *   therefore cannot be a working credential. The predicate here re-derives
 *   availability from the real credential sources instead
 *   ({@link providerAvailability}).
 * - `version` is never emitted by the daemon and is optional in the protocol, so
 *   it is omitted rather than invented.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatModelInfo, ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import { configuredProviderIds } from "./agent-auth-store";
import { listCustomProviders } from "./custom-provider-store";
import type { DaemonModel, DaemonModelCatalog } from "./daemon-protocol";
import { providerEnvVarCandidates } from "./prime-provider-env-map";
import { supportedThinkingLevels } from "./thinking-levels";

/**
 * A `models.json` `apiKey` value shaped like an env-var reference rather than a
 * pasted secret: an upper-snake-case identifier with no lowercase letters or
 * other credential characters.
 */
const ENV_VAR_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Whether a `models.json` `apiKey` value is plausibly a usable credential.
 *
 * The engine (`resolve-config-value.js`) resolves this value in three ways:
 * `!command` runs a shell command and uses its stdout, a value naming a *set*
 * env var uses that variable, and anything else is used as the literal key.
 * Crucially it does no shape analysis, so an unset env-var name is silently
 * sent as the literal key.
 *
 * That last case is why this check exists: the daemon counts any non-empty
 * `apiKey` string as configured, so a `models.json` pointing at an unset env var
 * reports available models that cannot authenticate. Fleet reports it as
 * unavailable instead.
 *
 * The test is heuristic, and its failure mode is a false negative: a literal key
 * that happens to be all-uppercase with no digits or punctuation looks exactly
 * like an env-var name, so it is reported unavailable even though the engine
 * would use it. Real provider keys contain lowercase letters or punctuation, so
 * this is narrow, and the alternative (trusting every non-empty string) is the
 * over-report the daemon already makes.
 */
function declaredApiKeyResolves(declared: unknown, env: NodeJS.Dict<string>): boolean {
	if (typeof declared !== "string" || declared.length === 0) return false;
	// `!command`: the engine executes it and uses stdout. Fleet must not run a
	// configured shell command from a read-only catalog query, so this counts as
	// a credential attempt even though the command may fail at use time.
	if (declared.startsWith("!")) return true;
	if (!ENV_VAR_NAME_PATTERN.test(declared)) return true;
	return (env[declared] ?? "").length > 0;
}

/**
 * Ambient credential presence for the two providers whose env auth is not a
 * plain api-key variable, mirroring `getEnvApiKey` in
 * `@earendil-works/pi-ai/dist/env-api-keys.js`.
 *
 * Both are checked only after their api-key variable, matching the engine's
 * precedence.
 */
function hasAmbientCredential(provider: string, env: NodeJS.Dict<string>): boolean {
	if (provider === "google-vertex") {
		const hasProject = Boolean(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT);
		const hasLocation = Boolean(env.GOOGLE_CLOUD_LOCATION);
		if (!hasProject || !hasLocation) return false;
		const gacPath = env.GOOGLE_APPLICATION_CREDENTIALS;
		return existsSync(gacPath || join(homedir(), ".config", "gcloud", "application_default_credentials.json"));
	}
	if (provider === "amazon-bedrock") {
		return Boolean(
			env.AWS_PROFILE ||
				(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) ||
				env.AWS_BEARER_TOKEN_BEDROCK ||
				env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
				env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
				env.AWS_WEB_IDENTITY_TOKEN_FILE,
		);
	}
	return false;
}

/**
 * Whether the engine would find a credential for `provider` in the process
 * environment alone.
 *
 * Reads every env var the engine consults for the provider, in its precedence
 * order, then the ambient (cloud-SDK) sources. `PRIME_PROVIDER_ENV_MAP` alone is
 * not enough: `anthropic`, `github-copilot`, `google-vertex` and
 * `amazon-bedrock` resolve through more than one variable or through ADC/AWS
 * credentials.
 */
export function hasEnvironmentCredential(provider: string, env: NodeJS.Dict<string> = process.env): boolean {
	for (const envVar of providerEnvVarCandidates(provider)) {
		if ((env[envVar] ?? "").length > 0) return true;
	}
	return hasAmbientCredential(provider, env);
}

/**
 * The provider-level availability predicate for one catalog snapshot.
 *
 * True when any credential source is present:
 *
 * 1. `auth.json` has an entry for the provider (what Fleet writes);
 * 2. the provider's environment credentials are present (see
 *    {@link hasEnvironmentCredential});
 * 3. `models.json` declares a resolvable `apiKey` for it.
 *
 * Source 2 corrects a bug in the retired SDK path, which hard-codes
 * `configured: false` for environment candidates and therefore reported a
 * working `GROQ_API_KEY` — or `ANTHROPIC_API_KEY` — as unavailable.
 */
export async function providerAvailability(
	agentDir: string,
	env: NodeJS.Dict<string> = process.env,
): Promise<(provider: string) => boolean> {
	const storedProviders = await configuredProviderIds(agentDir).catch(() => new Set<string>());
	const declaredKeys = listCustomProviders(`${agentDir}/models.json`);
	const usableDeclared = new Set<string>();
	for (const [providerId, entry] of Object.entries(declaredKeys)) {
		if (declaredApiKeyResolves(entry.apiKey, env)) usableDeclared.add(providerId);
	}
	return (provider: string): boolean => {
		if (storedProviders.has(provider)) return true;
		if (hasEnvironmentCredential(provider, env)) return true;
		return usableDeclared.has(provider);
	};
}

/** Map one daemon model onto the wire shape, keeping the existing thinking-level rule. */
export function toChatModelInfo(model: DaemonModel, available: boolean): ChatModelInfo {
	const thinkingLevels = supportedThinkingLevels(model);
	const fallback: ChatThinkingLevel = model.reasoning ? "medium" : "off";
	return {
		key: `${model.provider}/${model.id}`,
		provider: model.provider,
		id: model.id,
		name: model.name,
		reasoning: model.reasoning,
		input: model.input,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		available,
		thinkingLevels,
		defaultThinkingLevel: thinkingLevels.includes(fallback) ? fallback : (thinkingLevels[0] ?? "off"),
	};
}

/** Map a whole catalog snapshot onto the wire shape. */
export function toChatModelInfoList(
	catalog: DaemonModelCatalog,
	isProviderAvailable: (provider: string) => boolean,
): ChatModelInfo[] {
	return catalog.models.map((model) => toChatModelInfo(model, isProviderAvailable(model.provider)));
}

/** Whether the catalog contains exactly this model. */
export function catalogHasModel(catalog: DaemonModelCatalog, provider: string, id: string): boolean {
	return catalog.models.some((model) => model.provider === provider && model.id === id);
}

/**
 * The first credential-configured model id of `provider`, matching what the
 * retired registry fallback did with `getAvailable()` (its auth-filtered list).
 */
export function firstAvailableModelId(
	catalog: DaemonModelCatalog,
	isProviderAvailable: (provider: string) => boolean,
	provider: string,
): string | undefined {
	return catalog.models.find((model) => model.provider === provider && isProviderAvailable(model.provider))?.id;
}
