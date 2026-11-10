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

const sessionBridge = vi.hoisted(() => ({
	getSession: vi.fn(),
	resumeSessionById: vi.fn(async () => undefined),
	getMessages: vi.fn(async (_id: string): Promise<unknown> => []),
}));

vi.mock("../singleton", () => ({
	getBridge: () => sessionBridge,
}));

vi.mock("../handlers/session-access", async () => {
	const { getBridge } = await import("../singleton");
	const requireProjectSession = async (session: unknown) => Boolean(session);
	return {
		requireProjectSession,
		requireSession: async (sessionId: string) => {
			const bridge = getBridge();
			const session = bridge.getSession(sessionId) ?? (await bridge.resumeSessionById(sessionId));
			if (!session || !(await requireProjectSession(session))) return undefined;
			return session;
		},
	};
});

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
	it.each(["workspace_tree", "list_resources"])(
		"preserves validated project context for %s and drops unrelated parameters",
		async (name) => {
			workspaceTreeGet.mockImplementation(() => Response.json({ nodes: [] }));
			chatResourcesGet.mockImplementation(() => Response.json({ skills: [] }));
			const request = new Request("http://localhost/api/chat/openui/tool?projectId=project-b&extra=discard", {
				method: "POST",
				headers: { Origin: "http://localhost", "Content-Type": "application/json" },
				body: JSON.stringify({ name, args: {} }),
			});
			expect((await handleOpenUIToolPost(request)).status).toBe(200);
			const forwarded = (name === "workspace_tree" ? workspaceTreeGet : chatResourcesGet).mock
				.calls[0][0] as Request;
			expect(new URL(forwarded.url).search).toBe("?projectId=project-b");
		},
	);
	it("rejects malformed project context before reading", async () => {
		const request = new Request("http://localhost/api/chat/openui/tool?projectId=../escape", {
			method: "POST",
			headers: { Origin: "http://localhost", "Content-Type": "application/json" },
			body: JSON.stringify({ name: "workspace_tree", args: {} }),
		});
		expect((await handleOpenUIToolPost(request)).status).toBe(422);
		expect(workspaceTreeGet).not.toHaveBeenCalled();
	});
	it.each(["./web//app/", "web///app//", "././web/app", "web/./app"])("normalizes workspace path %s", async (path) => {
		workspaceTreeGet.mockResolvedValue(
			Response.json({
				nodes: [
					{
						name: "web",
						path: "web",
						type: "directory",
						children: [
							{
								name: "app",
								path: "web/app",
								type: "directory",
								children: [{ name: "src", path: "web/app/src", type: "directory" }],
							},
						],
					},
				],
			}),
		);
		const response = await handleOpenUIToolPost(toolRequest({ name: "workspace_tree", args: { path } }));
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ rows: [{ path: "web/app/src" }] });
	});
	it("treats an empty normalized path as the workspace root", async () => {
		workspaceTreeGet.mockResolvedValue(Response.json({ nodes: [{ name: "web", path: "web", type: "directory" }] }));
		const response = await handleOpenUIToolPost(toolRequest({ name: "workspace_tree", args: { path: "././" } }));
		expect(await response.json()).toMatchObject({ rows: [{ path: "web" }] });
	});
	it("forwards headers and only the tool's own query parameters", async () => {
		chatSessionsGet.mockImplementation(() => Response.json({ sessions: [] }));
		const makeRequest = (args: object) =>
			new Request("http://localhost/api/chat/openui/tool?projectId=untrusted&extra=yes", {
				method: "POST",
				headers: { Origin: "http://localhost", "Content-Type": "application/json", "X-Test": "kept" },
				body: JSON.stringify({ name: "list_sessions", args }),
			});
		expect((await handleOpenUIToolPost(makeRequest({}))).status).toBe(200);
		const first = chatSessionsGet.mock.calls[0][0] as Request;
		expect(new URL(first.url).search).toBe("");
		expect(first.method).toBe("GET");
		expect(first.headers.get("X-Test")).toBe("kept");
		expect((await handleOpenUIToolPost(makeRequest({ projectId: "chosen" }))).status).toBe(200);
		expect(new URL((chatSessionsGet.mock.calls[1][0] as Request).url).search).toBe("?projectId=chosen");
	});

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

	it("reads only the requested session and leaves reasoning out", async () => {
		sessionBridge.getSession.mockImplementation((id: string) =>
			id === "session-a" || id === "session-b" ? { sessionId: id, projectId: "project-1" } : undefined,
		);
		sessionBridge.getMessages.mockImplementation(async (id: string) =>
			id === "session-a"
				? [
						{
							id: "m1",
							role: "assistant",
							parts: [
								{ type: "reasoning", contentIndex: 0, text: "secret reasoning", state: "complete" },
								{ type: "text", text: "Visible answer" },
								{ type: "tool-read", toolName: "read", output: "file.ts" },
							],
						},
					]
				: [{ id: "m2", role: "user", parts: [{ type: "text", text: "Other session" }] }],
		);

		const response = await handleOpenUIToolPost(
			toolRequest({ name: "session_outputs", args: {}, sessionId: "session-a" }),
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.rows).toEqual([
			{ turn: 1, role: "assistant", kind: "text", toolName: "", preview: "Visible answer" },
			{ turn: 1, role: "assistant", kind: "tool", toolName: "read", preview: "file.ts" },
		]);
		expect(JSON.stringify(body)).not.toContain("secret reasoning");
		expect(body.total).toBe(2);
		/**
		 * The route forwards the whole tool envelope. Narrowing it to rows/total
		 * left the table body blank, because `Col` binds `columns.<field>`.
		 */
		expect(body.columns).toEqual({
			turn: [1, 1],
			role: ["assistant", "assistant"],
			kind: ["text", "tool"],
			toolName: ["", "read"],
			preview: ["Visible answer", "file.ts"],
		});

		const other = await handleOpenUIToolPost(
			toolRequest({ name: "session_outputs", args: {}, sessionId: "session-b" }),
		);
		expect(await other.json()).toMatchObject({
			rows: [{ preview: "Other session" }],
			total: 1,
		});
	});

	it("reports the session total independently of the page limit", async () => {
		sessionBridge.getSession.mockImplementation((id: string) =>
			id === "session-a" ? { sessionId: id, projectId: "project-1" } : undefined,
		);
		sessionBridge.getMessages.mockResolvedValue(
			Array.from({ length: 5 }, (_, index) => ({
				id: `m${index}`,
				role: "assistant",
				parts: [{ type: "text", text: `Line ${index}` }],
			})),
		);

		const body = await (
			await handleOpenUIToolPost(
				toolRequest({ name: "session_outputs", args: { limit: 2 }, sessionId: "session-a" }),
			)
		).json();

		expect(body.rows).toHaveLength(2);
		expect(body.total).toBe(5);
	});

	it("rejects a session id supplied as a tool argument", async () => {
		sessionBridge.getMessages.mockClear();
		const response = await handleOpenUIToolPost(
			toolRequest({ name: "session_outputs", args: { sessionId: "session-b" }, sessionId: "session-a" }),
		);
		expect(response.status).toBe(422);
		expect(sessionBridge.getMessages).not.toHaveBeenCalled();
	});
});
