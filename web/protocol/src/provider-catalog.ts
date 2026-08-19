import type { PiCustomProviderApi } from "./chat-protocol";

/** How a provider is authenticated: a static API key or an OAuth flow. */
export type PiProviderAuthType = "apiKey" | "oauth";

/**
 * The Pi API families supported by native custom providers, typed off the
 * {@link PiCustomProviderApi} union so adding a family updates every consumer
 * (store validation, Settings catalog, base-URL policy) in one place. The
 * keyed record forces a compile-time error when a union member is added
 * without registering it here.
 */
const PI_CUSTOM_PROVIDER_API_SET: Record<PiCustomProviderApi, true> = {
	"openai-completions": true,
	"openai-responses": true,
	"anthropic-messages": true,
	"google-genai": true,
};

export const PI_CUSTOM_PROVIDER_APIS: ReadonlyArray<PiCustomProviderApi> = Object.keys(
	PI_CUSTOM_PROVIDER_API_SET,
) as Array<PiCustomProviderApi>;

/** True for the OpenAI-compatible custom-provider families (OCC-style URLs). */
export function isOccFamilyApi(api: PiCustomProviderApi): boolean {
	return api === "openai-completions" || api === "openai-responses";
}

export function isPiCustomProviderApi(value: unknown): value is PiCustomProviderApi {
	return typeof value === "string" && (PI_CUSTOM_PROVIDER_APIS as ReadonlyArray<string>).includes(value);
}

/**
 * A provider as surfaced in Fleet's Settings UI, with the single environment
 * variable used to detect whether it is configured.
 */
export type PiProviderCredentialEntry = {
	id: string;
	name: string;
	envVarName: string;
	authType?: PiProviderAuthType;
};

/**
 * Catalog of providers shown in Fleet's Settings. This is the user-facing
 * credential surface; it is intentionally a subset of Pi's full provider list
 * (see {@link PI_LLM_RUNTIME_PROVIDER_IDS}).
 */
export const PI_PROVIDER_CATALOG = [
	{
		id: "amazon-bedrock",
		name: "Amazon Bedrock",
		envVarName: "AWS_ACCESS_KEY_ID",
	},
	{
		id: "openai",
		name: "OpenAI",
		envVarName: "OPENAI_API_KEY",
	},
	{
		id: "openai-chat-completions",
		name: "OpenAI Chat Completions",
		envVarName: "OPENAI_CHAT_COMPLETIONS_API_KEY",
	},
	{
		id: "openai-chat-completions-base-url",
		name: "OpenAI Chat Completions Base URL",
		envVarName: "OPENAI_CHAT_COMPLETIONS_BASE_URL",
	},
	{
		id: "openai-chat-completions-model",
		name: "OpenAI Chat Completions Model",
		envVarName: "OPENAI_CHAT_COMPLETIONS_MODEL",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		envVarName: "ANTHROPIC_API_KEY",
	},
	{
		id: "google-vertex",
		name: "Google Vertex",
		envVarName: "GOOGLE_APPLICATION_CREDENTIALS",
	},
	{
		id: "google",
		name: "Google Gemini",
		envVarName: "GEMINI_API_KEY",
	},
	{
		id: "mistral",
		name: "Mistral",
		envVarName: "MISTRAL_API_KEY",
	},
	{
		id: "groq",
		name: "Groq",
		envVarName: "GROQ_API_KEY",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		envVarName: "OPENROUTER_API_KEY",
	},
	{
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		envVarName: "AI_GATEWAY_API_KEY",
	},
	{
		id: "github-copilot",
		name: "GitHub Copilot",
		envVarName: "GITHUB_COPILOT_TOKEN",
		authType: "oauth",
	},
	{
		id: "ollama",
		name: "Ollama",
		envVarName: "OLLAMA_BASE_URL",
	},
	{
		id: "daytona",
		name: "Daytona",
		envVarName: "DAYTONA_API_KEY",
	},
	{
		id: "daytona-target",
		name: "Daytona Target",
		envVarName: "DAYTONA_TARGET",
	},
] satisfies Array<PiProviderCredentialEntry>;

