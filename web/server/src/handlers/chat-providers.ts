import { existsSync, readFileSync } from "node:fs";
import { getProviders } from "@earendil-works/pi-ai";
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth";
import {
	ChatProviderRemoveRequestSchema,
	ChatProviderUpdateRequestSchema,
} from "@prime-agent/web-protocol/chat-protocol.zod";
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
};

type CustomProviderEntry = {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	models?: Array<{ id: string }>;
};

type CustomProvidersMap = Record<string, CustomProviderEntry>;

function readCustomProviders(modelsJsonPath: string): CustomProvidersMap {
	try {
		if (!existsSync(modelsJsonPath)) return {};
		const raw = readFileSync(modelsJsonPath, "utf-8");
		const parsed = JSON.parse(raw) as { providers?: CustomProvidersMap };
		return parsed.providers ?? {};
	} catch {
		return {};
	}
}

function buildProviders() {
	const config = getPrimeConfig();
	const oauthIds = new Set(getOAuthProviders().map((p) => p.id));

	const custom = readCustomProviders(`${config.agentDir}/models.json`);
	const builtinIds = new Set<string>(getProviders());
	const allIds = new Set<string>([...builtinIds, ...Object.keys(custom)]);

	return Array.from(allIds)
		.map((id) => {
			const isCustom = !builtinIds.has(id);
			const customEntry = custom[id];
			const status = config.modelRegistry.getProviderAuthStatus(id);
			const name = isCustom ? (customEntry?.name ?? id) : (BUILT_IN_PROVIDER_DISPLAY_NAMES[id] ?? id);
			const envVarName = isCustom ? (customEntry?.apiKey ?? "") : (PRIME_PROVIDER_ENV_MAP[id] ?? "");
			return {
				id,
				name,
				envVarName,
				...(oauthIds.has(id) ? { authType: "oauth" as const } : {}),
				isConfigured: status.configured,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function handleChatProvidersGet(_request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		return Response.json({ providers: buildProviders() });
	});
}

export function handleChatProvidersPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = ChatProviderUpdateRequestSchema.parse(raw);
		const config = getPrimeConfig();
		config.authStorage.set(body.providerId, {
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
		config.authStorage.remove(body.providerId);
		config.reloadAuth();
		return Response.json({
			success: true,
			providers: buildProviders(),
		});
	});
}
