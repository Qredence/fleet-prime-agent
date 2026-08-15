import { ChatModelsDiscoverRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { getPrimeConfig } from "../prime-config";
import { wrapApiHandler } from "../wrap-api-handler";

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
		const customProviders = (
			config.modelRegistry as unknown as {
				customProviderModels?: Record<string, { baseUrl?: string; models?: Array<string> }>;
			}
		).customProviderModels;
		const baseUrl = customProviders?.[provider]?.baseUrl;
		if (!baseUrl) {
			return Response.json({
				providerId: provider,
				models: [],
			});
		}

		try {
			const parsedBaseUrl = new URL(baseUrl);
			if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.protocol !== "http:") {
				return Response.json({
					providerId: provider,
					models: [],
				});
			}
			// codeql[js/file-access-to-http] Stored provider credentials are sent to the
			// user-configured provider endpoint; this is the model discovery auth flow.
			const response = await fetch(`${parsedBaseUrl.toString().replace(/\/$/, "")}/v1/models`, {
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
			return Response.json({ providerId: provider, models });
		} catch {
			return Response.json({ providerId: provider, models: [] });
		}
	});
}