/**
 * Providers in {@link PI_PROVIDER_CATALOG} that are infrastructure/config
 * rather than end-user-selectable LLMs. Excluded from credential UI and LLM
 * scrub-behavior (e.g. sandbox providers and the OpenAI-compatible companion
 * base-URL/model entries).
 */
export const INFRA_PROVIDER_IDS = [
	"daytona",
	"daytona-target",
	"openai-chat-completions-base-url",
	"openai-chat-completions-model",
] as const;

export const OPENAI_CHAT_COMPLETIONS_PROVIDER_ID = "openai-chat-completions";
export const OPENAI_CHAT_COMPLETIONS_BASE_URL_PROVIDER_ID = "openai-chat-completions-base-url";
export const OPENAI_CHAT_COMPLETIONS_MODEL_PROVIDER_ID = "openai-chat-completions-model";

/**
 * Prefix for **named OpenAI Chat Completions instance** provider ids. The
 * reserved {@link OPENAI_CHAT_COMPLETIONS_PROVIDER_ID} id stays the
 * default/gateway slot; additional user-added instances get ids of the form
 * `openai-chat-completions+<slug>` so a user can configure multiple
 * OpenAI-compatible backends (e.g. OpenCode Zen, Nebius) independently.
 */
export const OCC_INSTANCE_ID_PREFIX = `${OPENAI_CHAT_COMPLETIONS_PROVIDER_ID}+`;

/**
 * Prefix for **general custom provider** instance ids. Any OpenAI/Anthropic/
 * Google-compatible endpoint a user adds gets an id of the form
 * `custom+<slug>` so it can be registered through Pi's native
 * `registerProvider`/`composeModelProvider` path independently of the reserved
 * OpenAI Chat Completions default slot.
 */
export const CUSTOM_PROVIDER_ID_PREFIX = "custom+";

/**
 * Determines whether a provider ID belongs to the general custom provider
 * family (a user-added `custom+<slug>` instance).
 *
 * @param providerId - The provider ID to classify
 * @returns `true` if the ID starts with the custom instance prefix, `false` otherwise
 */
export function isCustomProviderId(providerId: string): boolean {
	return providerId.startsWith(CUSTOM_PROVIDER_ID_PREFIX);
}

/**
 * Determines whether a provider ID belongs to the OpenAI Chat Completions family.
 *
 * @param providerId - The provider ID to classify
 * @returns `true` if the ID is the default or a named OpenAI Chat Completions provider ID, `false` otherwise
 */
export function isOccProviderId(providerId: string): boolean {
	return providerId === OPENAI_CHAT_COMPLETIONS_PROVIDER_ID || providerId.startsWith(OCC_INSTANCE_ID_PREFIX);
}

/**
 * Determines whether a provider ID uses the named OpenAI Chat Completions instance prefix.
 *
 * @returns `true` if the provider ID starts with the named instance prefix, `false` otherwise.
 */
export function isNamedOccInstanceId(providerId: string): boolean {
	return providerId.startsWith(OCC_INSTANCE_ID_PREFIX);
}

const OCC_SLUG_MAX_LENGTH = 48;

/**
 * Creates a normalized slug for a named provider instance from a display name.
 *
 * @param displayName - The instance display name to normalize
 * @returns A lowercase, accent-free, hyphenated slug of up to 48 characters, or `provider` when the name produces an empty slug
 */
export function toInstanceSlug(displayName: string): string {
	const slug = displayName
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, OCC_SLUG_MAX_LENGTH)
		.replace(/^-+|-+$/g, "");
	return slug || "provider";
}

/**
 * Creates a normalized slug for an OpenAI Chat Completions instance from a display name.
 *
 * @param displayName - The instance display name to normalize
 * @returns A lowercase, accent-free, hyphenated slug of up to 48 characters, or `occ` when the name produces an empty slug
 */
