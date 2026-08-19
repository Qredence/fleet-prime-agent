import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
	getSession: vi.fn(),
	resumeSessionById: vi.fn(),
}));

vi.mock("../singleton", () => ({
	getBridge: () => bridgeMock,
}));

import { handleChatAttachmentsPost } from "../handlers/chat-attachments";

describe("chat attachment upload ordering", () => {
	let root: string;
	const session = { sessionId: "session-1", sessionPath: "" };

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "prime-chat-attachments-"));
		await mkdir(join(root, "sessions"));
		session.sessionPath = join(root, "sessions", "session-1.jsonl");
		bridgeMock.getSession.mockReset().mockReturnValue(session);
		bridgeMock.resumeSessionById.mockReset();
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("returns attachments in the same order as the multipart files", async () => {
		const form = new FormData();
		form.append("sessionId", session.sessionId);
		form.append("files", new File(["first"], "first.txt", { type: "text/plain" }));
		form.append("files", new File(["second"], "second.txt", { type: "text/plain" }));

		const response = await handleChatAttachmentsPost(
			new Request("http://localhost/api/chat/attachments", {
				method: "POST",
				body: form,
			}),
		);
		const body = (await response.json()) as { attachments: Array<{ name: string }> };

		expect(response.status).toBe(200);
		expect(body.attachments.map((attachment) => attachment.name)).toEqual(["first.txt", "second.txt"]);
	});
});
