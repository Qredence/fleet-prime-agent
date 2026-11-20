import { beforeEach, expect, it, vi } from "vitest";
import { handleChatCommandsGet } from "../handlers/chat-commands";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	resumeSessionById: vi.fn(),
	listDaemonCommands: vi.fn(),
}));
vi.mock("../singleton", () => ({ getBridge: () => ({ ...mocks, retainSession: () => () => {} }) }));
vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({
		defaultCwd: "/project",
		projectRegistry: { get: async () => ({}), cwdForProject: async () => "/project" },
		settingsFor: () => ({ getEnableSkillCommands: () => false }),
		resourceLoaderFor: async () => ({
			getSkills: () => ({ skills: [], diagnostics: [] }),
			getPrompts: () => ({ prompts: [], diagnostics: [] }),
			getExtensions: () => ({ extensions: [], errors: [] }),
		}),
	}),
}));
beforeEach(() => vi.resetAllMocks());
const request = () => new Request("http://localhost/api/chat/commands?sessionId=session-a&projectId=project-a");
it("uses the baseline catalog for a session from another project", async () => {
	mocks.getSession.mockReturnValue({ sessionId: "session-a", projectId: "project-b" });
	const response = await handleChatCommandsGet(request());
	expect(response.status).toBe(200);
	expect((await response.json()).commands).toContainEqual(expect.objectContaining({ name: "copy" }));
	expect(mocks.listDaemonCommands).not.toHaveBeenCalled();
});
it("uses the baseline catalog after resume rejection", async () => {
	mocks.resumeSessionById.mockRejectedValue(new Error("resume failed"));
	const response = await handleChatCommandsGet(request());
	expect(response.status).toBe(200);
	expect((await response.json()).commands.length).toBeGreaterThan(0);
	expect(mocks.listDaemonCommands).not.toHaveBeenCalled();
});
it("preserves daemon commands for matching sessions and falls back on daemon failure", async () => {
	mocks.getSession.mockReturnValue({ sessionId: "session-a", projectId: "project-a" });
	mocks.listDaemonCommands.mockResolvedValueOnce([{ name: "custom", description: "Custom" }]);
	expect((await (await handleChatCommandsGet(request())).json()).commands).toContainEqual(
		expect.objectContaining({ name: "custom" }),
	);
	mocks.listDaemonCommands.mockRejectedValueOnce(new Error("offline"));
	expect((await (await handleChatCommandsGet(request())).json()).commands).toContainEqual(
		expect.objectContaining({ name: "copy" }),
	);
});
