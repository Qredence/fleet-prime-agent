import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"

const BodySchema = z.object({
	providerId: z.string().min(1).max(128),
})

// POST /api/chat/models/discover — query an OpenAI-compatible provider for its
// model catalog. Prime-agent's ModelRegistry doesn't expose a /v1/models
// discovery helper, and most built-in providers don't advertise a public
// catalog endpoint either; the UI's "Discover models" affordance is wired for
// OCC/custom providers that DO. For v1 we only attempt the OpenAI-compat
// shape and fall back to `[]` everywhere else — the UI shows an empty state.

export const Route = createFileRoute("/api/chat/models/discover")({
	server: {
		handlers: {
			POST: async ({ request }) =>
				wrapApiHandler(async () => {
					const raw = await request.json().catch(() => ({}))
					const body = BodySchema.parse(raw)
					const config = getPrimeConfig()
					const apiKey = await config.modelRegistry.getApiKeyForProvider(
						body.providerId,
					)
					if (!apiKey) {
						return Response.json({
							providerId: body.providerId,
							models: [],
						})
					}

					// Resolve the provider's base URL. Reads the single-model override
					// (provider/baseUrl) that custom OCC instances store in models.json.
					// For built-ins we skip discovery — provider docs are the catalog.
					const provider = body.providerId
					const customProviders = (
						config.modelRegistry as unknown as {
							customProviderModels?: Record<
								string,
								{ baseUrl?: string; models?: Array<string> }
							>
						}
					).customProviderModels
					const baseUrl = customProviders?.[provider]?.baseUrl
					if (!baseUrl) {
						return Response.json({
							providerId: provider,
							models: [],
						})
					}

					try {
						const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/models`, {
							headers: { Authorization: `Bearer ${apiKey}` },
							signal: AbortSignal.timeout(10_000),
						})
						if (!response.ok) {
							return Response.json({
								providerId: provider,
								models: [],
							})
						}
						const payload = (await response.json()) as {
							data?: Array<{ id: string; created?: number; owned_by?: string }>
						}
						const models = (payload.data ?? []).map((m) => ({
							key: `${provider}/${m.id}`,
							provider,
							id: m.id,
							name: m.id,
							reasoning: false,
							input: ["text"] as Array<"text" | "image">,
							available: true,
							defaultThinkingLevel: "off" as const,
						}))
						return Response.json({ providerId: provider, models })
					} catch {
						return Response.json({ providerId: provider, models: [] })
					}
				}),
		},
	},
})
