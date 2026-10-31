/**
 * `GET /api/chat/models`: the model picker's catalog.
 *
 * The daemon owns the catalog and reads `models.json` and `auth.json` from disk
 * on every `get_model_catalog`. Fleet serves a cached snapshot of that response
 * (see `model-catalog-cache.ts` for why a per-request session is not viable) and
 * maps it onto the browser protocol in `model-catalog.ts`.
 *
 * Dependencies are injected the same way `handlers/chat-mcp.ts` does it, so the
 * route is testable without a live daemon, a real agent dir, or ambient
 * credentials.
 */
import type { ChatModelInfo, ChatModelsResponse, ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import { isModelPatternEnabled } from "@prime-agent/web-protocol/model-patterns";
import { providersMissingApiKey } from "../custom-provider-store";
import type { DaemonModelCatalog } from "../daemon-protocol";
import { readDaemonModelCatalog } from "../daemon-runtime";
import { providerAvailability, toChatModelInfoList } from "../model-catalog";
import { getPrimeConfig } from "../prime-config";
import { safePathLabel } from "../project-registry";
import { cwdForRequest } from "../project-request";
import { wrapApiHandler } from "../wrap-api-handler";

export type ChatModelsHandlerDeps = {
	/** Resolve the request's project cwd, which scopes the settings read. */
	resolveCwd: (request: Request) => Promise<string>;
	/** The agent directory holding `auth.json` and `models.json`. */
	agentDir: string;
	/** `models.json` path, for the load-failure diagnostic. */
	modelsJsonPath: string;
	readCatalog: (cwd: string) => Promise<DaemonModelCatalog>;
	/** The provider-level credential predicate for this snapshot. */
	providerAvailability: (agentDir: string) => Promise<(provider: string) => boolean>;
	settingsFor: (cwd: string) => {
		getEnabledModels(): string[] | undefined;
		getDefaultProvider(): string | undefined;
		getDefaultModel(): string | undefined;
		getDefaultThinkingLevel(): ChatThinkingLevel | undefined;
	};
	/** Custom providers the runtime will refuse to load (see `providersMissingApiKey`). */
	customProvidersMissingApiKey: (modelsJsonPath: string) => string[];
};

export function defaultChatModelsDeps(): ChatModelsHandlerDeps {
	const config = getPrimeConfig();
	return {
		resolveCwd: cwdForRequest,
		agentDir: config.agentDir,
		modelsJsonPath: `${config.agentDir}/models.json`,
		readCatalog: readDaemonModelCatalog,
		providerAvailability: (agentDir) => providerAvailability(agentDir),
		settingsFor: (cwd) => config.settingsFor(cwd),
		customProvidersMissingApiKey: providersMissingApiKey,
	};
}

function toPatternCandidate(model: ChatModelInfo) {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		modelId: model.id,
		key: model.key,
	};
}

/**
 * Tell the user why custom providers are missing.
 *
 * The runtime silently drops every custom provider in `models.json` when any one
 * of them lacks `apiKey`, and no daemon surface reports it. Without this the user
 * sees their providers vanish from the picker with no explanation.
 *
 * The path is rendered through `safePathLabel` because this reaches a 200
 * response body, not an error envelope: `wrapApiHandler` only scrubs errors, so
 * interpolating the raw path here would disclose the server's agent directory.
 */
function customProviderDiagnostics(modelsJsonPath: string, offenders: string[]): string[] {
	if (offenders.length === 0) return [];
	const label = safePathLabel(modelsJsonPath);
	return offenders.map(
		(providerId) =>
			`Provider ${providerId} in ${label} has no apiKey, so none of your custom providers can load. ` +
			`Add a non-empty "apiKey" to ${providerId} in models.json to fix it.`,
	);
}

export function handleChatModelsGet(
	request: Request,
	deps: ChatModelsHandlerDeps = defaultChatModelsDeps(),
): Promise<Response> {
	return wrapApiHandler(async () => {
		const cwd = await deps.resolveCwd(request);
		const settings = deps.settingsFor(cwd);
		const url = new URL(request.url);
		const scope = url.searchParams.get("scope") === "all" ? "all" : "enabled";

		const isProviderAvailable = await deps.providerAvailability(deps.agentDir);
		// A catalog failure surfaces as a typed error rather than an empty list or
		// stale rows: an empty list would read as "you have no models", which is a
		// different and misleading diagnosis.
		const catalog = await deps.readCatalog(cwd);
		let models = toChatModelInfoList(catalog, isProviderAvailable);

		const patterns = settings.getEnabledModels();
		if (scope === "enabled") {
			models = models.filter(
				(model) => model.available && isModelPatternEnabled(toPatternCandidate(model), patterns),
			);
		}

		const diagnostics = customProviderDiagnostics(
			deps.modelsJsonPath,
			deps.customProvidersMissingApiKey(deps.modelsJsonPath),
		);

		const defaultProvider = settings.getDefaultProvider();
		const defaultModel = settings.getDefaultModel();
		const defaultThinkingLevel = settings.getDefaultThinkingLevel();
		const candidateModelKey = defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : undefined;
		const selectedModelKey =
			candidateModelKey && models.some((m) => m.key === candidateModelKey) ? candidateModelKey : models[0]?.key;

		return Response.json({
			models,
			...(selectedModelKey ? { selectedModelKey } : {}),
			...(defaultProvider ? { defaultProvider } : {}),
			...(defaultModel ? { defaultModel } : {}),
			...(defaultThinkingLevel ? { defaultThinkingLevel } : {}),
			diagnostics,
		} satisfies ChatModelsResponse);
	}, request);
}
