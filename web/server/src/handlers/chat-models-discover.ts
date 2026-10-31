import { ChatModelsDiscoverRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { isOccFamilyApi } from "@prime-agent/web-protocol/provider-catalog";
import { addCustomProviderModelIds, listCustomProviders, uiApiForCustomProvider } from "../custom-provider-store";
import { isLoopbackHostname } from "../net";
import { getPrimeConfig } from "../prime-config";
import { resolveProviderApiKey } from "../prime-provider-credentials";
import { wrapApiHandler } from "../wrap-api-handler";

export function openAiModelsUrl(baseUrl: string): URL {
	const parsed = new URL(baseUrl);
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error("model discovery requires an http(s) URL");
	}
	if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
		throw new Error("model discovery requires https for non-loopback hosts");
	}
	if (parsed.username || parsed.password) throw new Error("Credentials in model discovery URLs are not supported");
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
		const apiKey = await resolveProviderApiKey(config.agentDir, body.providerId);
		if (!apiKey) {
			return Response.json({
				providerId: body.providerId,
				models: [],
				error: "Model discovery is unavailable. Check provider configuration and try again.",
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
				error: "Model discovery is unavailable. Check provider configuration and try again.",
			});
		}
		const baseUrl = entry?.baseUrl;
		if (!baseUrl) {
			return Response.json({
				providerId: provider,
				models: [],
				error: "Model discovery is unavailable. Check provider configuration and try again.",
			});
		}

		try {
			const modelsUrl = openAiModelsUrl(baseUrl);
			// Stored provider credentials are sent to the user-configured provider
			// endpoint; this is the model discovery auth flow. Plain http stays
			// allowed only for loopback hosts (local providers such as Ollama on
			// localhost); non-loopback endpoints must be https so the Bearer key
			// is never sent in cleartext, and redirects are rejected so the key
			// cannot be forwarded cross-origin via redirect TOCTOU.
			// codeql[js/file-access-to-http]
			const response = await fetch(modelsUrl, {
				headers: { Authorization: `Bearer ${apiKey}` },
				redirect: "error",
				signal: AbortSignal.timeout(10_000),
			});
			if (!response.ok) {
				return Response.json({
					providerId: provider,
					models: [],
					error: "Model discovery is unavailable. Check provider configuration and try again.",
				});
			}
			const payload = (await response.json()) as {
				data?: Array<{ id: string; created?: number; owned_by?: string }>;
			};
			if (!Array.isArray(payload.data) || !payload.data.every((m) => typeof m?.id === "string" && m.id.length > 0)) {
				throw new Error("Invalid model catalog");
			}
			const models = payload.data.map((m) => ({
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
				await addCustomProviderModelIds(
					`${config.agentDir}/models.json`,
					provider,
					models.map((model) => model.id),
				);
				config.reloadAuth();
			}
			return Response.json({ providerId: provider, models });
		} catch {
			return Response.json({
				providerId: provider,
				models: [],
				error: "Could not refresh models. Previous results are retained; try again.",
			});
		}
	}, request);
}
