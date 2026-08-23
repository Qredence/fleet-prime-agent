import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	envVarNameForManagedProvider,
	isDiscoverableEntry,
	listCustomProviders,
	removeCustomProvider,
	upsertCustomProvider,
} from "../custom-provider-store";

describe("custom-provider-store", () => {
	let dir: string;
	let modelsJsonPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "custom-provider-store-"));
		modelsJsonPath = join(dir, "models.json");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("creates models.json with the provider entry", async () => {
		await upsertCustomProvider(modelsJsonPath, "custom+acme", {
			name: "Acme",
			baseUrl: "https://api.acme.test",
			api: "openai-completions",
			apiKey: "CUSTOM_ACME_API_KEY",
			models: [{ id: "acme-1" }, { id: "acme-2" }],
		});

		const providers = await listCustomProviders(modelsJsonPath);
		expect(providers["custom+acme"]).toMatchObject({
			name: "Acme",
			baseUrl: "https://api.acme.test",
			api: "openai-completions",
			apiKey: "CUSTOM_ACME_API_KEY",
			models: [{ id: "acme-1" }, { id: "acme-2" }],
		});
	});

	it("preserves other entries and unmanaged fields on upsert", async () => {
		await upsertCustomProvider(modelsJsonPath, "custom+keep", {
			baseUrl: "https://keep.test",
			api: "openai-completions",
			apiKey: "KEEP_KEY",
			models: [{ id: "m" }],
		});
		// Simulate a hand-maintained field on the managed entry and an unrelated entry.
		const raw = JSON.parse(readFileSync(modelsJsonPath, "utf-8")) as {
			providers: Record<string, Record<string, unknown>>;
		};
		raw.providers["custom+keep"].compat = { supportsStore: false };
		raw.providers["custom+keep"].models = [
			{ id: "m", reasoning: true, cost: { input: 1 }, headers: { "x-test": "keep" } },
		];
		raw.providers["custom+other"] = { baseUrl: "https://other.test", models: [{ id: "o" }] };
		rewriteModelsJson(raw);

		await upsertCustomProvider(modelsJsonPath, "custom+keep", {
			name: "Keep v2",
			baseUrl: "https://keep2.test",
			api: "openai-responses",
			apiKey: "KEEP_KEY",
			models: [{ id: "m2" }],
		});

		const providers = await listCustomProviders(modelsJsonPath);
		expect(providers["custom+keep"]).toMatchObject({
			name: "Keep v2",
			baseUrl: "https://keep2.test",
			api: "openai-responses",
			compat: { supportsStore: false },
			models: [{ id: "m2" }],
		});
		expect(providers["custom+other"]).toMatchObject({ baseUrl: "https://other.test" });
	});

	it("preserves JSONC providers and model metadata while updating", async () => {
		writeFileSync(
			modelsJsonPath,
			`{
				// Hand-maintained models.json comments must not cause data loss.
				"providers": {
					"custom+keep": {
						"baseUrl": "https://keep.test",
						"api": "openai-completions",
						"apiKey": "KEEP_KEY",
						"models": [{ "id": "m", "reasoning": true, "cost": { "input": 1 }, }],
					},
				},
			}
			`,
			"utf-8",
		);

		await upsertCustomProvider(modelsJsonPath, "custom+keep", {
			baseUrl: "https://keep-v2.test",
			api: "openai-completions",
			apiKey: "KEEP_KEY",
			models: [{ id: "m" }],
		});

		const provider = (await listCustomProviders(modelsJsonPath))["custom+keep"];
		expect(provider).toMatchObject({ baseUrl: "https://keep-v2.test" });
		expect(provider.models).toEqual([{ id: "m", reasoning: true, cost: { input: 1 } }]);
	});

	it("refuses to overwrite an unparseable models.json", () => {
		const original = "{ this is not valid JSONC";
		writeFileSync(modelsJsonPath, original, "utf-8");

		expect(() =>
			upsertCustomProvider(modelsJsonPath, "custom+new", {
				baseUrl: "https://new.test",
				api: "openai-completions",
				apiKey: "NEW_KEY",
				models: [{ id: "new" }],
			}),
		).toThrow(/Refusing to update models\.json/);
		expect(readFileSync(modelsJsonPath, "utf-8")).toBe(original);
	});

	it("removes only the targeted entry", async () => {
		await upsertCustomProvider(modelsJsonPath, "custom+a", {
			baseUrl: "https://a.test",
			api: "openai-completions",
			apiKey: "A_KEY",
			models: [{ id: "a" }],
		});
		await upsertCustomProvider(modelsJsonPath, "custom+b", {
			baseUrl: "https://b.test",
			api: "openai-completions",
			apiKey: "B_KEY",
			models: [{ id: "b" }],
		});

		await removeCustomProvider(modelsJsonPath, "custom+a");

		const providers = await listCustomProviders(modelsJsonPath);
		expect(providers["custom+a"]).toBeUndefined();
		expect(providers["custom+b"]).toBeDefined();
	});

	it("remove is a no-op for unknown ids", async () => {
		await removeCustomProvider(modelsJsonPath, "custom+missing");
		expect(await listCustomProviders(modelsJsonPath)).toEqual({});
	});

	it("derives stable env var names for managed providers", () => {
		expect(envVarNameForManagedProvider("openai-chat-completions")).toBe("OPENAI_CHAT_COMPLETIONS_API_KEY");
		expect(envVarNameForManagedProvider("openai-chat-completions+zen")).toBe("OPENAI_CHAT_COMPLETIONS_ZEN_API_KEY");
		expect(envVarNameForManagedProvider("custom+my-lab")).toBe("CUSTOM_MY_LAB_API_KEY");
	});

	it("flags discoverable entries by http(s) baseUrl", () => {
		expect(isDiscoverableEntry({ baseUrl: "https://api.acme.test" })).toBe(true);
		expect(isDiscoverableEntry({ baseUrl: "http://localhost:8080" })).toBe(true);
		expect(isDiscoverableEntry({ baseUrl: "file:///x" })).toBe(false);
		expect(isDiscoverableEntry({})).toBe(false);
		expect(isDiscoverableEntry(undefined)).toBe(false);
	});

	it("round-trips through a real engine ModelRegistry and AuthStorage", async () => {
		const providerId = "custom+acme";
		await upsertCustomProvider(modelsJsonPath, providerId, {
			name: "Acme",
			baseUrl: "https://api.acme.test",
			api: "openai-completions",
			apiKey: "CUSTOM_ACME_API_KEY",
			models: [{ id: "acme-1", name: "Acme One" }],
		});

		const authStorage = AuthStorage.create(join(dir, "auth.json"));
		authStorage.set(providerId, { type: "api_key", key: "secret-key" });
		const registry = ModelRegistry.create(authStorage, modelsJsonPath);
		registry.refresh();

		expect(registry.getError()).toBeUndefined();
		const model = registry.getAll().find((m) => m.provider === providerId && m.id === "acme-1");
		expect(model).toBeDefined();
		expect(model?.name).toBe("Acme One");
		expect(model?.baseUrl).toBe("https://api.acme.test");
		expect(registry.getProviderAuthStatus(providerId).configured).toBe(true);
		expect(await registry.getApiKeyForProvider(providerId)).toBe("secret-key");
	});

	it("engine reports a load error when a required field is missing", async () => {
		await upsertCustomProvider(modelsJsonPath, "custom+broken", {
			baseUrl: "https://broken.test",
			api: "openai-completions",
			apiKey: "BROKEN_KEY",
			models: [{ id: "b" }],
		});
		const raw = JSON.parse(readFileSync(modelsJsonPath, "utf-8")) as {
			providers: Record<string, Record<string, unknown>>;
		};
		delete raw.providers["custom+broken"].apiKey;
		rewriteModelsJson(raw);

		const registry = ModelRegistry.create(AuthStorage.create(join(dir, "auth.json")), modelsJsonPath);
		registry.refresh();

		expect(registry.getError()).toContain("apiKey");
	});

	function rewriteModelsJson(raw: unknown) {
		rmSync(modelsJsonPath, { force: true });
		writeFileSync(modelsJsonPath, `${JSON.stringify(raw, null, "\t")}\n`, "utf-8");
	}
});
