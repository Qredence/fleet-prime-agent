import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it } from "vitest";
import {
	shouldClearPendingAttachments,
	shouldClearPendingAttachmentsForNewSession,
} from "./pending-attachment-lifecycle";

const projectA = "project-a";

describe("pending attachment lifecycle", () => {
	it.each([
		[
			"resuming another session",
			{ sessionId: "session-1", projectId: projectA },
			{ sessionId: "session-2", projectId: projectA },
		],
		[
			"switching projects",
			{ sessionId: "session-1", projectId: projectA },
			{ sessionId: "session-1", projectId: "project-b" },
		],
		["starting without a target session", { sessionId: "session-1", projectId: projectA }, { projectId: projectA }],
	])("clears attachments when %s", (_label, current, next) => {
		expect(shouldClearPendingAttachments(current, next)).toBe(true);
	});

	it("preserves attachments when the same session remains active", () => {
		const current: ChatSessionMetadata = { sessionId: "session-1", projectId: projectA };
		expect(shouldClearPendingAttachments(current, current)).toBe(false);
	});

	it("preserves attachments while creating the first session in the current project", () => {
		expect(shouldClearPendingAttachmentsForNewSession({ projectId: projectA }, projectA)).toBe(false);
	});

	it("clears attachments for a new session after a session or project transition", () => {
		expect(
			shouldClearPendingAttachmentsForNewSession({ sessionId: "session-1", projectId: projectA }, projectA),
		).toBe(true);
		expect(shouldClearPendingAttachmentsForNewSession({ projectId: projectA }, "project-b")).toBe(true);
	});
});
