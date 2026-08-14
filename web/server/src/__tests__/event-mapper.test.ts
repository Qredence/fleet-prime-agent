import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ChatStreamEvent } from "@prime-agent/web-protocol";
import { describe, expect, it } from "vitest";
import { createEventMapperState, mapAgentSessionEvent, mapAgentSessionEvents } from "../event-mapper";

function mkAssistant(partial: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai",
		model: "test-model",
		provider: "openai",
		responseId: "r1",
		timestamp: 0,
		usage: { input: 0, output: 0, totalTokens: 0 },
		stopReason: "stop",
		...partial,
	} as AssistantMessage;
}

describe("event-mapper", () => {
	it("emits agent_start as a state event and starts a new run", () => {
		const state = createEventMapperState();
		const events = mapAgentSessionEvent(state, {
			type: "agent_start",
		} as AgentSessionEvent);
		expect(events).toEqual([{ type: "state", state: { name: "agent_start" } }]);
		expect(state.inRun).toBe(true);
		expect(state.runId).not.toBe("");
	});

	it("emits turn_start/turn_end as state events", () => {
		const state = createEventMapperState();
		expect(mapAgentSessionEvent(state, { type: "turn_start" } as AgentSessionEvent)).toEqual([
			{ type: "state", state: { name: "turn_start" } },
		]);
		expect(
			mapAgentSessionEvent(state, {
				type: "turn_end",
				message: mkAssistant(),
				toolResults: [],
			} as unknown as AgentSessionEvent),
		).toEqual([{ type: "state", state: { name: "turn_end" } }]);
	});

	it("translates text_delta into a delta frame", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "message_update",
			message: mkAssistant(),
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "hello",
				partial: mkAssistant(),
			},
		} as unknown as AgentSessionEvent);
		expect(frames).toEqual([{ type: "delta", text: "hello", messageId: `${state.runId}-a0` }]);
	});

	it("translates thinking_delta into a thinking frame", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "message_update",
			message: mkAssistant(),
			assistantMessageEvent: {
				type: "thinking_delta",
				contentIndex: 0,
				delta: "…",
				partial: mkAssistant(),
			},
		} as unknown as AgentSessionEvent);
		expect(frames).toEqual([{ type: "thinking", text: "…", messageId: `${state.runId}-a0` }]);
	});

	it("translates tool_execution_start into a tool part with PascalCase tool type", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "tool_execution_start",
			toolCallId: "abc",
			toolName: "ipython",
			args: { code: "1+1" },
		} as AgentSessionEvent);
		expect(frames).toHaveLength(1);
		expect(frames[0].type).toBe("tool");
		const part = (frames[0] as { part: { type: string } }).part;
		expect(part.type).toBe("tool-IPython");
	});

	it("translates tool_execution_end with error into output-error state", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "tool_execution_end",
			toolCallId: "abc",
			toolName: "bash",
			result: { exitCode: 1, stderr: "nope" },
			isError: true,
		} as AgentSessionEvent);
		expect(frames[0].type).toBe("tool");
		const part = (frames[0] as { part: { state: string } }).part;
		expect(part.state).toBe("output-error");
	});

	it("translates compaction_start/end into compaction frames", () => {
		const state = createEventMapperState();
		expect(
			mapAgentSessionEvent(state, {
				type: "compaction_start",
				reason: "tokens",
			} as unknown as AgentSessionEvent),
		).toEqual([{ type: "compaction", phase: "start", reason: "tokens" }]);
		expect(
			mapAgentSessionEvent(state, {
				type: "compaction_end",
				reason: "tokens",
				aborted: false,
				willRetry: false,
			} as unknown as AgentSessionEvent),
		).toEqual([
			{
				type: "compaction",
				phase: "end",
				reason: "tokens",
				aborted: false,
				willRetry: false,
			},
		]);
	});

	it("translates auto_retry_start/end into retry frames", () => {
		const state = createEventMapperState();
		expect(
			mapAgentSessionEvent(state, {
				type: "auto_retry_start",
				attempt: 1,
				maxAttempts: 3,
				delayMs: 500,
				errorMessage: "boom",
			} as unknown as AgentSessionEvent),
		).toEqual([
			{
				type: "retry",
				phase: "start",
				attempt: 1,
				maxAttempts: 3,
				delayMs: 500,
				errorMessage: "boom",
			},
		]);
		expect(
			mapAgentSessionEvent(state, {
				type: "auto_retry_end",
				attempt: 1,
				success: true,
			} as unknown as AgentSessionEvent),
		).toEqual([{ type: "retry", phase: "end", attempt: 1, success: true }]);
	});

	it("promotes thinking-only assistant output to text on agent_end", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		mapAgentSessionEvent(state, {
			type: "message_update",
			message: mkAssistant(),
			assistantMessageEvent: {
				type: "thinking_delta",
				contentIndex: 0,
				delta: "fleet-web-ok",
				partial: mkAssistant(),
			},
		} as unknown as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [],
		} as unknown as AgentSessionEvent);
		const done = frames.find((f) => f.type === "done") as Extract<ChatStreamEvent, { type: "done" }>;
		expect(done.message.parts).toEqual([{ type: "text", text: "fleet-web-ok" }]);
	});

	it("stamps agent_end done frames with the mapper session id", () => {
		const state = createEventMapperState({ sessionId: "019ffc49-live" });
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [],
		} as unknown as AgentSessionEvent);
		const done = frames.find((f) => f.type === "done") as Extract<ChatStreamEvent, { type: "done" }>;
		expect(done.sessionId).toBe("019ffc49-live");
	});

	it("emits agent_end with a done frame carrying the finished message", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		mapAgentSessionEvent(state, {
			type: "message_update",
			message: mkAssistant(),
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: "hi",
				partial: mkAssistant(),
			},
		} as unknown as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [],
		} as unknown as AgentSessionEvent);
		const kinds = frames.map((f) => f.type);
		expect(kinds).toContain("state");
		expect(kinds).toContain("done");
		const done = frames.find((f) => f.type === "done") as Extract<ChatStreamEvent, { type: "done" }>;
		expect(done.runId).toBe(state.runId);
		expect(done.message.role).toBe("assistant");
	});

	it("maps session_action_update into a queue frame", () => {
		const state = createEventMapperState();
		const frames = mapAgentSessionEvent(state, {
			type: "session_action_update",
			actions: { steering: ["a"], followUps: ["b"] },
		} as unknown as AgentSessionEvent);
		expect(frames).toEqual([{ type: "queue", steering: ["a"], followUp: ["b"] }]);
	});

	it("supports bulk mapping with shared state", () => {
		const state = createEventMapperState();
		const frames = mapAgentSessionEvents(state, [
			{ type: "agent_start" } as AgentSessionEvent,
			{
				type: "message_update",
				message: mkAssistant(),
				assistantMessageEvent: {
					type: "text_delta",
					contentIndex: 0,
					delta: "hello world",
					partial: mkAssistant(),
				},
			} as unknown as AgentSessionEvent,
			{ type: "agent_end", messages: [] } as unknown as AgentSessionEvent,
		]);
		const kinds = frames.map((f) => f.type);
		expect(kinds[0]).toBe("state");
		expect(kinds).toContain("delta");
		expect(kinds[kinds.length - 1]).toBe("done");
	});
});
