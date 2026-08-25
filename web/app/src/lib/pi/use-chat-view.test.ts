import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { describe, expect, it } from "vitest";
import { buildContextSuggestions, getActiveSessionLabel } from "./use-chat-view";

const session: ChatSessionInfo = {
	sessionId: "session-1",
	title: "Saved session name",
	createdAt: "2026-08-15T00:00:00.000Z",
	updatedAt: "2026-08-15T00:00:00.000Z",
	status: "idle",
	messageCount: 1,
	firstMessage: "Transcript title",
};

const messages: Array<ChatMessage> = [
	{
		id: "message-1",
		role: "user",
		parts: [{ type: "text", text: "Transcript title" }],
	},
];

describe("getActiveSessionLabel", () => {
	it("prefers an explicit saved session name over the transcript", () => {
		expect(getActiveSessionLabel("session-1", [session], messages)).toBe("Saved session name");
	});

	it("falls back to the transcript when the active session is not listed", () => {
		expect(getActiveSessionLabel("session-2", [session], messages)).toBe("Transcript title");
	});
});

describe("buildContextSuggestions", () => {
	it("does not mistake review prose for a failed turn", () => {
		const suggestions = buildContextSuggestions({
			messages: [
				messages[0]!,
				{
					id: "assistant-review",
					role: "assistant",
					parts: [{ type: "text", text: "I found two issues and one error-handling improvement." }],
				},
			],
			resources: null,
			workspaceTree: null,
		});

		expect(suggestions.map((item) => item.label)).toEqual([
			"Go deeper on this",
			"What should I do next?",
			"Show workspace files",
		]);
	});

	it("offers recovery actions for a structured error", () => {
		const suggestions = buildContextSuggestions({
			messages: [
				messages[0]!,
				{
					id: "assistant-error",
					role: "assistant",
					parts: [{ type: "error", message: "Command failed" }],
				},
			],
			resources: null,
			workspaceTree: null,
		});

		expect(suggestions.map((item) => item.label)).toEqual([
			"Fix the error",
			"Explain what went wrong",
			"Suggest an alternative approach",
		]);
	});
});
