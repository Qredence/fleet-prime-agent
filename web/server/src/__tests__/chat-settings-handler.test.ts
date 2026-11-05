import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const manager = {
		getGlobalSettings: vi.fn(() => ({ defaultModel: "global-model" })),
		getProjectSettings: vi.fn(() => ({ defaultProvider: "project-provider" })),
		getCompactionSettings: vi.fn(() => ({ enabled: true, reserveTokens: 100, keepRecentTokens: 200 })),
		getRetrySettings: vi.fn(() => ({ enabled: true, maxRetries: 2, baseDelayMs: 50 })),
		getDefaultProvider: vi.fn(() => "google"),
		getDefaultModel: vi.fn(() => "gemini-2.5-flash"),
		getDefaultThinkingLevel: vi.fn(() => "medium"),
		getEnableSkillCommands: vi.fn(() => true),
		getEnabledModels: vi.fn(() => ["global-model"]),
		getExtensionPaths: vi.fn(() => ["extensions"]),
		getFollowUpMode: vi.fn(() => "queue"),
		getPackages: vi.fn(() => []),
		getPromptTemplatePaths: vi.fn(() => ["prompts"]),
		getSkillPaths: vi.fn(() => ["skills"]),
		getSteeringMode: vi.fn(() => "one-at-a-time"),
		getThemePaths: vi.fn(() => ["themes"]),
		getTransport: vi.fn(() => "sse"),
	};
	return {
		manager,
		getPrimeConfig: vi.fn(() => ({
			agentDir: "/missing-agent-dir",
			settingsFor: vi.fn(() => mocks.manager),
		})),
		cwdForRequest: vi.fn(async () => "/workspace/project"),
		safePathLabel: vi.fn((cwd: string) => cwd),
	};
});

vi.mock("../prime-config", () => ({ getPrimeConfig: mocks.getPrimeConfig }));
vi.mock("../project-request", () => ({ cwdForRequest: mocks.cwdForRequest }));
vi.mock("../project-registry", () => ({ safePathLabel: mocks.safePathLabel }));

