import { ChatRequestSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import {
	OpenPanelActionSchema,
	OpenUIActionSchema,
	SessionIdSchema,
	UploadedAttachmentSchema,
	WorkspaceRelativePathSchema,
} from "@prime-agent/web-protocol/fleet-contract";
import { describe, expect, it } from "vitest";

describe("Fleet browser contracts", () => {
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

	it("enforces relativePath only for workspace and artifacts panels", () => {
		expect(OpenPanelActionSchema.safeParse({ panel: "workspace", relativePath: "src/app.ts" }).success).toBe(true);
		expect(OpenPanelActionSchema.safeParse({ panel: "artifacts", relativePath: "report.md" }).success).toBe(true);
		expect(OpenPanelActionSchema.safeParse({ panel: "resources" }).success).toBe(true);
		expect(OpenPanelActionSchema.safeParse({ panel: "repl" }).success).toBe(true);
		expect(OpenPanelActionSchema.safeParse({ panel: "subagents" }).success).toBe(true);
		expect(OpenPanelActionSchema.safeParse({ panel: "session-insights" }).success).toBe(true);
		expect(OpenPanelActionSchema.safeParse({ panel: "resources", relativePath: "src/app.ts" }).success).toBe(false);
		expect(OpenPanelActionSchema.safeParse({ panel: "session-insights", relativePath: "src/app.ts" }).success).toBe(
			false,
		);
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
