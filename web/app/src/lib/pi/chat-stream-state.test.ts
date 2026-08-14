import type { ChatStreamEvent } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { describe, expect, it } from "vitest";
import { toChatMessage } from "./chat-message-helpers";
import {
	applyChatStreamEvent,
	type ChatStreamSnapshot,
	type ChatStreamTransition,
	EMPTY_QUEUE_STATE,
	normalizeSessionMetadata,
} from "./chat-stream-state";

function baseTransition(): ChatStreamTransition {
	const snapshot: ChatStreamSnapshot = {
		messages: [],
		queue: EMPTY_QUEUE_STATE,
		sessionMetadata: {},
	};
	return { assistantId: null, snapshot };
}

function start(id: string, runId = "run-1"): ChatStreamEvent {
	return {
		type: "start",
		id,
		runId,
		sessionId: "session-1",
	};
}

function delta(id: string, text: string): ChatStreamEvent {
	return { type: "delta", text, messageId: id };
}

function done(id: string, text: string, runId = "run-1"): ChatStreamEvent {
	const message: ChatMessage = toChatMessage(id, "assistant", [{ type: "text", text }]);
	return {
		type: "done",
		runId,
		message,
		sessionId: "session-1",
	};
}

function assistantMessages(transition: ChatStreamTransition): Array<ChatMessage> {
	return transition.snapshot.messages.filter((m) => m.role === "assistant");
}

describe("applyChatStreamEvent", () => {
	it("single turn appends exactly one assistant message and nulls assistantId on done", () => {
		const id = "run-1-a0";
		let t = applyChatStreamEvent(baseTransition(), start(id));
		expect(t.assistantId).toBe(id);
		expect(assistantMessages(t)).toHaveLength(1);
		expect(assistantMessages(t)[0].id).toBe(id);
		expect(assistantMessages(t)[0].parts[0]).toEqual({
			type: "text",
			text: "",
		});

		t = applyChatStreamEvent(t, delta(id, "Hello"));
		expect(assistantMessages(t)[0].parts[0]).toEqual({
			type: "text",
			text: "Hello",
		});

		t = applyChatStreamEvent(t, done(id, "Hello world"));
		expect(t.assistantId).toBeNull();
		expect(assistantMessages(t)).toHaveLength(1);
		const parts = assistantMessages(t)[0].parts;
		const text = parts.map((p) => (p.type === "text" ? (p.text as string) : "")).join("");
		expect(text).toBe("Hello world");
	});

	it("two sequential turns with distinct ids produce two assistant messages", () => {
		const s1 = "run-1-a0";
		const s2 = "run-2-a0";
		let t = baseTransition();

		// turn 1
		t = applyChatStreamEvent(t, start(s1, "run-1"));
		t = applyChatStreamEvent(t, delta(s1, "First "));
		t = applyChatStreamEvent(t, done(s1, "First answer", "run-1"));
		expect(t.assistantId).toBeNull();

		// turn 2 with a fresh id
		t = applyChatStreamEvent(t, start(s2, "run-2"));
		t = applyChatStreamEvent(t, delta(s2, "Second "));
		t = applyChatStreamEvent(t, done(s2, "Second answer", "run-2"));
		expect(t.assistantId).toBeNull();

		const assistants = assistantMessages(t);
		expect(assistants).toHaveLength(2);
		expect(assistants[0].id).toBe(s1);
		expect(assistants[1].id).toBe(s2);

		const textOf = (m: ChatMessage) => m.parts.map((p) => (p.type === "text" ? (p.text as string) : "")).join("");
		expect(textOf(assistants[0])).toBe("First answer");
		expect(textOf(assistants[1])).toBe("Second answer");
	});

	it("defensive guard: start with an id equal to an existing assistant message does not duplicate it", () => {
		const id = "run-1-a0";
		let t = baseTransition();
		t = applyChatStreamEvent(t, start(id));
		t = applyChatStreamEvent(t, delta(id, "persisted"));
		t = applyChatStreamEvent(t, done(id, "persisted"));
		expect(t.assistantId).toBeNull();
		const before = assistantMessages(t).length;
		expect(before).toBe(1);

		// A stale/duplicate start whose id collides with the existing assistant message.
		t = applyChatStreamEvent(t, start(id));
		expect(assistantMessages(t)).toHaveLength(before);
		expect(t.assistantId).toBe(id);
	});

	it("delta before any start reconciles a bubble with the delta's messageId", () => {
		const id = "run-1-a0";
		let t = baseTransition();
		expect(t.assistantId).toBeNull();
		t = applyChatStreamEvent(t, delta(id, "orphan"));
		expect(t.assistantId).toBe(id);
		expect(assistantMessages(t)).toHaveLength(1);
		expect(assistantMessages(t)[0].id).toBe(id);
		expect(assistantMessages(t)[0].parts[0]).toEqual({
			type: "text",
			text: "orphan",
		});
	});

	it("accumulates thinking deltas and promotes thinking-only turns to assistant text on done", () => {
		const id = "run-1-a0";
		let t = applyChatStreamEvent(baseTransition(), start(id));
		t = applyChatStreamEvent(t, { type: "thinking", text: "fleet-", messageId: id });
		t = applyChatStreamEvent(t, { type: "thinking", text: "web-ok", messageId: id });
		const streamed = assistantMessages(t)[0];
		const thought = streamed.parts.find((part) => part.type === "tool-Thinking");
		expect(thought && "output" in thought ? thought.output : undefined).toBe("fleet-web-ok");

		t = applyChatStreamEvent(t, {
			type: "done",
			runId: "run-1",
			sessionId: "session-1",
			message: toChatMessage(id, "assistant", [
				{
					type: "tool-Thinking",
					state: "output-available",
					input: { thought: "fleet-web-ok" },
					output: "fleet-web-ok",
				},
			]),
		});
		expect(t.assistantId).toBeNull();
		const doneParts = assistantMessages(t)[0].parts;
		expect(doneParts).toEqual([{ type: "text", text: "fleet-web-ok" }]);
	});

	it("normalizeSessionMetadata drops blank fields so {} is a real clear", () => {
		expect(normalizeSessionMetadata({})).toEqual({});
		expect(normalizeSessionMetadata({ sessionId: "  ", sessionFile: " /tmp/s.jsonl ", cwd: "" })).toEqual({
			sessionFile: "/tmp/s.jsonl",
		});
	});

	it("does not clear live session metadata when done omits sessionId", () => {
		const id = "run-1-a0";
		let t = applyChatStreamEvent(baseTransition(), start(id));
		expect(t.snapshot.sessionMetadata.sessionId).toBe("session-1");
		t = applyChatStreamEvent(t, {
			type: "done",
			runId: "run-1",
			sessionId: "",
			message: toChatMessage(id, "assistant", [{ type: "text", text: "ok" }]),
		});
		expect(t.snapshot.sessionMetadata.sessionId).toBe("session-1");
	});
});
