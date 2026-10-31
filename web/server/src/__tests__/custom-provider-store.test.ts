import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	envVarNameForManagedProvider,
	isDiscoverableEntry,
	listCustomProviders,
	providersMissingApiKey,
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
			compat: { supportsStore: false },
			models: [{ id: "acme-1" }, { id: "acme-2" }],
		});
	});

	it("defaults gpt-6 and gpt-5.6 models on openai-completions to reasoning_effort=none for tool compatibility", async () => {
		await upsertCustomProvider(modelsJsonPath, "custom+neon", {
			name: "Neon",
			baseUrl: "https://branch-api.ai.c-6.us-east-2.aws.neon.tech/v1",
			api: "openai-completions",
			apiKey: "CUSTOM_NEON_API_KEY",
			models: [{ id: "gpt-6-luna" }, { id: "claude-haiku-5-5" }],
		});

		const providers = listCustomProviders(modelsJsonPath);
		expect(providers["custom+neon"]).toMatchObject({
			compat: { supportsStore: false },
			models: [
				{
					id: "gpt-6-luna",
					reasoning: true,
					thinkingLevelMap: {
						off: "none",
						minimal: null,
						low: null,
						medium: null,
						high: null,
						xhigh: null,
						max: null,
					},
				},
				{ id: "claude-haiku-5-5" },
			],
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

	it("refuses to overwrite an unparseable models.json", async () => {
		const original = "{ this is not valid JSONC";
		writeFileSync(modelsJsonPath, original, "utf-8");

		// The write is async now, so the refusal surfaces as a rejection.
		await expect(
			upsertCustomProvider(modelsJsonPath, "custom+new", {
				baseUrl: "https://new.test",
				api: "openai-completions",
				apiKey: "NEW_KEY",
				models: [{ id: "new" }],
			}),
		).rejects.toThrow(/Refusing to update models\.json/);
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

	it("reads back a written custom provider with its models intact", async () => {
		const providerId = "custom+acme";
		await upsertCustomProvider(modelsJsonPath, providerId, {
			name: "Acme",
			baseUrl: "https://api.acme.test",
			api: "openai-completions",
			apiKey: "CUSTOM_ACME_API_KEY",
			models: [{ id: "acme-1", name: "Acme One" }],
		});

		// `models.json` is read by the daemon, so what the store writes is what the
		// catalog sees; the format assertion stays on this side of the boundary.
		const stored = listCustomProviders(modelsJsonPath)[providerId];
		expect(stored?.name).toBe("Acme");
		expect(stored?.baseUrl).toBe("https://api.acme.test");
		expect(stored?.api).toBe("openai-completions");
		expect(stored?.apiKey).toBe("CUSTOM_ACME_API_KEY");
		expect(stored?.models).toEqual([{ id: "acme-1", name: "Acme One" }]);
	});

	it("names a custom provider that the runtime would reject for a missing apiKey", async () => {
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

		// The runtime drops *every* custom provider when one lacks `apiKey`, and
		// reports nothing on any surface, so this is the only signal Fleet has.
		expect(providersMissingApiKey(modelsJsonPath)).toEqual(["custom+broken"]);
	});

	it("accepts a built-in provider override that has no apiKey", async () => {
		// A `baseUrl`-only override of a built-in provider is legal: the runtime
		// validates built-ins by the override path, which does not require a key.
		// Flagging it would produce a diagnostic for a file the daemon accepts.
		rewriteModelsJson({
			providers: {
				openrouter: { baseUrl: "https://proxy.internal/v1" },
				"custom+fine": {
					baseUrl: "https://fine.test",
					api: "openai-completions",
					apiKey: "CUSTOM_FINE_API_KEY",
					models: [{ id: "fine-1" }],
				},
			},
		});

		expect(providersMissingApiKey(modelsJsonPath)).toEqual([]);
	});

	it("flags every apiKey-less custom provider, including one listed after a valid entry", async () => {
		rewriteModelsJson({
			providers: {
				"custom+good": {
					baseUrl: "https://good.test",
					api: "openai-completions",
					apiKey: "CUSTOM_GOOD_API_KEY",
					models: [{ id: "good-1" }],
				},
				"custom+bad": {
					baseUrl: "https://bad.test",
					api: "openai-completions",
					models: [{ id: "bad-1" }],
				},
				"custom+empty": {
					baseUrl: "https://empty.test",
					api: "openai-completions",
					apiKey: "",
					models: [{ id: "empty-1" }],
				},
			},
		});

		// Cross-contamination is keyed on the file, not the entry: the well-formed
		// provider is hidden too, so the offenders are what the user must fix.
		expect(providersMissingApiKey(modelsJsonPath)).toEqual(["custom+bad", "custom+empty"]);
	});

	function rewriteModelsJson(raw: unknown) {
		rmSync(modelsJsonPath, { force: true });
		writeFileSync(modelsJsonPath, `${JSON.stringify(raw, null, "\t")}\n`, "utf-8");
	}
});
