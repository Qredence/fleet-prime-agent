import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatSessionTreeGet, handleChatSessionTreeNavigatePost } from "../handlers/session-tree";
import type { PrimeBridge } from "../prime-bridge";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({
		projectRegistry: {
			get: async (projectId: string) => {
				if (projectId === "project-1") return { projectId };
				throw new Error("Unknown project");
			},
		},
	}),
}));

afterEach(() => {
	resetBridgeForTests();
});

const snapshot = {
	sessionId: "session-1",
	leafId: "entry-2",
	nodes: [
		{
			id: "entry-1",
			kind: "message" as const,
			role: "user" as const,
			label: "message",
			preview: "user: hello",
			isLeaf: false,
			isOnActiveBranch: true,
			messageIndex: 0,
			children: [
				{
					id: "entry-2",
					kind: "message" as const,
					role: "assistant" as const,
					label: "message",
					preview: "assistant: hi",
					isLeaf: true,
					isOnActiveBranch: true,
					messageIndex: 1,
					children: [],
				},
			],
		},
	],
};

describe("session tree handlers", () => {
	it("reads a browser-safe snapshot for a registered session", async () => {
		const readSessionTreeSnapshot = vi.fn().mockResolvedValue(snapshot);
		setBridgeForTests({
			getSession: vi.fn(() => ({ sessionId: "session-1", projectId: "project-1", isStreaming: false })),
			resumeSessionById: vi.fn(),
			readSessionTreeSnapshot,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatSessionTreeGet(
			new Request("http://localhost/api/chat/session-tree?sessionId=session-1"),
		);

		expect(response.status).toBe(200);
		expect(readSessionTreeSnapshot).toHaveBeenCalledWith("session-1");
		await expect(response.json()).resolves.toEqual({ snapshot });
	});

	it("rejects navigate while the session is streaming", async () => {
		const navigateSessionTree = vi.fn();
		setBridgeForTests({
			getSession: vi.fn(() => ({ sessionId: "session-1", projectId: "project-1", isStreaming: true })),
			resumeSessionById: vi.fn(),
			navigateSessionTree,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatSessionTreeNavigatePost(
			new Request("http://localhost/api/chat/session-tree", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: "session-1", targetEntryId: "entry-1" }),
			}),
		);

		expect(response.status).toBe(409);
		expect(navigateSessionTree).not.toHaveBeenCalled();
	});

	it("navigates the tree and returns the authoritative snapshot", async () => {
		const navigateSessionTree = vi.fn().mockResolvedValue(snapshot);
		setBridgeForTests({
			getSession: vi.fn(() => ({ sessionId: "session-1", projectId: "project-1", isStreaming: false })),
			resumeSessionById: vi.fn(),
			navigateSessionTree,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatSessionTreeNavigatePost(
			new Request("http://localhost/api/chat/session-tree", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: "session-1",
					targetEntryId: "entry-1",
					expectedLeafId: "entry-2",
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(navigateSessionTree).toHaveBeenCalledWith("session-1", "entry-1", "entry-2");
		await expect(response.json()).resolves.toEqual({ snapshot });
	});
});
