import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertCustomProvider } from "../custom-provider-store";

const mocks = vi.hoisted(() => ({
	config: {
		agentDir: "",
		modelRegistry: {
			getApiKeyForProvider: vi.fn(),
		},
		reloadAuth: vi.fn(),
	},
}));

vi.mock("../prime-config", () => ({ getPrimeConfig: () => mocks.config }));

import { handleChatModelsDiscoverPost, openAiModelsUrl } from "../handlers/chat-models-discover";

describe("chat model discovery", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "chat-model-discover-"));
		mocks.config.agentDir = agentDir;
		mocks.config.modelRegistry.getApiKeyForProvider.mockResolvedValue("secret-key");
		mocks.config.reloadAuth.mockReset();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ data: [{ id: "new-model" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		rmSync(agentDir, { recursive: true, force: true });
	});

	it.each([
		["https://api.example.test", "https://api.example.test/v1/models"],
		["https://api.example.test/", "https://api.example.test/v1/models"],
		["https://api.example.test/v1", "https://api.example.test/v1/models"],
		["https://api.example.test/v1/", "https://api.example.test/v1/models"],
		["https://api.example.test/openai/v1", "https://api.example.test/openai/v1/models"],
	])("normalizes %s to %s", (baseUrl, expected) => {
		expect(openAiModelsUrl(baseUrl).toString()).toBe(expected);
	});

	it("persists discovered IDs and refreshes the engine registry", async () => {
		upsertCustomProvider(join(agentDir, "models.json"), "custom+lab", {
			baseUrl: "https://api.example.test/v1",
			api: "openai-completions",
			apiKey: "CUSTOM_LAB_API_KEY",
			models: [{ id: "existing-model", reasoning: true }],
		});

		const response = await handleChatModelsDiscoverPost(
			new Request("http://localhost/api/chat/models/discover", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ providerId: "custom+lab" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(vi.mocked(fetch)).toHaveBeenCalledWith(
			new URL("https://api.example.test/v1/models"),
			expect.objectContaining({ headers: { Authorization: "Bearer secret-key" } }),
		);
		const stored = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf-8")) as {
			providers: Record<string, { models: Array<Record<string, unknown>> }>;
		};
		expect(stored.providers["custom+lab"].models).toEqual([
			{ id: "existing-model", reasoning: true },
			{ id: "new-model" },
		]);
		expect(mocks.config.reloadAuth).toHaveBeenCalledOnce();
	});

	it("does not advertise or call OpenAI discovery for Google providers", async () => {
		upsertCustomProvider(join(agentDir, "models.json"), "custom+google", {
			baseUrl: "https://generativelanguage.example.test",
			api: "google-genai",
			apiKey: "CUSTOM_GOOGLE_API_KEY",
			models: [{ id: "gemini" }],
		});

		const response = await handleChatModelsDiscoverPost(
			new Request("http://localhost/api/chat/models/discover", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ providerId: "custom+google" }),
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ providerId: "custom+google", models: [] });
		expect(fetch).not.toHaveBeenCalled();
	});
});