export function toOccInstanceSlug(displayName: string): string {
	const slug = toInstanceSlug(displayName);
	return slug === "provider" ? "occ" : slug;
}

/**
 * Constructs an OpenAI Chat Completions instance ID from a validated slug.
 *
 * @param slug - The validated instance slug
 * @returns The instance ID with the OpenAI Chat Completions prefix
 */
export function toOccInstanceId(slug: string): string {
	return `${OCC_INSTANCE_ID_PREFIX}${slug}`;
}

/**
 * Constructs a general custom provider ID from a validated slug.
 *
 * @param slug - The validated custom provider slug
 * @returns The provider ID with the custom provider prefix
 */
export function toCustomProviderId(slug: string): string {
	return `${CUSTOM_PROVIDER_ID_PREFIX}${slug}`;
}

/**
 * Finds an available provider id for a base slug, appending `-2`, `-3`, … then
 * a timestamp suffix when the slug is taken. Shared by the Postgres-backed and
 * local file store instance allocators so id allocation stays consistent.
 *
 * @param baseSlug - The slug to start from
 * @param existingIds - Ids that are already taken
 * @param toId - A function that builds the provider id from a slug
 * @returns An available provider id
 */
export function allocateProviderId(
	baseSlug: string,
	existingIds: ReadonlySet<string>,
	toId: (slug: string) => string,
): string {
	for (let attempt = 1; attempt <= 50; attempt++) {
		const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
		const id = toId(slug);
		if (!existingIds.has(id)) return id;
	}
	return toId(`${baseSlug}-${Date.now().toString(36)}`);
}

/**
 * Normalizes a custom provider instance's API family and model list. New rows
 * store a `modelIds` array; legacy rows carry only `modelId`. Shared by the
 * Postgres-backed and local file stores so persisted shapes stay identical.
 *
 * @returns The canonical `api` (defaults to `openai-completions`) and `modelIds` (falls back to `[modelId]`, then `[]`)
 */
export function normalizeCustomProviderInstance(instance: {
	modelId?: string;
	api?: PiCustomProviderApi;
	modelIds?: Array<string>;
}): { api: PiCustomProviderApi; modelIds: Array<string> } {
	const modelIds =
		instance.modelIds && instance.modelIds.length > 0
			? instance.modelIds
			: instance.modelId
				? [instance.modelId]
				: [];
	return {
		api: instance.api ?? "openai-completions",
		modelIds,
	};
}

/**
 * The Settings catalog as plain credential entries (structurally the same as
 * {@link PI_PROVIDER_CATALOG}; a stable, widened-typing view used by callers
 * that should not depend on the `as const` catalog literal).
 */
export const KNOWN_PROVIDERS: Array<PiProviderCredentialEntry> = PI_PROVIDER_CATALOG.map(
	({ id, name, envVarName, authType }) => ({
		id,
		name,
		envVarName,
		authType,
	}),
);

/** Pi LLM providers whose env vars are scrubbed on Vercel (excludes infra). */
export const LLM_PROVIDER_ENV_SCRUB_IDS = KNOWN_PROVIDERS.flatMap((provider) =>
	INFRA_PROVIDER_IDS.includes(provider.id as (typeof INFRA_PROVIDER_IDS)[number]) ? [] : [provider.id],
);

/**
 * Full Pi provider ids that can pick up org env / auth.json credentials.
 * On Vercel, `applyRuntimeAuth` clears these unless the user has BYOK.
 *
 * Authoritative sync source: `@earendil-works/pi-ai`
 * `packages/ai/src/env-api-keys.ts` (`envMap` / `getApiKeyEnvVars`); mirrored by
 * `packages/coding-agent/docs/providers.md`. When Pi adds a provider there, add
 * its id here and its env var to {@link PROVIDER_ENV_SCRUB_VAR_NAMES} — the
 * `provider-catalog.test.ts` integrity test fails if they diverge.
 */
