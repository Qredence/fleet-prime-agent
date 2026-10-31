import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cwd: "" }));
vi.mock("../project-request", () => ({ cwdForRequest: async () => state.cwd }));

import type { DaemonModel } from "../daemon-protocol";
import { type ChatModelsHandlerDeps, handleChatModelsGet } from "../handlers/chat-models";
import { handleChatSettingsPatch } from "../handlers/chat-settings";
import { getPrimeConfig, resetPrimeConfigForTests } from "../prime-config";

const previousAgentDir = process.env.PRIME_AGENT_CODING_AGENT_DIR;
let tempDir = "";
afterEach(() => {
	if (previousAgentDir === undefined) delete process.env.PRIME_AGENT_CODING_AGENT_DIR;
	else process.env.PRIME_AGENT_CODING_AGENT_DIR = previousAgentDir;
	delete (globalThis as Record<string, unknown>).__primeConfig;
	if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

it("refreshes cached settings for all workspaces after a global settings write", async () => {
	tempDir = mkdtempSync(join(tmpdir(), "fleet-settings-cache-"));
	process.env.PRIME_AGENT_CODING_AGENT_DIR = tempDir;
	writeFileSync(join(tempDir, "settings.json"), JSON.stringify({ enabledModels: ["alpha/*"] }));
	const config = resetPrimeConfigForTests();
	state.cwd = config.defaultCwd;
	const otherCwd = join(tempDir, "other-project");
	const model = (provider: string, id: string): DaemonModel => ({
		provider,
		id,
		name: id,
		api: "openai-responses",
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	});
	const deps: ChatModelsHandlerDeps = {
		resolveCwd: async () => state.cwd,
		agentDir: tempDir,
		modelsJsonPath: join(tempDir, "models.json"),
		readCatalog: async () => ({ models: [model("alpha", "a1"), model("beta", "b1")], configuredProviders: [] }),
		providerAvailability: async () => () => true,
		settingsFor: (cwd) => config.settingsFor(cwd),
		customProvidersMissingApiKey: () => [],
	};
	const readModels = async () => {
		const response = await handleChatModelsGet(new Request("http://localhost/api/chat/models?scope=enabled"), deps);
		return ((await response.json()) as { models: { key: string }[] }).models.map((entry) => entry.key);
	};
	expect(config.settingsFor(state.cwd).getEnabledModels()).toEqual(["alpha/*"]);
	expect(config.settingsFor(otherCwd).getEnabledModels()).toEqual(["alpha/*"]);
	expect(await readModels()).toEqual(["alpha/a1"]);

	const response = await handleChatSettingsPatch(
		new Request("http://localhost/api/chat/settings", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ settings: { enabledModels: ["beta/*"] } }),
		}),
	);
	expect(response.status).toBe(200);
	expect(getPrimeConfig().settingsFor(state.cwd).getEnabledModels()).toEqual(["beta/*"]);
	expect(getPrimeConfig().settingsFor(otherCwd).getEnabledModels()).toEqual(["beta/*"]);
	expect(await readModels()).toEqual(["beta/b1"]);
});

it("preserves project overrides when global settings change", async () => {
	tempDir = mkdtempSync(join(tmpdir(), "fleet-settings-project-"));
	const agentDir = join(tempDir, "global");
	const project = join(tempDir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(project, ".prime", "agent"), { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: ["alpha/*"] }));
	writeFileSync(join(project, ".prime", "agent", "settings.json"), JSON.stringify({ enabledModels: ["project/*"] }));
	process.env.PRIME_AGENT_CODING_AGENT_DIR = agentDir;
	const config = resetPrimeConfigForTests();
	state.cwd = config.defaultCwd;
	expect(config.settingsFor(project).getEnabledModels()).toEqual(["project/*"]);
	const response = await handleChatSettingsPatch(
		new Request("http://localhost/api/chat/settings", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ settings: { enabledModels: ["beta/*"] } }),
		}),
	);
	expect(response.status).toBe(200);
	expect(config.settingsFor(project).getEnabledModels()).toEqual(["project/*"]);
});

it("refreshes a project settings write without changing another project's settings", async () => {
	tempDir = mkdtempSync(join(tmpdir(), "fleet-settings-project-write-"));
	const agentDir = join(tempDir, "global");
	state.cwd = join(tempDir, "project");
	const settingsDir = join(state.cwd, ".prime", "agent");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(settingsDir, { recursive: true });
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ enabledModels: ["global/*"] }));
	writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ enabledModels: ["alpha/*"] }));
	process.env.PRIME_AGENT_CODING_AGENT_DIR = agentDir;
	const config = resetPrimeConfigForTests();
	const otherCwd = join(tempDir, "other");
	expect(config.settingsFor(state.cwd).getEnabledModels()).toEqual(["alpha/*"]);
	expect(config.settingsFor(otherCwd).getEnabledModels()).toEqual(["global/*"]);
	const response = await handleChatSettingsPatch(
		new Request("http://localhost/api/chat/settings", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ settings: { enabledModels: ["beta/*"] } }),
		}),
	);
	expect(response.status).toBe(200);
	expect(config.settingsFor(state.cwd).getEnabledModels()).toEqual(["beta/*"]);
	expect(config.settingsFor(otherCwd).getEnabledModels()).toEqual(["global/*"]);
});
