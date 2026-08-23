import { getProviders } from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import type { ChatProviderInfo } from "@prime-agent/web-protocol/chat-protocol";
import {
	ChatProviderRemoveRequestSchema,
	ChatProviderUpdateRequestSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
import {
	allocateProviderId,
	isCustomProviderId,
	isNamedOccInstanceId,
	isOccProviderId,
	isPiCustomProviderApi,
	KNOWN_PROVIDERS,
	normalizeCustomProviderInstance,
	OPENAI_CHAT_COMPLETIONS_PROVIDER_ID,
	toCustomProviderId,
	toInstanceSlug,
	toOccInstanceId,
} from "@prime-agent/web-protocol/provider-catalog";
import {
	envVarNameForManagedProvider,
	isDiscoverableEntry,
	listCustomProviders,
	removeCustomProvider,
	uiApiForCustomProvider,
	upsertCustomProvider,
} from "../custom-provider-store";
import { getPrimeConfig } from "../prime-config";
import { PRIME_PROVIDER_ENV_MAP } from "../prime-provider-env-map";
import { wrapApiHandler } from "../wrap-api-handler";

const BUILT_IN_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	anthropic: "Anthropic",
	"amazon-bedrock": "Amazon Bedrock",
	"azure-openai-responses": "Azure OpenAI Responses",
	cerebras: "Cerebras",
	"cloudflare-ai-gateway": "Cloudflare AI Gateway",
	"cloudflare-workers-ai": "Cloudflare Workers AI",
	deepseek: "DeepSeek",
	fireworks: "Fireworks",
	google: "Google Gemini",
	"google-vertex": "Google Vertex AI",
	groq: "Groq",
	huggingface: "Hugging Face",
	"kimi-coding": "Kimi For Coding",
	mistral: "Mistral",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax (China)",
	moonshotai: "Moonshot AI",
	"moonshotai-cn": "Moonshot AI (China)",
	opencode: "OpenCode Zen",
	"opencode-go": "OpenCode Go",
	openai: "OpenAI",
	"openai-codex": "OpenAI Codex",
	openrouter: "OpenRouter",
	"prime-agent-traces": "Prime Agent Traces",
	"prime-inference": "Prime Inference",
	"vercel-ai-gateway": "Vercel AI Gateway",
	xai: "xAI",
	zai: "ZAI",
	xiaomi: "Xiaomi MiMo",
	"xiaomi-token-plan-cn": "Xiaomi MiMo Token Plan (China)",
	"xiaomi-token-plan-ams": "Xiaomi MiMo Token Plan (Amsterdam)",
	"xiaomi-token-plan-sgp": "Xiaomi MiMo Token Plan (Singapore)",
	"github-copilot": "GitHub Copilot",
};

const KNOWN_PROVIDER_BY_ID = new Map(KNOWN_PROVIDERS.map((provider) => [provider.id, provider]));

/**
 * Builtin credential env-var hints that live outside pi-ai's `envMap` mirror:
 * anthropic's key is special-cased in `packages/ai/src/env-api-keys.ts`
 * (after `ANTHROPIC_OAUTH_TOKEN`), and Bedrock accepts a static bearer token.
 * These extend the mirror, they do not fork it — see `PRIME_PROVIDER_ENV_MAP`.
 */
const EXTRA_BUILTIN_ENV_HINTS: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	"amazon-bedrock": "AWS_BEARER_TOKEN_BEDROCK",
};

/** Env-var hint shown next to the credential field for a builtin provider. */
function envHintForBuiltin(providerId: string): string {
	return PRIME_PROVIDER_ENV_MAP[providerId] ?? EXTRA_BUILTIN_ENV_HINTS[providerId] ?? "";
}

function badRequest(message: string): never {
	throw Object.assign(new Error(message), { status: 400 });
}

export function resolveProviderAuthFields(
	providerId: string,
	envVarName: string,
	oauthProviderIds: ReadonlySet<string>,
): { authType?: "apiKey" | "oauth"; supportsOAuth?: boolean } {
	if (!oauthProviderIds.has(providerId)) return {};

	const knownProvider = KNOWN_PROVIDER_BY_ID.get(providerId);
	const oauthOnly = knownProvider?.authType === "oauth" || (knownProvider === undefined && !envVarName);
	return {
		authType: oauthOnly ? "oauth" : "apiKey",
		supportsOAuth: true,
	};
}

