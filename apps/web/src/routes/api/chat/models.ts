import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"

export const Route = createFileRoute("/api/chat/models")({
	server: {
		handlers: {
			GET: async () =>
				wrapApiHandler(async () => {
					const config = getPrimeConfig()
					const settings = config.defaultSettings
					const registry = config.modelRegistry
					const models = registry.getAll()
					const diagnostics: string[] = []

					const defaultProvider = settings.getDefaultProvider()
					const defaultModel = settings.getDefaultModel()
					const defaultThinkingLevel = settings.getDefaultThinkingLevel()
					const selectedModelKey =
						defaultProvider && defaultModel
							? `${defaultProvider}/${defaultModel}`
							: undefined

					return Response.json({
						models: models.map((m) => ({
							key: `${m.provider}/${m.id}`,
							provider: m.provider,
							id: m.id,
							name: m.name,
							reasoning: m.reasoning,
							input: m.input,
							contextWindow: m.contextWindow,
							maxTokens: m.maxTokens,
							available: registry.hasConfiguredAuth(m),
							defaultThinkingLevel: m.reasoning ? "medium" : "off",
						})),
						...(selectedModelKey ? { selectedModelKey } : {}),
						...(defaultProvider ? { defaultProvider } : {}),
						...(defaultModel ? { defaultModel } : {}),
						...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
						diagnostics,
					})
				}),
		},
	},
})
