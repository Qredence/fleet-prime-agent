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
			agentDir: "/missing-agent-dir",
			settingsFor: vi.fn(() => mocks.manager),
			modelRegistry: mocks.modelRegistry,
		})),
		cwdForRequest: vi.fn(async () => "/workspace/project"),
		safePathLabel: vi.fn((cwd: string) => cwd),
	};
});

vi.mock("../prime-config", () => ({ getPrimeConfig: mocks.getPrimeConfig }));
vi.mock("../project-request", () => ({ cwdForRequest: mocks.cwdForRequest }));
vi.mock("../project-registry", () => ({ safePathLabel: mocks.safePathLabel }));

import { handleChatModelsGet } from "../handlers/chat-models";
import { handleChatSettingsGet, handleChatSettingsPatch } from "../handlers/chat-settings";

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

describe("chat settings writes", () => {
	it("writes the patch to the global settings file and reports the consequences", async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "fleet-settings-handler-"));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ transport: "auto", agentTraces: true }), "utf8");
		mocks.getPrimeConfig.mockReturnValue({
			agentDir,
			settingsFor: vi.fn(() => mocks.manager),
			modelRegistry: mocks.modelRegistry,
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

		mocks.getPrimeConfig.mockReturnValue({
			agentDir: join(blocker, "agent-dir"),
			settingsFor: vi.fn(() => mocks.manager),
			modelRegistry: mocks.modelRegistry,
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

		rmSync(dir, { recursive: true, force: true });
	});
});
