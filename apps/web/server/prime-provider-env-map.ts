/**
 * Canonical api-key env var per prime-agent built-in provider, inlined from
 * `prime-agent/packages/ai/src/env-api-keys.ts` (`envMap`). The map is private
 * to pi-ai (the public `findEnvKeys` only returns vars actually set in
 * `process.env`), so we mirror it here. The Settings UI uses these to label
 * the field the user is about to paste into (e.g. `OPENAI_API_KEY`).
 *
 * Drift risk: adding a new built-in to prime-agent requires adding the entry
 * here too, otherwise the UI renders an empty env-var hint for that provider.
 * Values that resolve to `""` fall back to a generic "paste your API key"
 * label downstream.
 */
export const PRIME_PROVIDER_ENV_MAP: Record<string, string> = {
	openai: "OPENAI_API_KEY",
	"azure-openai-responses": "AZURE_OPENAI_API_KEY",
	"prime-inference": "PRIME_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	google: "GEMINI_API_KEY",
	"google-vertex": "GOOGLE_CLOUD_API_KEY",
	groq: "GROQ_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	xai: "XAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	zai: "ZAI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	minimax: "MINIMAX_API_KEY",
	"minimax-cn": "MINIMAX_CN_API_KEY",
	moonshotai: "MOONSHOT_API_KEY",
	"moonshotai-cn": "MOONSHOT_API_KEY",
	huggingface: "HF_TOKEN",
	fireworks: "FIREWORKS_API_KEY",
	opencode: "OPENCODE_API_KEY",
	"opencode-go": "OPENCODE_API_KEY",
	"kimi-coding": "KIMI_API_KEY",
	"cloudflare-workers-ai": "CLOUDFLARE_API_KEY",
	"cloudflare-ai-gateway": "CLOUDFLARE_API_KEY",
	xiaomi: "XIAOMI_API_KEY",
	"xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
	"xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
	"xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
}
