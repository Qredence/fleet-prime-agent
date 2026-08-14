import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { describe, expect, it } from "vitest";
import { getActiveSessionLabel } from "./use-chat-view";

const session: ChatSessionInfo = {
	path: "/tmp/session.jsonl",
	id: "session-1",
	cwd: "/tmp",
	created: "2026-08-15T00:00:00.000Z",
	modified: "2026-08-15T00:00:00.000Z",
	messageCount: 1,
	firstMessage: "Transcript title",
	name: "Saved session name",
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

	it("falls back to the transcript when no explicit name is saved", () => {
		const unnamed = { ...session, name: undefined };
		expect(getActiveSessionLabel("session-1", [unnamed], messages)).toBe("Transcript title");
	});
});
