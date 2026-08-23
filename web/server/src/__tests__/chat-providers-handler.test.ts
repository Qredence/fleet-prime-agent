import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getProviders as getBuiltinProviders } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const keys = new Map<string, string>();
	const config = {
		agentDir: "",
		authStorage: {
			set: (providerId: string, credential: { type: string; key: string }) => keys.set(providerId, credential.key),
			remove: (providerId: string) => keys.delete(providerId),
		},
		modelRegistry: {
			getProviderAuthStatus: (providerId: string) => ({ configured: keys.has(providerId) }),
		},
		reloadAuth: () => undefined,
	};
	return { keys, config };
});

vi.mock("../prime-config", () => ({ getPrimeConfig: () => mocks.config }));

import { handleChatProvidersDelete, handleChatProvidersGet, handleChatProvidersPost } from "../handlers/chat-providers";

function readModelsJson(dir: string): { providers?: Record<string, Record<string, unknown>> } {
	return JSON.parse(readFileSync(join(dir, "models.json"), "utf-8"));
}

describe("chat providers custom/OCC write path", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "chat-providers-"));
		mocks.config.agentDir = agentDir;
		mocks.keys.clear();
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("GET synthesizes the default OCC row", async () => {
		const response = await handleChatProvidersGet(new Request("http://localhost/api/chat/providers"));
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };
		const occ = body.providers.find((p) => p.id === "openai-chat-completions");
		expect(occ).toMatchObject({
			isConfigured: false,
			envVarName: "OPENAI_CHAT_COMPLETIONS_API_KEY",
			providerFamily: "openai-chat-completions",
		});
	});

	it("creates a custom provider: models.json entry + auth key + listed as configured", async () => {
		const response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "My Lab",
					apiKey: "sk-lab",
					baseUrl: "https://api.mylab.test",
					api: "openai-responses",
					models: ["lab-1", "lab-2"],
				}),
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };
		const row = body.providers.find((p) => p.id === "custom+my-lab");
		expect(row).toMatchObject({
			name: "My Lab",
			isConfigured: true,
			providerFamily: "custom",
			api: "openai-responses",
			modelIds: ["lab-1", "lab-2"],
			discoverable: true,
			envVarName: "CUSTOM_MY_LAB_API_KEY",
		});

		const stored = readModelsJson(agentDir);
		expect(stored.providers?.["custom+my-lab"]).toMatchObject({
			name: "My Lab",
			baseUrl: "https://api.mylab.test",
			api: "openai-responses",
			apiKey: "CUSTOM_MY_LAB_API_KEY",
			models: [{ id: "lab-1" }, { id: "lab-2" }],
		});
		expect(mocks.keys.get("custom+my-lab")).toBe("sk-lab");

		// Second creation with the same name allocates a suffixed id.
		const second = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "My Lab",
					apiKey: "sk-lab-2",
					baseUrl: "https://api2.mylab.test",
					models: ["x"],
				}),
			}),
		);
		const secondBody = (await second.json()) as { providers: Array<Record<string, unknown>> };
		expect(secondBody.providers.some((p) => p.id === "custom+my-lab-2")).toBe(true);
	});

	it("creates a named OCC instance from the generic slot", async () => {
		const response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "openai-chat-completions",
					createOccInstance: true,
					displayName: "Zen Router",
					apiKey: "sk-zen",
					baseUrl: "https://zen.test/v1",
					modelId: "zen-large",
				}),
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };
		const row = body.providers.find((p) => p.id === "openai-chat-completions+zen-router");
		expect(row).toMatchObject({
			name: "Zen Router",
			displayName: "Zen Router",
			isConfigured: true,
			providerFamily: "openai-chat-completions",
			api: "openai-completions",
			modelIds: ["zen-large"],
			discoverable: true,
			envVarName: "OPENAI_CHAT_COMPLETIONS_ZEN_ROUTER_API_KEY",
		});

		const stored = readModelsJson(agentDir);
		expect(stored.providers?.["openai-chat-completions+zen-router"]).toMatchObject({
			name: "Zen Router",
			baseUrl: "https://zen.test/v1",
			api: "openai-completions",
			models: [{ id: "zen-large" }],
		});
	});

	it("stores the engine Google API identifier and hides non-OpenAI discovery", async () => {
		const response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "Gemini Lab",
					apiKey: "google-key",
					baseUrl: "https://gemini.test",
					api: "google-genai",
					models: ["gemini-custom"],
				}),
			}),
		);
		expect(response.status).toBe(200);

		const stored = readModelsJson(agentDir);
		expect(stored.providers?.["custom+gemini-lab"]).toMatchObject({
			api: "google-generative-ai",
		});
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };
		const row = body.providers.find((provider) => provider.id === "custom+gemini-lab");
		expect(row).toMatchObject({ api: "google-genai", discoverable: false });
	});

	it("configures the default OCC slot without dropping the synth row", async () => {
		const response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "openai-chat-completions",
					apiKey: "sk-occ",
					baseUrl: "https://occ.test/v1",
					modelId: "occ-model",
				}),
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };
		const row = body.providers.find((p) => p.id === "openai-chat-completions");
		expect(row).toMatchObject({
			isConfigured: true,
			modelIds: ["occ-model"],
			discoverable: true,
			envVarName: "OPENAI_CHAT_COMPLETIONS_API_KEY",
		});
	});

	it("updates an existing custom provider without losing fields", async () => {
		await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "Lab",
					apiKey: "sk-1",
					baseUrl: "https://v1.lab.test",
					models: ["m1"],
				}),
			}),
		);
		const update = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom+lab",
					displayName: "Lab",
					apiKey: "sk-2",
					baseUrl: "https://v2.lab.test",
					models: ["m1", "m2"],
				}),
			}),
		);
		expect(update.status).toBe(200);
		const stored = readModelsJson(agentDir);
		expect(stored.providers?.["custom+lab"]).toMatchObject({
			baseUrl: "https://v2.lab.test",
			models: [{ id: "m1" }, { id: "m2" }],
		});
		expect(mocks.keys.get("custom+lab")).toBe("sk-2");
	});

	it("falls back to stored managed-provider fields when update fields are blank", async () => {
		await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "Stored Lab",
					apiKey: "sk-1",
					baseUrl: "https://stored.test/v1",
					models: ["stored-model"],
				}),
			}),
		);

		const response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom+stored-lab",
					apiKey: "sk-2",
					baseUrl: "",
					displayName: "",
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(readModelsJson(agentDir).providers?.["custom+stored-lab"]).toMatchObject({
			name: "Stored Lab",
			baseUrl: "https://stored.test/v1",
			models: [{ id: "stored-model" }],
		});
	});

	it("rejects invalid custom payloads with 400, not 500", async () => {
		// Missing displayName for a new instance.
		let response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					apiKey: "sk",
					baseUrl: "https://x.test",
					models: ["m"],
				}),
			}),
		);
		expect(response.status).toBe(400);

		// Non-URL baseUrl.
		response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "Bad",
					apiKey: "sk",
					baseUrl: "not-a-url",
					models: ["m"],
				}),
			}),
		);
		expect(response.status).toBe(400);

		// No models for a custom provider.
		response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "Empty",
					apiKey: "sk",
					baseUrl: "https://x.test",
				}),
			}),
		);
		expect(response.status).toBe(400);
	});

	it("DELETE removes models.json entry and credential for managed providers", async () => {
		await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					providerId: "custom",
					createOccInstance: true,
					displayName: "Gone",
					apiKey: "sk-gone",
					baseUrl: "https://gone.test",
					models: ["g"],
				}),
			}),
		);
		const response = await handleChatProvidersDelete(
			new Request("http://localhost/api/chat/providers", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ providerId: "custom+gone" }),
			}),
		);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };
		expect(body.providers.some((p) => p.id === "custom+gone")).toBe(false);
		expect(readModelsJson(agentDir).providers?.["custom+gone"]).toBeUndefined();
		expect(mocks.keys.has("custom+gone")).toBe(false);
	});

	it("catalog providers keep the key-only path", async () => {
		const response = await handleChatProvidersPost(
			new Request("http://localhost/api/chat/providers", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ providerId: "deepseek", apiKey: "sk-ds" }),
			}),
		);
		expect(response.status).toBe(200);
		expect(() => readModelsJson(agentDir)).toThrow();
		expect(mocks.keys.get("deepseek")).toBe("sk-ds");
	});
});

