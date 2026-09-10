import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
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

import { handleChatAttachmentGet, handleChatAttachmentsPost } from "../handlers/chat-attachments";

describe("chat attachment upload ordering", () => {
	let root: string;
	const session = { sessionId: "session-1", projectId: "project-1", sessionPath: "" };

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

	it("rolls back sibling writes when one upload fails validation", async () => {
		const form = new FormData();
		form.append("sessionId", session.sessionId);
		form.append("files", new File(["valid"], "valid.txt", { type: "text/plain" }));
		form.append(
			"files",
			new File([new Uint8Array(26 * 1024 * 1024)], "oversize.bin", { type: "application/octet-stream" }),
		);

		const response = await handleChatAttachmentsPost(
			new Request("http://localhost/api/chat/attachments", {
				method: "POST",
				body: form,
			}),
		);

		expect(response.status).toBe(500);
		const storageRoot = join(root, "session-attachments", session.sessionId);
		const leftovers = await readdir(storageRoot).catch(() => [] as string[]);
		expect(leftovers).toEqual([]);
	});

	it("rejects uploads for sessions outside registered projects", async () => {
		bridgeMock.getSession.mockReturnValue({ sessionId: "session-1", projectId: null });
		const form = new FormData();
		form.append("sessionId", session.sessionId);
		form.append("files", new File(["first"], "first.txt", { type: "text/plain" }));

		const response = await handleChatAttachmentsPost(
			new Request("http://localhost/api/chat/attachments", {
				method: "POST",
				body: form,
			}),
		);

		expect(response.status).toBe(404);
	});

	it("serves verified raster images inline while keeping executable content as downloads", async () => {
		const imageForm = new FormData();
		imageForm.append("sessionId", session.sessionId);
		imageForm.append(
			"files",
			new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "preview.png", {
				type: "image/png",
			}),
		);
		const imageUpload = await handleChatAttachmentsPost(
			new Request("http://localhost/api/chat/attachments", { method: "POST", body: imageForm }),
		);
		const image = (await imageUpload.json()) as { attachments: Array<{ attachmentId: string }> };
		const imageResponse = await handleChatAttachmentGet(
			new Request(
				`http://localhost/api/chat/attachments?sessionId=${session.sessionId}&attachmentId=${image.attachments[0]?.attachmentId}`,
			),
		);
		expect(imageResponse.headers.get("Content-Type")).toBe("image/png");
		expect(imageResponse.headers.get("Content-Disposition")).toBeNull();
		const mislabeledImageForm = new FormData();
		mislabeledImageForm.append("sessionId", session.sessionId);
		mislabeledImageForm.append("files", new File(["not an image"], "spoofed.png", { type: "image/png" }));
		const mislabeledUpload = await handleChatAttachmentsPost(
			new Request("http://localhost/api/chat/attachments", { method: "POST", body: mislabeledImageForm }),
		);
		const mislabeled = (await mislabeledUpload.json()) as { attachments: Array<{ attachmentId: string }> };
		const mislabeledResponse = await handleChatAttachmentGet(
			new Request(
				`http://localhost/api/chat/attachments?sessionId=${session.sessionId}&attachmentId=${mislabeled.attachments[0]?.attachmentId}`,
			),
		);
		expect(mislabeledResponse.headers.get("Content-Type")).toBe("application/octet-stream");
		expect(mislabeledResponse.headers.get("Content-Disposition")).toContain("attachment;");

		const form = new FormData();
		form.append("sessionId", session.sessionId);
		form.append("files", new File(["<svg></svg>"], "evil.svg", { type: "image/svg+xml" }));

		const upload = await handleChatAttachmentsPost(
			new Request("http://localhost/api/chat/attachments", {
				method: "POST",
				body: form,
			}),
		);
		const uploaded = (await upload.json()) as { attachments: Array<{ attachmentId: string }> };
		expect(upload.status).toBe(200);

		const response = await handleChatAttachmentGet(
			new Request(
				`http://localhost/api/chat/attachments?sessionId=${session.sessionId}&attachmentId=${uploaded.attachments[0]?.attachmentId}`,
			),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
		expect(response.headers.get("Content-Disposition")).toContain("attachment;");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});
});
