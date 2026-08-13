import { isModelPatternEnabled } from "@prime-agent/web-protocol/model-patterns";
import { getPrimeConfig } from "../prime-config";
import { wrapApiHandler } from "../wrap-api-handler";

function toPatternCandidate(model: { id: string; name: string; provider: string }) {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		modelId: model.id,
		key: `${model.provider}/${model.id}`,
	};
}

export function handleChatModelsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const config = getPrimeConfig();
		const cwd = config.defaultCwd;
		const settings = config.settingsFor(cwd);
		const registry = config.modelRegistry;
		const url = new URL(request.url);
		const scope = url.searchParams.get("scope") === "all" ? "all" : "enabled";

		let models = registry.getAll();
		if (scope === "enabled") {
			models = models.filter((model) => registry.hasConfiguredAuth(model));

			const patterns = settings.getEnabledModels();
			if (patterns !== undefined) {
				models = models.filter((model) => isModelPatternEnabled(toPatternCandidate(model), patterns));
			}
		}

		const diagnostics: string[] = [];

		const defaultProvider = settings.getDefaultProvider();
		const defaultModel = settings.getDefaultModel();
		const defaultThinkingLevel = settings.getDefaultThinkingLevel();
		const selectedModelKey = defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : undefined;

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
		});
	});
}