describe("native builtin provider coverage", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "chat-providers-"));
		mocks.config.agentDir = agentDir;
		mocks.keys.clear();
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("lists every engine builtin exactly once with a name and a hint policy", async () => {
		const response = await handleChatProvidersGet(new Request("http://localhost/api/chat/providers"));
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };

		const byId = new Map<string, Record<string, unknown>>();
		for (const row of body.providers) {
			const id = row.id as string;
			expect(byId.has(id), `duplicate provider row for ${id}`).toBe(false);
			byId.set(id, row);
		}

		// Ids that legitimately carry no env-var hint (OAuth-only credentials).
		const noHintAllowed = new Set(["github-copilot", "openai-codex"]);

		for (const providerId of getBuiltinProviders()) {
			const row = byId.get(providerId);
			expect(row, `builtin ${providerId} missing from providers list`).toBeDefined();
			expect(typeof row?.name === "string" && row.name.length > 0, `builtin ${providerId} has no display name`).toBe(
				true,
			);
			if (!noHintAllowed.has(providerId)) {
				expect(
					typeof row?.envVarName === "string" && row.envVarName.length > 0,
					`builtin ${providerId} has no env-var hint`,
				).toBe(true);
			}
		}
	});

	it("gives anthropic and amazon-bedrock the env hints the engine honors", async () => {
		const response = await handleChatProvidersGet(new Request("http://localhost/api/chat/providers"));
		const body = (await response.json()) as { providers: Array<Record<string, unknown>> };
		const byId = new Map(body.providers.map((row) => [row.id as string, row]));

		expect(byId.get("anthropic")?.envVarName).toBe("ANTHROPIC_API_KEY");
		expect(byId.get("amazon-bedrock")?.envVarName).toBe("AWS_BEARER_TOKEN_BEDROCK");
		expect(byId.get("openrouter")?.envVarName).toBe("OPENROUTER_API_KEY");
	});

	it("round-trips an API key for key-auth builtins without touching models.json", async () => {
		for (const providerId of ["openai", "openrouter", "anthropic", "amazon-bedrock"]) {
			const post = await handleChatProvidersPost(
				new Request("http://localhost/api/chat/providers", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ providerId, apiKey: `sk-${providerId}` }),
				}),
			);
			expect(post.status, `POST ${providerId}`).toBe(200);
			const postBody = (await post.json()) as { providers: Array<Record<string, unknown>> };
			expect(postBody.providers.find((p) => p.id === providerId)?.isConfigured).toBe(true);

			const del = await handleChatProvidersDelete(
				new Request("http://localhost/api/chat/providers", {
					method: "DELETE",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ providerId }),
				}),
			);
			expect(del.status, `DELETE ${providerId}`).toBe(200);
			const delBody = (await del.json()) as { providers: Array<Record<string, unknown>> };
			expect(delBody.providers.find((p) => p.id === providerId)?.isConfigured).toBe(false);
		}

		// The builtin path must never create models.json.
		expect(() => readModelsJson(agentDir)).toThrow();
	});
});