export const PI_LLM_RUNTIME_PROVIDER_IDS = [
	"amazon-bedrock",
	"anthropic",
	"ant-ling",
	"openai",
	"azure-openai-responses",
	"nvidia",
	"deepseek",
	"google",
	"google-vertex",
	"groq",
	"cerebras",
	"xai",
	"radius",
	"openrouter",
	"vercel-ai-gateway",
	"zai",
	"zai-coding-cn",
	"mistral",
	"minimax",
	"minimax-cn",
	"moonshotai",
	"moonshotai-cn",
	"huggingface",
	"fireworks",
	"together",
	"opencode",
	"opencode-go",
	"kimi-coding",
	"cloudflare-workers-ai",
	"cloudflare-ai-gateway",
	"xiaomi",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-sgp",
	"github-copilot",
	"openai-chat-completions",
] as const;

/**
 * Providers shown in the Settings credential UI: the user-facing catalog minus
 * infra/config entries and OAuth-only providers (which authenticate via a login
 * flow rather than a pasted key).
 */
export const CREDENTIAL_UI_PROVIDERS = KNOWN_PROVIDERS.filter(
	(provider) =>
		!INFRA_PROVIDER_IDS.includes(provider.id as (typeof INFRA_PROVIDER_IDS)[number]) && provider.authType !== "oauth",
);

/**
 * Env vars scrubbed on Vercel so org keys never back chat or bash/tools.
 * Includes Fleet catalog vars plus the rest of Pi's provider env map
 * (e.g. `HF_TOKEN` for Hugging Face — not in CREDENTIAL_UI_PROVIDERS).
 */
export const PROVIDER_ENV_SCRUB_VAR_NAMES = Array.from(
	new Set([
		...KNOWN_PROVIDERS.flatMap((provider) =>
			LLM_PROVIDER_ENV_SCRUB_IDS.includes(provider.id) ||
			provider.id === OPENAI_CHAT_COMPLETIONS_BASE_URL_PROVIDER_ID ||
			provider.id === OPENAI_CHAT_COMPLETIONS_MODEL_PROVIDER_ID
				? [provider.envVarName]
				: [],
		),
		// Pi built-ins beyond Fleet's Settings catalog
		"HF_TOKEN",
		"ANT_LING_API_KEY",
		"AZURE_OPENAI_API_KEY",
		"NVIDIA_API_KEY",
		"DEEPSEEK_API_KEY",
		"GOOGLE_CLOUD_API_KEY",
		"CEREBRAS_API_KEY",
		"XAI_API_KEY",
		"RADIUS_API_KEY",
		"ZAI_API_KEY",
		"ZAI_CODING_CN_API_KEY",
		"MINIMAX_API_KEY",
		"MINIMAX_CN_API_KEY",
		"MOONSHOT_API_KEY",
		"FIREWORKS_API_KEY",
		"TOGETHER_API_KEY",
		"OPENCODE_API_KEY",
		"KIMI_API_KEY",
		"CLOUDFLARE_API_KEY",
		"CLOUDFLARE_ACCOUNT_ID",
		"CLOUDFLARE_GATEWAY_ID",
		"XIAOMI_API_KEY",
		"XIAOMI_TOKEN_PLAN_CN_API_KEY",
		"XIAOMI_TOKEN_PLAN_AMS_API_KEY",
		"XIAOMI_TOKEN_PLAN_SGP_API_KEY",
		"ANTHROPIC_OAUTH_TOKEN",
		"ANTHROPIC_OAUTH_KEY",
		"COPILOT_GITHUB_TOKEN",
		"GITHUB_COPILOT_TOKEN",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		// Org Daytona must not be readable by chat tools or Pi on Vercel
		"DAYTONA_API_KEY",
		"ORG_DAYTONA_API_KEY",
		// Org Daytona target/region config (not a secret, but org infra config that
		// must not be user-readable on Vercel, matching DAYTONA_API_KEY above).
		"DAYTONA_TARGET",
	]),
);
