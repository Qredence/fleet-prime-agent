import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleChatAbortPost } from "../handlers/chat-abort";
import { handleChatCommandPost } from "../handlers/chat-command";
import { handleChatQuestionPost } from "../handlers/chat-question";
import { handleChatResumePost } from "../handlers/chat-resume";
import { handleChatSessionDelete, handleChatSessionRenamePatch } from "../handlers/chat-session-mutations";
import { handleProjectSessionFork } from "../handlers/projects";

const mocks = vi.hoisted(() => ({
	retainSession: () => () => {},
	getSession: vi.fn(),
	resumeSessionById: vi.fn(),
	getProject: vi.fn(),
	operations: {
		abort: vi.fn(),
		abortRlmChild: vi.fn(),
		answerDialog: vi.fn(),
		deleteSession: vi.fn(),
		setSessionName: vi.fn(),
		getSessionName: vi.fn(),
		getContextUsage: vi.fn(),
		getSystemPrompt: vi.fn(),
		exportSession: vi.fn(),
		reloadResources: vi.fn(),
		navigateTree: vi.fn(),
		getSessionTree: vi.fn(),
		forkSession: vi.fn(),
		forkSessionIntoProject: vi.fn(),
		getMessages: vi.fn(),
		getPresentation: vi.fn(),
	},
}));
vi.mock("../singleton", () => ({ getBridge: () => ({ ...mocks, ...mocks.operations }) }));
vi.mock("../prime-config", () => ({ getPrimeConfig: () => ({ projectRegistry: { get: mocks.getProject } }) }));
vi.mock("../managed-plan-presentations", () => ({ loadManagedPlanPresentations: async () => [] }));

const session = { sessionId: "session-1", projectId: "project-1" };
const cases = [
	{ name: "abort", handle: handleChatAbortPost, body: {}, method: "POST", operation: "abort" },
	{
		name: "abort child",
		handle: handleChatAbortPost,
		body: { childId: "child-1" },
		method: "POST",
		operation: "abortRlmChild",
	},
	{
		name: "answer dialog",
		handle: handleChatQuestionPost,
		body: { toolCallId: "question-1", answer: { kind: "skip" } },
		method: "POST",
		operation: "answerDialog",
	},
	{
		name: "rename",
		handle: handleChatSessionRenamePatch,
		body: { title: "Renamed" },
		method: "PATCH",
		operation: "setSessionName",
	},
	{ name: "delete", handle: handleChatSessionDelete, body: {}, method: "DELETE", operation: "deleteSession" },
	{ name: "resume", handle: handleChatResumePost, body: {}, method: "POST", operation: "getMessages" },
	{
		name: "project fork",
		handle: handleProjectSessionFork,
		body: { targetProjectId: "project-2" },
		method: "POST",
		operation: "forkSessionIntoProject",
	},
	...[
		["session", "getSessionName"],
		["name", "setSessionName"],
		["context", "getContextUsage"],
		["system-prompt", "getSystemPrompt"],
		["export", "exportSession"],
		["reload", "reloadResources"],
		["tree", "navigateTree"],
		["fork", "forkSession"],
		["clone", "forkSession"],
	].map(([command, operation]) => ({
		name: `command ${command}`,
		handle: handleChatCommandPost,
		body: { command, args: "entry-or-name" },
		method: "POST",
		operation,
	})),
];

function request(body: unknown, method: string, origin?: string) {
	return new Request("http://localhost/api/chat", {
		method,
		headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) },
		body: JSON.stringify({ sessionId: session.sessionId, ...(body as Record<string, unknown>) }),
	});
}

function expectNoSessionOperations() {
	for (const operation of Object.values(mocks.operations)) expect(operation).not.toHaveBeenCalled();
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.getSession.mockReturnValue(session);
	mocks.getProject.mockResolvedValue({ projectId: session.projectId });
	mocks.operations.abortRlmChild.mockResolvedValue(true);
	mocks.operations.answerDialog.mockReturnValue(true);
	mocks.operations.deleteSession.mockResolvedValue(true);
	mocks.operations.exportSession.mockResolvedValue({ path: "session.html", format: "html" });
	mocks.operations.getSessionTree.mockReturnValue({ leafId: "entry-1" });
	mocks.operations.forkSession.mockResolvedValue({ newSessionId: "forked-session" });
	mocks.operations.forkSessionIntoProject.mockResolvedValue("forked-session");
	mocks.operations.getMessages.mockResolvedValue([]);
	mocks.operations.getPresentation.mockReturnValue({
		revision: 0,
		userBash: [],
		rlmChildren: [],
		refinements: [],
		artifactRuns: [],
	});
});

describe.each(cases)("session HTTP access: $name", ({ handle, body, method, operation, name }) => {
	it.each(["unknown", "unassigned", "unregistered"])(
		"rejects %s sessions before any session operation",
		async (state) => {
			if (state === "unknown") mocks.getSession.mockReturnValue(undefined);
			if (state === "unassigned") mocks.getSession.mockReturnValue({ ...session, projectId: null });
			if (state === "unregistered") mocks.getProject.mockRejectedValue(new Error("Unknown project"));
			const response = await handle(request(body, method));
			expect(response.status).toBe(404);
			expectNoSessionOperations();
			if (state !== "unknown") expect(mocks.resumeSessionById).not.toHaveBeenCalled();
		},
	);

	it("rejects a foreign origin before resolving a session", async () => {
		const response = await handle(request(body, method, "https://untrusted.example"));
		expect(response.status).toBe(403);
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.resumeSessionById).not.toHaveBeenCalled();
		expectNoSessionOperations();
	});

	it("preserves registered-project operations", async () => {
		const response = await handle(request(body, method));
		expect(response.status).toBe(name === "project fork" ? 201 : 200);
		expect(mocks.operations[operation as keyof typeof mocks.operations]).toHaveBeenCalled();
		expect(mocks.getProject).toHaveBeenCalledWith(session.projectId);
	});
});

it("does not resolve an expired question or abort an unknown child", async () => {
	mocks.operations.answerDialog.mockReturnValue(false);
	mocks.operations.abortRlmChild.mockResolvedValue(false);
	expect(
		(await handleChatQuestionPost(request({ toolCallId: "expired", answer: { kind: "skip" } }, "POST"))).status,
	).toBe(404);
	expect((await handleChatAbortPost(request({ childId: "unknown-child" }, "POST"))).status).toBe(404);
});

it.each(["name", "fork", "clone"])("keeps /%s validation guidance readable over HTTP", async (command) => {
	mocks.operations.getSessionTree.mockReturnValue({ leafId: null });
	const response = await handleChatCommandPost(request({ command }, "POST"));
	expect(response.status).toBe(400);
	expect((await response.json()).message).toContain(`/${command} requires`);
	expect(mocks.operations.setSessionName).not.toHaveBeenCalled();
	expect(mocks.operations.forkSession).not.toHaveBeenCalled();
});

it("rejects mismatched project-scoped resume before reading the session", async () => {
	const response = await handleChatResumePost(request({ projectId: "another-project" }, "POST"));
	expect(response.status).toBe(404);
	expectNoSessionOperations();
	expect(mocks.resumeSessionById).not.toHaveBeenCalled();
});
