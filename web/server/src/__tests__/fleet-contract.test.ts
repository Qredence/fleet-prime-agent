import { ChatRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import {
	ChatEventSchema,
	ChatToolPartSchema,
	OpenPanelActionSchema,
	OpenUIActionSchema,
	SessionIdSchema,
	UploadedAttachmentSchema,
	WorkspaceRelativePathSchema,
} from "@prime-agent/web-protocol/fleet-contract";
import { describe, expect, it } from "vitest";

describe("Fleet browser contracts", () => {
	it.each([
		{ kind: "shell", command: "pwd", output: "/workspace", exitCode: 0 },
		{ kind: "ipython", code: "1 + 1", output: "2" },
		{ kind: "file", operation: "edit", relativePath: "src/app.ts", diff: "+changed" },
		{ kind: "search", query: "Prime Agent", results: [{ title: "Docs", url: "https://example.com" }] },
		{ kind: "mcp", server: "local", tool: "read", input: { path: "README.md" } },
		{ kind: "plan", title: "Plan", steps: [{ text: "Implement", status: "running" }] },
		{ kind: "todo", items: [{ text: "Verify", completed: false }] },
		{ kind: "generic", name: "future-tool", output: { safe: true } },
	])("parses tool part $kind", (part) => {
		expect(ChatToolPartSchema.safeParse(part).success).toBe(true);
	});

	it.each([
		{ type: "text", messageId: "m1", text: "Hello", delta: true },
		{ type: "reasoning", messageId: "m1", text: "Thinking" },
		{ type: "lifecycle", phase: "started", label: "Working" },
		{ type: "tool", toolCallId: "t1", status: "running", part: { kind: "shell", command: "pwd" } },
		{ type: "approval", approvalId: "a1", toolCallId: "t1", title: "Run command" },
		{ type: "question", questionId: "q1", title: "Choose", options: [{ id: "yes", label: "Yes" }] },
		{ type: "plan", plan: { kind: "plan", steps: [{ text: "Ship", status: "pending" }] } },
		{ type: "todo", todo: { kind: "todo", items: [{ text: "Test", completed: true }] } },
		{ type: "citation", messageId: "m1", citationId: "c1", title: "Source", url: "https://example.com" },
		{
			type: "attachment",
			messageId: "m1",
			attachment: {
				kind: "upload",
				attachmentId: "b3a8bc7e-2c66-4ba3-8a33-17ce76591f61",
				name: "image.png",
				mimeType: "image/png",
				size: 10,
			},
		},
		{ type: "openui", messageId: "m1", payload: { root: "card" }, final: true },
		{ type: "completion", reason: "stop" },
		{ type: "interruption", reason: "server restart", retryable: true },
		{ type: "error", code: "failed", message: "Failure", retryable: false },
	])("parses chat event $type", (event) => {
		expect(ChatEventSchema.safeParse(event).success).toBe(true);
	});

	it("rejects browser-visible paths, invalid panels, and malformed actions", () => {
		expect(SessionIdSchema.safeParse("../../session.jsonl").success).toBe(false);
		expect(WorkspaceRelativePathSchema.safeParse("../secret.txt").success).toBe(false);
		expect(OpenPanelActionSchema.safeParse({ panel: "settings" }).success).toBe(false);
		expect(
			OpenUIActionSchema.safeParse({
				sessionId: "session-1",
				messageId: "message-1",
				componentId: "component-1",
				actionId: "",
				payload: {},
			}).success,
		).toBe(false);
	});

	it("rejects malformed managed attachment metadata", () => {
		expect(
			UploadedAttachmentSchema.safeParse({
				kind: "upload",
				attachmentId: "not-an-id",
				name: "file.txt",
				mimeType: "text/plain",
				size: 1,
			}).success,
		).toBe(false);
	});

	it("enforces the aggregate per-turn attachment limit", () => {
		const attachments = Array.from({ length: 5 }, (_, index) => ({
			kind: "upload" as const,
			attachmentId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
			name: `file-${index}.bin`,
			mimeType: "application/octet-stream",
			size: 25 * 1024 * 1024,
		}));
		expect(ChatRequestSchema.safeParse({ sessionId: "session-1", message: "Review", attachments }).success).toBe(
			false,
		);
	});
});
