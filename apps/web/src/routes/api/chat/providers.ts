import { createFileRoute } from "@tanstack/react-router"
import { getProviders } from "@earendil-works/pi-ai"
import { getOAuthProviders } from "@earendil-works/pi-ai/oauth"
import { existsSync, readFileSync } from "node:fs"
import { z } from "zod"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"
import { PRIME_PROVIDER_ENV_MAP } from "@/server/prime-provider-env-map"

// ChatProviderInfo wire shape comes from prime-agent's canonical sources:
//   - ids: getProviders() (built-ins) ∪ models.json `providers.*` (custom)
//   - names: models.json `name` field for custom; built-ins via
//     prime-agent's BUILT_IN_PROVIDER_DISPLAY_NAMES (inlined here)
//   - env var: pi-ai's env-api-keys.envMap for built-ins; for custom OCC
//     providers, the apiKey field *is* the env var name (e.g. MODAL_PROXY_TOKEN)
//   - authType: "oauth" for getOAuthProviders() else "apiKey"
//   - isConfigured: ModelRegistry.getProviderAuthStatus (covers env, OAuth,
//     and models.json-based auth resolution — the exact same source the
//     interactive TUI uses).
//
// Unlike the legacy fleet-pi route, this is fully prime-agent driven — the
// Settings UI renders whatever prime-agent knows about (Modal custom OCC,
// Kimi-Coding, Xiaomi, Vercel AI Gateway, Prime Inference, etc.) without a
// static catalog that drifts as prime-agent adds providers.

// Inlined from prime-agent/packages/coding-agent/src/core/provider-display-names.ts.
// Not re-exported via the package's public index; low drift risk because
// adding a new built-in to prime-agent also adds models+registry entries
// and we'd surface the new provider id with a sensible fallback name (the id).
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
}

type CustomProviderEntry = {
	name?: string
	baseUrl?: string
	apiKey?: string
	models?: Array<{ id: string }>
}

type CustomProvidersMap = Record<string, CustomProviderEntry>

/**
 * Read the custom `providers` map from `~/.prime/agent/models.json`, if any.
 * The ModelRegistry already validated the schema at construction; we just
 * extract the user-facing `name` and `apiKey` (env var name) fields, which
 * the registry deliberately does not expose publicly.
 */
function readCustomProviders(modelsJsonPath: string): CustomProvidersMap {
	try {
		if (!existsSync(modelsJsonPath)) return {}
		const raw = readFileSync(modelsJsonPath, "utf-8")
		const parsed = JSON.parse(raw) as { providers?: CustomProvidersMap }
		return parsed.providers ?? {}
	} catch {
		return {}
	}
}

function buildProviders() {
	const config = getPrimeConfig()
	const oauthIds = new Set(getOAuthProviders().map((p) => p.id))

	const custom = readCustomProviders(`${config.agentDir}/models.json`)
	const builtinIds = new Set<string>(getProviders())
	const allIds = new Set<string>([...builtinIds, ...Object.keys(custom)])

	return Array.from(allIds)
		.map((id) => {
			const isCustom = !builtinIds.has(id)
			const customEntry = custom[id]
			const status = config.modelRegistry.getProviderAuthStatus(id)
			const name = isCustom
				? (customEntry?.name ?? id)
				: (BUILT_IN_PROVIDER_DISPLAY_NAMES[id] ?? id)
			// For custom OCC providers, the apiKey field is the *env var name*
			// (e.g. MODAL_PROXY_TOKEN). For built-ins, look up the canonical env var.
			const envVarName = isCustom
				? (customEntry?.apiKey ?? "")
				: (PRIME_PROVIDER_ENV_MAP[id] ?? "")
			return {
				id,
				name,
				envVarName,
				...(oauthIds.has(id) ? { authType: "oauth" as const } : {}),
				isConfigured: status.configured,
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}

const ProviderUpdateSchema = z.looseObject({
	providerId: z.string().min(1),
	apiKey: z.string().max(4096),
	baseUrl: z.string().max(4096).optional(),
	modelId: z.string().max(4096).optional(),
	displayName: z.string().max(256).optional(),
	createOccInstance: z.boolean().optional(),
}) // permissive: forward-compat with custom+OCC instance fields the v1 surface doesn't yet know

const ProviderRemoveSchema = z.object({
	providerId: z.string().min(1),
})

export const Route = createFileRoute("/api/chat/providers")({
	server: {
		handlers: {
			GET: async () =>
				wrapApiHandler(async () => {
					return Response.json({ providers: buildProviders() })
				}),

			POST: async ({ request }) =>
				wrapApiHandler(async () => {
					const raw = await request.json().catch(() => ({}))
					const body = ProviderUpdateSchema.parse(raw)
					const config = getPrimeConfig()
					config.authStorage.set(body.providerId, {
						type: "api_key",
						key: body.apiKey,
					})
					// baseUrl/modelId/displayName edits go through models.json
					// (provider-specific override). Wiring that surface in v2 — for
					// now the stored apiKey is sufficient for the LLM provider to
					// authenticate. Custom provider + named OCC instance creation
					// (`createOccInstance`) is also v2.
					config.reloadAuth()
					return Response.json({
						success: true,
						providers: buildProviders(),
					})
				}),

			DELETE: async ({ request }) =>
				wrapApiHandler(async () => {
					const raw = await request.json().catch(() => ({}))
					const body = ProviderRemoveSchema.parse(raw)
					const config = getPrimeConfig()
					config.authStorage.remove(body.providerId)
					config.reloadAuth()
					return Response.json({
						success: true,
						providers: buildProviders(),
					})
				}),
		},
	},
})
