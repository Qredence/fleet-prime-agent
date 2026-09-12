import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatQueueMutationPost } from "../handlers/chat-queue";
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

describe("handleChatQueueMutationPost", () => {
	it("deletes the expected queued message and returns the authoritative queue", async () => {
		const mutateQueuedMessage = vi.fn().mockResolvedValue({
			status: "applied",
			queue: { steering: [], followUp: ["after"] },
		});
		setBridgeForTests({
			getSession: vi.fn(() => ({ sessionId: "session-1", projectId: "project-1" })),
			resumeSessionById: vi.fn(),
			mutateQueuedMessage,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatQueueMutationPost(
			new Request("http://localhost/api/chat/session", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: "session-1",
					lane: "steering",
					index: 0,
					expectedText: "next",
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(mutateQueuedMessage).toHaveBeenCalledWith("session-1", "steering", 0, "next", { type: "delete" });
		await expect(response.json()).resolves.toEqual({
			status: "applied",
			queue: { steering: [], followUp: ["after"] },
		});
	});

	it("replaces the expected queued message and returns the authoritative queue", async () => {
		const mutateQueuedMessage = vi.fn().mockResolvedValue({
			status: "applied",
			queue: { steering: ["updated"], followUp: [] },
		});
		setBridgeForTests({
			getSession: vi.fn(() => ({ sessionId: "session-1", projectId: "project-1" })),
			resumeSessionById: vi.fn(),
			mutateQueuedMessage,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatQueueMutationPost(
			new Request("http://localhost/api/chat/session", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: "session-1",
					lane: "steering",
					index: 0,
					expectedText: "next",
					mutation: { type: "replace", text: "updated", lane: "steering" },
				}),
			}),
		);

		expect(response.status).toBe(200);
		expect(mutateQueuedMessage).toHaveBeenCalledWith("session-1", "steering", 0, "next", {
			type: "replace",
			text: "updated",
			lane: "steering",
		});
		await expect(response.json()).resolves.toEqual({
			status: "applied",
			queue: { steering: ["updated"], followUp: [] },
		});
	});

	it("rejects queued mutations for sessions outside registered projects", async () => {
		const mutateQueuedMessage = vi.fn();
		setBridgeForTests({
			getSession: vi.fn(() => ({ sessionId: "session-1", projectId: null })),
			resumeSessionById: vi.fn(async () => undefined),
			mutateQueuedMessage,
			resetForTests: vi.fn(),
		} as unknown as PrimeBridge);

		const response = await handleChatQueueMutationPost(
			new Request("http://localhost/api/chat/session", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: "session-1",
					lane: "steering",
					index: 0,
					expectedText: "next",
				}),
			}),
		);

		expect(response.status).toBe(404);
		expect(mutateQueuedMessage).not.toHaveBeenCalled();
	});
});
