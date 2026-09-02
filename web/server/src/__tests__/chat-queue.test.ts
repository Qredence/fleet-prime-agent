import { afterEach, describe, expect, it, vi } from "vitest";
import { handleChatQueueMutationPost } from "../handlers/chat-queue";
import type { PrimeBridge } from "../prime-bridge";
import { resetBridgeForTests, setBridgeForTests } from "../singleton";

afterEach(() => {
	resetBridgeForTests();
});

describe("handleChatQueueMutationPost", () => {
	it("deletes the expected queued message and returns the authoritative queue", async () => {
		const deleteQueuedMessage = vi.fn().mockResolvedValue({
			status: "applied",
			queue: { steering: [], followUp: ["after"] },
		});
		setBridgeForTests({ deleteQueuedMessage, resetForTests: vi.fn() } as unknown as PrimeBridge);

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
		expect(deleteQueuedMessage).toHaveBeenCalledWith("session-1", "steering", 0, "next");
		await expect(response.json()).resolves.toEqual({
			status: "applied",
			queue: { steering: [], followUp: ["after"] },
		});
	});
});