function buildProviders(): Array<ChatProviderInfo> {
	const config = getPrimeConfig();
	const oauthIds = new Set(getOAuthProviders().map((p) => p.id));

	const custom = listCustomProviders(`${config.agentDir}/models.json`);
	const builtinIds = new Set<string>(getProviders());
	const allIds = new Set<string>([...builtinIds, ...Object.keys(custom)]);
	// The generic OpenAI Chat Completions slot is always offered, even before a
	// models.json entry exists, so its "add named instance" flow stays visible.
	allIds.add(OPENAI_CHAT_COMPLETIONS_PROVIDER_ID);

	return [...allIds]
		.map((id) => {
			const isCustom = !builtinIds.has(id);
			const customEntry = isCustom ? custom[id] : undefined;
			const status = config.modelRegistry.getProviderAuthStatus(id);
			const catalogEntry = KNOWN_PROVIDER_BY_ID.get(id);
			const name = isCustom
				? (customEntry?.name ?? catalogEntry?.name ?? id)
				: (BUILT_IN_PROVIDER_DISPLAY_NAMES[id] ?? catalogEntry?.name ?? id);
			const envVarName = isCustom ? (customEntry?.apiKey ?? catalogEntry?.envVarName ?? "") : envHintForBuiltin(id);
			const authFields = resolveProviderAuthFields(id, envVarName, oauthIds);

			const row: ChatProviderInfo = {
				id,
				name,
				envVarName,
				...authFields,
				isConfigured: status.configured,
			};

			if (isOccProviderId(id) || isCustomProviderId(id)) {
				row.providerFamily = isOccProviderId(id) ? OPENAI_CHAT_COMPLETIONS_PROVIDER_ID : "custom";
				if (customEntry?.name && (isNamedOccInstanceId(id) || isCustomProviderId(id))) {
					row.displayName = customEntry.name;
				}
				const customApi = uiApiForCustomProvider(customEntry?.api);
				if (customApi) row.api = customApi;
				if (customEntry?.baseUrl) row.baseUrl = customEntry.baseUrl;
				row.modelIds = (customEntry?.models ?? []).map((model) => model.id);
				row.discoverable = isDiscoverableEntry(customEntry);
			}
			return row;
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function listChatProviders(): Array<ChatProviderInfo> {
	return buildProviders();
}

export function handleChatProvidersGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		return Response.json({ providers: buildProviders() });
	});
}

function requireBaseUrl(baseUrl: string | undefined, providerId: string): string {
	const trimmed = baseUrl?.trim() ?? "";
	if (!trimmed) {
		badRequest(`baseUrl is required for ${providerId}`);
	}
	try {
		const parsed = new URL(trimmed);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			badRequest(`baseUrl must be an http(s) URL for ${providerId}`);
		}
	} catch (error) {
		if (error && typeof error === "object" && "status" in error) throw error;
		badRequest(`baseUrl must be an http(s) URL for ${providerId}`);
	}
	return trimmed;
}

export function handleChatProvidersPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = ChatProviderUpdateRequestSchema.parse(raw);
		const config = getPrimeConfig();
		const modelsJsonPath = `${config.agentDir}/models.json`;

		const isNewCustom = body.providerId === "custom";
		const isNewOccInstance =
			body.providerId === OPENAI_CHAT_COMPLETIONS_PROVIDER_ID && body.createOccInstance === true;
		const isManagedProvider = isNewCustom || isCustomProviderId(body.providerId) || isOccProviderId(body.providerId);
		const isDefaultOccSlot = body.providerId === OPENAI_CHAT_COMPLETIONS_PROVIDER_ID && !isNewOccInstance;

		if (!isManagedProvider) {
			// Plain catalog provider: credentials only, no models.json involvement.
			config.authStorage.set(body.providerId, {
				type: "api_key",
				key: body.apiKey,
			});
			config.reloadAuth();
			return Response.json({
				success: true,
				providers: buildProviders(),
			});
		}

		// Custom provider / OCC family: register (or update) the provider in
		// prime-agent's models.json, then store the key under the final id.
		let providerId = body.providerId;
		if (isNewCustom || isNewOccInstance) {
			const displayName = body.displayName?.trim() ?? "";
			if (!displayName) {
				badRequest("displayName is required when creating a new provider instance");
			}
			const existingIds = new Set<string>([...getProviders(), ...Object.keys(listCustomProviders(modelsJsonPath))]);
			providerId = allocateProviderId(
				toInstanceSlug(displayName),
				existingIds,
				isNewCustom ? toCustomProviderId : toOccInstanceId,
			);
		}

		const existingEntry = listCustomProviders(modelsJsonPath)[providerId];
		const api =
			body.api ??
			(uiApiForCustomProvider(existingEntry?.api)
				? uiApiForCustomProvider(existingEntry?.api)
				: "openai-completions");
		if (!isPiCustomProviderApi(api)) {
			badRequest(`unsupported api "${api}" for ${providerId}`);
		}
		const baseUrl = requireBaseUrl(body.baseUrl?.trim() || existingEntry?.baseUrl, providerId);
		const { modelIds } = normalizeCustomProviderInstance({
			modelId: body.modelId ?? existingEntry?.models?.[0]?.id,
			api,
			modelIds: body.models ?? existingEntry?.models?.map((model) => model.id),
		});
		if (modelIds.length === 0) {
			badRequest(
				isDefaultOccSlot
					? `modelId is required for ${providerId}`
					: `at least one model id is required for ${providerId}`,
			);
		}

		const displayName = body.displayName?.trim() || existingEntry?.name;
		upsertCustomProvider(modelsJsonPath, providerId, {
			...(displayName ? { name: displayName } : {}),
			baseUrl,
			api,
			apiKey: envVarNameForManagedProvider(providerId),
			models: modelIds.map((id) => ({ id })),
		});
		config.authStorage.set(providerId, {
			type: "api_key",
			key: body.apiKey,
		});
		config.reloadAuth();
		return Response.json({
			success: true,
			providers: buildProviders(),
		});
	});
}

export function handleChatProvidersDelete(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = ChatProviderRemoveRequestSchema.parse(raw);
		const config = getPrimeConfig();

		if (isCustomProviderId(body.providerId) || isOccProviderId(body.providerId)) {
			// Removing the registration for a UI-managed provider must not leave a
			// stale models.json entry behind (the default OCC slot stays listed via
			// the synthesized row even after removal).
			removeCustomProvider(`${config.agentDir}/models.json`, body.providerId);
		}
		config.authStorage.remove(body.providerId);
		config.reloadAuth();
		return Response.json({
			success: true,
			providers: buildProviders(),
		});
	});
}
