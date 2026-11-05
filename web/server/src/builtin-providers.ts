/**
 * The Prime Agent built-in provider catalog Fleet ships.
 *
 * This is not the runtime's bundled model list; it is the set of providers
 * whose ids the runtime treats as built-ins. Two callers need to answer "is this
 * a built-in provider id?" without an SDK round trip and must answer it
 * identically: the Settings providers pane, and the `models.json` validator,
 * because the runtime applies stricter rules to non-built-in (custom) entries.
 *
 * It lives here rather than in a handler so shared server modules can import it
 * without pulling in handler dependencies.
 */

export const BUILT_IN_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
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

/** `prime-agent-traces` is diagnostics, not a model provider. */
export function isLlmsProviderId(providerId: string): boolean {
	return providerId !== "prime-agent-traces";
}

/** Built-in provider ids that serve models, in catalog order. */
export function builtInProviderIds(): string[] {
	return Object.keys(BUILT_IN_PROVIDER_DISPLAY_NAMES).filter(isLlmsProviderId);
}

const BUILT_IN_PROVIDER_ID_SET: ReadonlySet<string> = new Set(builtInProviderIds());

/** Whether `providerId` is a built-in provider with bundled models. */
export function isBuiltInProviderId(providerId: string): boolean {
	return BUILT_IN_PROVIDER_ID_SET.has(providerId);
}
