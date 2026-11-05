import { afterEach, describe, expect, it, vi } from "vitest";
import { handleOpenUIToolPost } from "../handlers/openui-tool";

const workspaceTreeGet = vi.fn();
const chatSessionsGet = vi.fn();
const chatResourcesGet = vi.fn();

vi.mock("../handlers/workspace-tree", () => ({
	handleWorkspaceTreeGet: (request: Request) => workspaceTreeGet(request),
}));

vi.mock("../handlers/chat-sessions", () => ({
	handleChatSessionsGet: (request: Request) => chatSessionsGet(request),
}));

vi.mock("../handlers/chat-resources", () => ({
	handleChatResourcesGet: (request: Request) => chatResourcesGet(request),
}));

function toolRequest(body: unknown): Request {
	return new Request("http://localhost/api/chat/openui/tool", {
		method: "POST",
		headers: { "Content-Type": "application/json", Origin: "http://localhost" },
		body: JSON.stringify(body),
	});
}

afterEach(() => {
	workspaceTreeGet.mockReset();
	chatSessionsGet.mockReset();
	chatResourcesGet.mockReset();
});

describe("handleOpenUIToolPost", () => {
	it("rejects an unknown tool name", async () => {
		const response = await handleOpenUIToolPost(toolRequest({ name: "delete_everything", args: {} }));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ ok: false });
	});

	it("rejects a session status Fleet does not report", async () => {
		const response = await handleOpenUIToolPost(toolRequest({ name: "list_sessions", args: { status: "error" } }));
		expect(response.status).toBe(422);
		expect(chatSessionsGet).not.toHaveBeenCalled();
	});

	it("filters sessions by a reported status", async () => {
		chatSessionsGet.mockResolvedValue(
			Response.json({
				sessions: [
					{
						sessionId: "a",
						title: "A",
						projectId: "p",
						status: "failed",
						messageCount: 1,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-02T00:00:00.000Z",
					},
					{
						sessionId: "b",
						title: "B",
						projectId: "p",
						status: "idle",
						messageCount: 1,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-03T00:00:00.000Z",
					},
				],
			}),
		);

		const response = await handleOpenUIToolPost(toolRequest({ name: "list_sessions", args: { status: "failed" } }));

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			rows: [{ sessionId: "a", status: "failed" }],
		});
	});

	it("rejects a limit outside the allowed range", async () => {
		const response = await handleOpenUIToolPost(toolRequest({ name: "list_sessions", args: { limit: 9999 } }));
		expect(response.status).toBe(422);
	});

	it("rejects a workspace path that escapes the workspace", async () => {
		const response = await handleOpenUIToolPost(toolRequest({ name: "workspace_tree", args: { path: "../../etc" } }));
		expect(response.status).toBe(422);
	});

	it("returns no rows for an unknown workspace path", async () => {
		workspaceTreeGet.mockResolvedValue(
			Response.json({
				nodes: [
					{
						name: "web",
						path: "web",
						type: "directory",
						children: [{ name: "app", path: "web/app", type: "directory", children: [] }],
					},
				],
			}),
		);

		const response = await handleOpenUIToolPost(
			toolRequest({ name: "workspace_tree", args: { path: "does/not/exist" } }),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, rows: [] });
	});

	it("aggregates session_stats into one row per status", async () => {
		chatSessionsGet.mockResolvedValue(
			Response.json({
				sessions: [
					{
						sessionId: "a",
						title: "A",
						projectId: "p",
						status: "idle",
						messageCount: 2,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-02T00:00:00.000Z",
					},
					{
						sessionId: "b",
						title: "B",
						projectId: "p",
						status: "running",
						messageCount: 5,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-03T00:00:00.000Z",
					},
					{
						sessionId: "c",
						title: "C",
						projectId: "p",
						status: "idle",
						messageCount: 1,
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-04T00:00:00.000Z",
					},
				],
			}),
		);

		const response = await handleOpenUIToolPost(toolRequest({ name: "session_stats", args: {} }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			rows: [
				{ status: "idle", sessions: 2, messages: 3 },
				{ status: "running", sessions: 1, messages: 5 },
			],
		});
	});
});
