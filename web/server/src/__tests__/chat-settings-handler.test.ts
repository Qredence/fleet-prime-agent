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
	const modelRegistry = {
		getAll: vi.fn(() => [
			{
				id: "gemini-2.5-flash",
				name: "Gemini 2.5 Flash",
				provider: "google",
				reasoning: true,
				input: ["text"],
				contextWindow: 100000,
				maxTokens: 8192,
			},
			{
				id: "gpt-4o",
				name: "GPT-4o",
				provider: "openai",
				reasoning: false,
				input: ["text"],
				contextWindow: 128000,
				maxTokens: 16384,
			},
		]),
		getProviderAuthStatus: vi.fn((provider: string) => ({
			configured: provider === "openai",
		})),
		hasConfiguredAuth: vi.fn(() => true),
	};
	return {
		manager,
		modelRegistry,
		getPrimeConfig: vi.fn(() => ({
			settingsFor: vi.fn(() => manager),
			modelRegistry,
		})),
		cwdForRequest: vi.fn(async () => "/workspace/project"),
		safePathLabel: vi.fn((cwd: string) => cwd),
	};
});

vi.mock("../prime-config", () => ({ getPrimeConfig: mocks.getPrimeConfig }));
vi.mock("../project-request", () => ({ cwdForRequest: mocks.cwdForRequest }));
vi.mock("../project-registry", () => ({ safePathLabel: mocks.safePathLabel }));

import { handleChatModelsGet } from "../handlers/chat-models";
import { handleChatSettingsGet } from "../handlers/chat-settings";

describe("chat settings reads", () => {
	it("reads the independent settings groups into one validated response", async () => {
		const response = await handleChatSettingsGet(
			new Request("http://localhost/api/chat/settings?projectId=project-1"),
		);
		const body = (await response.json()) as {
			projectPath: string;
			effective: { defaultModel?: string; defaultProvider?: string };
		};

		expect(response.status).toBe(200);
		expect(body.projectPath).toBe("/workspace/project");
		expect(body.effective.defaultModel).toBe("global-model");
		expect(body.effective.defaultProvider).toBe("project-provider");
		expect(mocks.manager.getGlobalSettings).toHaveBeenCalledOnce();
		expect(mocks.manager.getProjectSettings).toHaveBeenCalledOnce();
		expect(mocks.manager.getCompactionSettings).toHaveBeenCalledOnce();
		expect(mocks.manager.getRetrySettings).toHaveBeenCalledOnce();
	});

	it("returns only models added in settings whose provider is configured and working", async () => {
		mocks.manager.getEnabledModels.mockReturnValueOnce(undefined as unknown as string[]);

		const emptyResponse = await handleChatModelsGet(new Request("http://localhost/api/chat/models"));
		const emptyBody = (await emptyResponse.json()) as {
			models: Array<{ key: string }>;
			selectedModelKey?: string;
		};
		expect(emptyBody.models).toEqual([]);
		expect(emptyBody.selectedModelKey).toBeUndefined();

		mocks.manager.getEnabledModels.mockReturnValueOnce(["google/gemini-2.5-flash", "openai/gpt-4o"]);
		const filteredResponse = await handleChatModelsGet(new Request("http://localhost/api/chat/models"));
		const filteredBody = (await filteredResponse.json()) as {
			models: Array<{ key: string; available: boolean }>;
			selectedModelKey?: string;
		};
		expect(filteredBody.models.map((m) => m.key)).toEqual(["openai/gpt-4o"]);
		expect(filteredBody.models[0]?.available).toBe(true);
		expect(filteredBody.selectedModelKey).toBe("openai/gpt-4o");
	});
});
