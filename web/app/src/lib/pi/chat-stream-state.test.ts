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
		adapterCapabilities: {
			protocolVersion: 1,
			schemaRevision: 1,
			features: ["reasoning-summary-v1"],
		},
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

	it("accepts only newer session presentation revisions", () => {
		const first = {
			type: "presentation" as const,
			sessionId: "session-1",
			presentation: { revision: 1, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] },
		};
		const second = {
			type: "presentation" as const,
			sessionId: "session-1",
			presentation: {
				revision: 2,
				sessionName: "Current session",
				userBash: [],
				rlmChildren: [],
				refinements: [],
				artifactRuns: [],
			},
		};
		let t = applyChatStreamEvent(baseTransition(), first);
		t = applyChatStreamEvent(t, second);
		const current = t;

		expect(current.snapshot.presentation?.sessionName).toBe("Current session");
		expect(applyChatStreamEvent(current, first)).toBe(current);
	});

	it("stores only capability-gated safe reasoning and removes legacy raw thinking on completion", () => {
		const id = "run-1-a0";
		let t = applyChatStreamEvent(baseTransition(), start(id));
		t = applyChatStreamEvent(t, {
			type: "reasoning",
			messageId: id,
			presentation: {
				runId: "run-1",
				phase: "planning",
				steps: [{ id: "step-1", title: "Planning next step", body: "Choosing the next safe action." }],
				visibleSteps: 1,
				streaming: true,
				startedAt: 0,
				restingLabel: "Prepared next step",
			},
		});
		t = applyChatStreamEvent(t, { type: "thinking", text: "fleet-web-ok", messageId: id });
		const streamed = assistantMessages(t)[0];
		expect(streamed.parts.some((part) => part.type === "tool-FleetReasoning")).toBe(true);
		expect(JSON.stringify(streamed.parts)).not.toContain("fleet-web-ok");

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
		expect(doneParts.some((part) => part.type === "tool-FleetReasoning")).toBe(true);
		expect(JSON.stringify(doneParts)).not.toContain("fleet-web-ok");
	});

	it("ignores a reasoning presentation when an older adapter omits the capability", () => {
		const id = "run-legacy-a0";
		let t = applyChatStreamEvent(baseTransition(), {
			type: "start",
			id,
			runId: "run-legacy",
			sessionId: "session-1",
		});
		t = applyChatStreamEvent(t, {
			type: "reasoning",
			messageId: id,
			presentation: {
				runId: "run-legacy",
				phase: "planning",
				steps: [{ id: "step-1", title: "Planning next step", body: "Choosing the next safe action." }],
				visibleSteps: 1,
				streaming: true,
				startedAt: 0,
				restingLabel: "Prepared next step",
			},
		});
		expect(assistantMessages(t)[0]?.parts.some((part) => part.type === "tool-FleetReasoning")).toBe(false);
	});

	it("keeps terminal tool parts when done reconciles the streamed assistant bubble", () => {
		const id = "run-1-a0";
		let t = applyChatStreamEvent(baseTransition(), start(id));
		t = applyChatStreamEvent(t, {
			type: "tool",
			messageId: id,
			part: {
				type: "tool-IPython",
				toolCallId: "python-1",
				state: "input-streaming",
				input: { code: "1 + 1" },
			},
		});
		t = applyChatStreamEvent(t, {
			type: "tool",
			messageId: id,
			part: {
				type: "tool-IPython",
				toolCallId: "python-1",
				state: "input-streaming",
				result: { details: { stdout: "2" } },
			},
		});
		t = applyChatStreamEvent(t, {
			type: "done",
			runId: "run-1",
			sessionId: "session-1",
			message: toChatMessage(id, "assistant", [
				{
					type: "tool-IPython",
					toolCallId: "python-1",
					state: "output-available",
					input: { code: "1 + 1" },
					output: { details: { stdout: "2" } },
				},
			]),
		});

		const toolPart = assistantMessages(t)[0].parts.find(
			(part) => "toolCallId" in part && part.toolCallId === "python-1",
		);
		expect(toolPart).toMatchObject({
			state: "output-available",
			output: { details: { stdout: "2" } },
		});
		expect(assistantMessages(t)[0].parts.some((part) => "state" in part && part.state === "input-streaming")).toBe(
			false,
		);
	});

	it("normalizeSessionMetadata drops blank fields so {} is a real clear", () => {
		expect(normalizeSessionMetadata({})).toEqual({});
		expect(normalizeSessionMetadata({ sessionId: "  " })).toEqual({});
		expect(normalizeSessionMetadata({ sessionId: " session-1 " })).toEqual({ sessionId: "session-1" });
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
