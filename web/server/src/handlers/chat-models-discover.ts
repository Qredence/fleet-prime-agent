import { ChatModelsDiscoverRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { isOccFamilyApi } from "@prime-agent/web-protocol/provider-catalog";
import { addCustomProviderModelIds, listCustomProviders, uiApiForCustomProvider } from "../custom-provider-store";
import { getPrimeConfig } from "../prime-config";
import { wrapApiHandler } from "../wrap-api-handler";

export function openAiModelsUrl(baseUrl: string): URL {
	const parsed = new URL(baseUrl);
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("model discovery requires an http(s) URL");
	}
	const path = parsed.pathname.replace(/\/+$/, "");
	parsed.pathname = path.endsWith("/v1") ? `${path}/models` : `${path}/v1/models`;
	parsed.search = "";
	parsed.hash = "";
	return parsed;
}

export function handleChatModelsDiscoverPost(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const raw = await request.json().catch(() => ({}));
		const body = ChatModelsDiscoverRequestSchema.parse(raw);
		const config = getPrimeConfig();
		const apiKey = await config.modelRegistry.getApiKeyForProvider(body.providerId);
		if (!apiKey) {
			return Response.json({
				providerId: body.providerId,
				models: [],
			});
		}

		const provider = body.providerId;
		const custom = listCustomProviders(`${config.agentDir}/models.json`);
		const entry = custom[provider];
		const api = uiApiForCustomProvider(entry?.api);
		if ((entry?.api && !api) || (api && !isOccFamilyApi(api))) {
			return Response.json({
				providerId: provider,
				models: [],
			});
		}
		const baseUrl = entry?.baseUrl;
		if (!baseUrl) {
			return Response.json({
				providerId: provider,
				models: [],
			});
		}

		try {
			const modelsUrl = openAiModelsUrl(baseUrl);
			// Stored provider credentials are sent to the user-configured provider
			// endpoint; this is the model discovery auth flow.
			// codeql[js/file-access-to-http]
			const response = await fetch(modelsUrl, {
				headers: { Authorization: `Bearer ${apiKey}` },
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				return Response.json({
					providerId: provider,
					models: [],
				});
			}
			const payload = (await response.json()) as {
				data?: Array<{ id: string; created?: number; owned_by?: string }>;
			};
			const models = (payload.data ?? []).map((m) => ({
				key: `${provider}/${m.id}`,
				provider,
				id: m.id,
				name: m.id,
				reasoning: false,
				input: ["text"] as Array<"text" | "image">,
				available: true,
				defaultThinkingLevel: "off" as const,
				thinkingLevels: ["off"] as const,
			}));
			if (models.length > 0) {
				addCustomProviderModelIds(
					`${config.agentDir}/models.json`,
					provider,
					models.map((model) => model.id),
				);
				config.reloadAuth();
			}
			return Response.json({ providerId: provider, models });
		} catch {
			return Response.json({ providerId: provider, models: [] });
		}
	});
}
