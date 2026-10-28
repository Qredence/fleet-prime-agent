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
import { configuredProviderIds, removeProviderCredential, setProviderApiKey } from "../agent-auth-store";
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

/**
 * Stores a provider key in `auth.json` and turns a refusal into the same 400
 * the other provider validation uses.
 */
async function storeApiKey(agentDir: string, providerId: string, apiKey: string): Promise<void> {
	const outcome = await setProviderApiKey(agentDir, providerId, apiKey);
	if (outcome.status === "refused") badRequest(outcome.reason);
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

/**
 * Providers whose OAuth flow the runtime supports.
 *
 * Mirrors `getOAuthProviders()` from the SDK, now that the provider list no
 * longer reads the SDK at runtime. Chromium-based Copilot auth is the reason
 * this cannot be inferred from the catalog.
 */
const BUILTIN_OAUTH_PROVIDER_IDS = ["anthropic", "github-copilot", "openai-codex", "xai"] as const;

/** `prime-agent-traces` is diagnostics, not a model provider. */
function isLlmsProviderId(providerId: string): boolean {
	return providerId !== "prime-agent-traces";
}

function buildProviders(configuredFromDisk?: ReadonlySet<string>): Array<ChatProviderInfo> {
	const config = getPrimeConfig();
	const oauthIds = new Set(BUILTIN_OAUTH_PROVIDER_IDS);

	const custom = listCustomProviders(`${config.agentDir}/models.json`);
	// Derived from the catalog Fleet ships rather than the SDK's model registry.
	// The registry only lists providers that have a bundled model, so reading it
	// made the pane depend on the SDK's build, and every provider it knows already
	// has a display name here.
	const builtinIds = new Set<string>(Object.keys(BUILT_IN_PROVIDER_DISPLAY_NAMES).filter(isLlmsProviderId));
	const allIds = new Set<string>([...builtinIds, ...Object.keys(custom)]);
	// A provider whose credentials exist only in `auth.json` is still real: it
	// was configured by the runtime or an earlier Fleet build. Listing only the
	// catalog and models.json hid those providers entirely, so they could not be
	// reviewed or removed. MCP entries key as `mcp:<service>` and are not
	// model providers, so they stay out of this list.
	for (const providerId of configuredFromDisk ?? []) {
		if (!providerId.startsWith("mcp:")) allIds.add(providerId);
	}
	// The generic OpenAI Chat Completions slot is always offered, even before a
	// models.json entry exists, so its "add named instance" flow stays visible.
	allIds.add(OPENAI_CHAT_COMPLETIONS_PROVIDER_ID);

	return [...allIds]
		.map((id) => {
			const isCustom = !builtinIds.has(id);
			const customEntry = isCustom ? custom[id] : undefined;
			// `configuredFromDisk` is authoritative: it reflects `auth.json` as it
			// exists now, including a credential Fleet wrote moments ago.
			const configured = configuredFromDisk?.has(id) ?? false;
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
				isConfigured: configured,
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

/**
 * Providers with credentials read from `auth.json`.
 *
 * Async and disk-backed so a caller can never observe the stale in-memory view
 * the runtime registry would have returned.
 */
export async function listChatProviders(): Promise<Array<ChatProviderInfo>> {
	return buildProviders(await configuredProviderIds(getPrimeConfig().agentDir));
}

export function handleChatProvidersGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const configured = await configuredProviderIds(getPrimeConfig().agentDir);
		return Response.json({ providers: buildProviders(configured) });
	}, _request);
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
			await storeApiKey(config.agentDir, body.providerId, body.apiKey);
			config.reloadAuth();
			return Response.json({
				success: true,
				providers: buildProviders(await configuredProviderIds(config.agentDir)),
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
			const existingIds = new Set<string>([
				...Object.keys(BUILT_IN_PROVIDER_DISPLAY_NAMES).filter(isLlmsProviderId),
				...Object.keys(listCustomProviders(modelsJsonPath)),
			]);
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
		await upsertCustomProvider(modelsJsonPath, providerId, {
			...(displayName ? { name: displayName } : {}),
			baseUrl,
			api,
			apiKey: envVarNameForManagedProvider(providerId),
			models: modelIds.map((id) => ({ id })),
		});
		await storeApiKey(config.agentDir, providerId, body.apiKey);
		config.reloadAuth();
		return Response.json({
			success: true,
			providers: buildProviders(await configuredProviderIds(config.agentDir)),
		});
	}, request);
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
			await removeCustomProvider(`${config.agentDir}/models.json`, body.providerId);
		}
		const removal = await removeProviderCredential(config.agentDir, body.providerId);
		if (removal.status === "refused") badRequest(removal.reason);
		config.reloadAuth();
		return Response.json({
			success: true,
			providers: buildProviders(await configuredProviderIds(config.agentDir)),
		});
	}, request);
}