import type { ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import type { DaemonModel, DaemonModelCatalog } from "../daemon-protocol";
import { type ChatModelsHandlerDeps, handleChatModelsGet } from "../handlers/chat-models";
import { handleChatSettingsGet, handleChatSettingsPatch } from "../handlers/chat-settings";
import { providerAvailability as realProviderAvailability } from "../model-catalog";

const GEMINI: DaemonModel = {
	id: "gemini-2.5-flash",
	name: "Gemini 2.5 Flash",
	api: "google-generative-ai",
	provider: "google",
	baseUrl: "https://generativelanguage.googleapis.com",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 8192,
};

const GPT_4O: DaemonModel = {
	id: "gpt-4o",
	name: "GPT-4o",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128_000,
	maxTokens: 16_384,
};

function catalogOf(...models: DaemonModel[]): DaemonModelCatalog {
	return { models, configuredProviders: [...new Set(models.map((model) => model.provider))].sort() };
}

/** The route's deps with a fake catalog and an explicit credential set. */
function modelsDeps(
	options: {
		catalog?: DaemonModelCatalog;
		available?: string[];
		enabledModels?: string[];
		modelsJsonPath?: string;
		catalogError?: Error;
	} = {},
): ChatModelsHandlerDeps {
	const available = new Set(options.available ?? []);
	return {
		resolveCwd: async () => "/workspace/project",
		agentDir: "/missing-agent-dir",
		modelsJsonPath: options.modelsJsonPath ?? "/missing-agent-dir/models.json",
		readCatalog: async () => {
			if (options.catalogError) throw options.catalogError;
			return options.catalog ?? catalogOf(GEMINI, GPT_4O);
		},
		providerAvailability: async () => (provider: string) => available.has(provider),
		settingsFor: () => ({
			getEnabledModels: () => options.enabledModels ?? [],
			getDefaultProvider: () => mocks.manager.getDefaultProvider(),
			getDefaultModel: () => mocks.manager.getDefaultModel(),
			getDefaultThinkingLevel: () => mocks.manager.getDefaultThinkingLevel() as ChatThinkingLevel | undefined,
		}),
		customProvidersMissingApiKey: () => [],
	};
}

describe("chat settings reads", () => {
	it("reads defaults when no settings files exist", async () => {
		const response = await handleChatSettingsGet(
			new Request("http://localhost/api/chat/settings?projectId=project-1"),
		);
		const body = (await response.json()) as {
			projectPath: string;
			effective: { defaultModel?: string; defaultProvider?: string };
		};

		expect(response.status).toBe(200);
		expect(body.projectPath).toBe("/workspace/project");
		expect(body.effective.defaultModel).toBeUndefined();
		expect(body.effective.defaultProvider).toBeUndefined();
		expect(mocks.manager.getGlobalSettings).not.toHaveBeenCalled();
		expect(mocks.manager.getProjectSettings).not.toHaveBeenCalled();
		expect(mocks.manager.getCompactionSettings).not.toHaveBeenCalled();
		expect(mocks.manager.getRetrySettings).not.toHaveBeenCalled();
	});

	it("returns only models added in settings whose provider is configured and working", async () => {
		const emptyResponse = await handleChatModelsGet(
			new Request("http://localhost/api/chat/models"),
			modelsDeps({ enabledModels: [], available: ["google", "openai"] }),
		);
		const emptyBody = (await emptyResponse.json()) as {
			models: Array<{ key: string }>;
			selectedModelKey?: string;
		};
		expect(emptyBody.models).toEqual([]);
		expect(emptyBody.selectedModelKey).toBeUndefined();

		const filteredResponse = await handleChatModelsGet(
			new Request("http://localhost/api/chat/models"),
			modelsDeps({ enabledModels: ["google/gemini-2.5-flash", "openai/gpt-4o"], available: ["openai"] }),
		);
		const filteredBody = (await filteredResponse.json()) as {
			models: Array<{ key: string; available: boolean }>;
			selectedModelKey?: string;
		};
		expect(filteredBody.models.map((m) => m.key)).toEqual(["openai/gpt-4o"]);
		expect(filteredBody.models[0]?.available).toBe(true);
		expect(filteredBody.selectedModelKey).toBe("openai/gpt-4o");
	});

	it("serves the whole catalog for scope=all regardless of credentials", async () => {
		const response = await handleChatModelsGet(
			new Request("http://localhost/api/chat/models?scope=all"),
			modelsDeps({ available: ["openai"] }),
		);
		const body = (await response.json()) as {
			models: Array<{ key: string; available: boolean; thinkingLevels: string[] }>;
			diagnostics: string[];
		};

		expect(body.models.map((model) => model.key)).toEqual(["google/gemini-2.5-flash", "openai/gpt-4o"]);
		expect(body.models.map((model) => model.available)).toEqual([false, true]);
		// Skipped thinking levels come from `supportedThinkingLevels`, unchanged.
		expect(body.models[0]?.thinkingLevels).toEqual(["off", "minimal", "low", "medium", "high"]);
		expect(body.diagnostics).toEqual([]);
	});

	it("surfaces a catalog failure as a typed error instead of an empty list", async () => {
		const response = await handleChatModelsGet(
			new Request("http://localhost/api/chat/models"),
			modelsDeps({ catalogError: new Error('Cannot send daemon command "get_model_catalog"') }),
		);

		// An empty list would read as "you have no models" rather than "the
		// runtime is unreachable", which is the MCP pane's precedent.
		expect(response.status).toBe(500);
		const body = (await response.json()) as { code: string };
		expect(body.code).toBe("NETWORK_DISCONNECTED");
	});

	it("reports a custom provider that would block every custom provider from loading", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fleet-models-diagnostics-"));
		try {
			const modelsJsonPath = join(dir, "models.json");
			writeFileSync(
				modelsJsonPath,
				JSON.stringify({
					providers: {
						// Legal: a built-in override needs no apiKey.
						openrouter: { baseUrl: "https://proxy.internal/v1" },
						"custom+broken": {
							baseUrl: "https://broken.test",
							api: "openai-completions",
							models: [{ id: "broken-1" }],
						},
					},
				}),
				"utf8",
			);
			const deps = modelsDeps({ modelsJsonPath });
			const response = await handleChatModelsGet(new Request("http://localhost/api/chat/models"), {
				...deps,
				// The real validator over the real file, so the wiring is covered too.
				customProvidersMissingApiKey: (await import("../custom-provider-store")).providersMissingApiKey,
			});
			const body = (await response.json()) as { diagnostics: string[] };

			expect(body.diagnostics).toHaveLength(1);
			expect(body.diagnostics[0]).toContain("custom+broken");
			expect(body.diagnostics[0]).toContain("apiKey");
			expect(body.diagnostics.join(" ")).not.toContain("openrouter");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("provider availability", () => {
	/** Availability over a real, empty agent dir so only env credentials count. */
	async function availabilityWith(
		env: NodeJS.Dict<string>,
	): Promise<{ isAvailable: (provider: string) => boolean; dir: string }> {
		const dir = mkdtempSync(join(tmpdir(), "fleet-model-availability-"));
		return { isAvailable: await realProviderAvailability(dir, env), dir };
	}

	it("counts an env-only ANTHROPIC_API_KEY as configured", async () => {
		// The retired SDK path answered `false` here (it hard-codes
		// `configured: false` for environment candidates), which reported a working
		// key as unavailable. `anthropic` has no entry in the single-var mirror,
		// so this only passes if the multi-var rule is honoured.
		const { isAvailable, dir } = await availabilityWith({ ANTHROPIC_API_KEY: "sk-ant-fixture" });
		try {
			expect(isAvailable("anthropic")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads ANTHROPIC_OAUTH_TOKEN and the copilot fallbacks", async () => {
		const oauth = await availabilityWith({ ANTHROPIC_OAUTH_TOKEN: "oauth-fixture" });
		const copilot = await availabilityWith({ GH_TOKEN: "gh-fixture" });
		try {
			expect(oauth.isAvailable("anthropic")).toBe(true);
			expect(oauth.isAvailable("github-copilot")).toBe(false);
			expect(copilot.isAvailable("github-copilot")).toBe(true);
			// Unset for this provider: no env var, nothing in auth.json.
			expect(copilot.isAvailable("anthropic")).toBe(false);
		} finally {
			rmSync(oauth.dir, { recursive: true, force: true });
			rmSync(copilot.dir, { recursive: true, force: true });
		}
	});

	it("counts a single-var provider such as groq", async () => {
		const { isAvailable, dir } = await availabilityWith({ GROQ_API_KEY: "gsk-fixture" });
		try {
			expect(isAvailable("groq")).toBe(true);
			expect(isAvailable("cerebras")).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("treats an unset models.json apiKey env-var name as unconfigured", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fleet-model-declared-key-"));
		try {
			writeFileSync(
				join(dir, "models.json"),
				JSON.stringify({
					providers: {
						"custom+declared": {
							baseUrl: "https://declared.test",
							api: "openai-completions",
							apiKey: "CUSTOM_DECLARED_API_KEY",
							models: [{ id: "declared-1" }],
						},
						"custom+literal": {
							baseUrl: "https://literal.test",
							api: "openai-completions",
							apiKey: "sk-literal-fixture-value",
							models: [{ id: "literal-1" }],
						},
					},
				}),
				"utf8",
			);
			const isAvailable = await realProviderAvailability(dir, {});

			// The daemon counts both; only the resolvable one can authenticate.
			expect(isAvailable("custom+declared")).toBe(false);
			expect(isAvailable("custom+literal")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("chat settings writes", () => {
	it("writes the patch to the global settings file and reports the consequences", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "fleet-settings-handler-"));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ transport: "auto", agentTraces: true }), "utf8");
		mocks.getPrimeConfig.mockReturnValue({
			agentDir,
			settingsFor: vi.fn(() => mocks.manager),
			invalidateSettings: vi.fn(),
			reloadAuth: vi.fn(),
		} as never);

		try {
			const response = await handleChatSettingsPatch(
				new Request("http://localhost/api/chat/settings", {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ settings: { defaultProvider: "openai" } }),
				}),
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { updateImpact: Record<string, unknown> };
			expect(body.updateImpact).toMatchObject({ changedKeys: ["defaultProvider"], newSessionRecommended: true });

			// The write landed on disk, and a key Fleet does not model survived it.
			const written = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>;
			expect(written.defaultProvider).toBe("openai");
			expect(written.agentTraces).toBe(true);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	it("answers 409 with guidance when the settings file cannot be written", async () => {
		// A path whose parent is a *file*: `mkdir` fails with ENOTDIR for every
		// user, including root. Pointing at `/proc` instead made this test depend
		// on running unprivileged, which is false in CI's root container.
		const dir = mkdtempSync(join(tmpdir(), "fleet-settings-unwritable-"));
		const blocker = join(dir, "not-a-directory");
		writeFileSync(blocker, "occupied", "utf8");
		const invalidateSettings = vi.fn();

		mocks.getPrimeConfig.mockReturnValue({
			agentDir: join(blocker, "agent-dir"),
			settingsFor: vi.fn(() => mocks.manager),
			invalidateSettings,
			reloadAuth: vi.fn(),
		} as never);

		const response = await handleChatSettingsPatch(
			new Request("http://localhost/api/chat/settings", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ settings: { defaultProvider: "openai" } }),
			}),
		);

		// A write failure must not read as success, and must not read as a bug.
		// 409 specifically: the handler has guidance for this case, and a bare 500
		// would tell the user Fleet broke rather than how to route around it.
		expect(response.status).toBe(409);
		expect(((await response.json()) as { code: string }).code).toBe("UNWRITABLE");
		expect(invalidateSettings).not.toHaveBeenCalled();

		rmSync(dir, { recursive: true, force: true });
	});
});
