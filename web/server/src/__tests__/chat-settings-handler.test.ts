import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const manager = {
		getGlobalSettings: vi.fn(() => ({ defaultModel: "global-model" })),
		getProjectSettings: vi.fn(() => ({ defaultProvider: "project-provider" })),
		getCompactionSettings: vi.fn(() => ({ enabled: true, reserveTokens: 100, keepRecentTokens: 200 })),
		getRetrySettings: vi.fn(() => ({ enabled: true, maxRetries: 2, baseDelayMs: 50 })),
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
		getPrimeConfig: vi.fn(() => ({ settingsFor: vi.fn(() => manager) })),
		cwdForRequest: vi.fn(async () => "/workspace/project"),
		safePathLabel: vi.fn((cwd: string) => cwd),
	};
});

vi.mock("../prime-config", () => ({ getPrimeConfig: mocks.getPrimeConfig }));
vi.mock("../project-request", () => ({ cwdForRequest: mocks.cwdForRequest }));
vi.mock("../project-registry", () => ({ safePathLabel: mocks.safePathLabel }));

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
});
