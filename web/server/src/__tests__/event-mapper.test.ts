import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ChatStreamEvent, ChatToolPart, FleetErrorEnvelope } from "@prime-agent/web-protocol";
import type { AgentConnectionEvent, AgentSessionEvent } from "prime-agent";
import { describe, expect, it } from "vitest";
import {
	applyRlmChildStatusOverrides,
	categorizeTool,
	computeRlmExecutionTree,
	createEventMapperState,
	createFleetErrorEnvelope,
	mapAgentConnectionEvent,
	mapAgentSessionEvent,
	mapAgentSessionEvents,
	normalizeDaemonQuestions,
	normalizedQuestionsToClarification,
	normalizedQuestionsToWire,
	toChatMessageFromAssistant,
	toChatMessagesFromAgentMessages,
	withOAuthBindingGuidance,
} from "../event-mapper";

function mkAssistant(partial: Partial<AssistantMessage> & { errorMessage?: string } = {}): AssistantMessage {
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
		expect(events[0]).toEqual({ type: "state", state: { name: "agent_start" } });
		expect(events[1]).toMatchObject({
			type: "reasoning",
			presentation: { phase: "waiting", streaming: true },
		});
		expect(state.inRun).toBe(true);
		expect(state.runId).not.toBe("");
	});

	it("emits turn_start/turn_end as state events", () => {
		const state = createEventMapperState();
		const turnStart = mapAgentSessionEvent(state, { type: "turn_start" } as AgentSessionEvent);
		expect(turnStart[0]).toEqual({ type: "state", state: { name: "turn_start" } });
		expect(turnStart[1]).toMatchObject({ type: "reasoning", presentation: { phase: "context" } });
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
		expect(frames[0]).toMatchObject({ type: "reasoning", presentation: { phase: "responding" } });
		expect(frames[1]).toEqual({ type: "delta", text: "hello", messageId: `${state.runId}-a0` });
	});

	it("suppresses raw thinking while preserving controlled reasoning", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const startFrames = mapAgentSessionEvent(state, {
			type: "message_update",
			message: mkAssistant(),
			assistantMessageEvent: {
				type: "thinking_start",
				contentIndex: 0,
				partial: mkAssistant(),
			},
		} as unknown as AgentSessionEvent);
		expect(startFrames).toHaveLength(1);
		expect(startFrames[0]).toMatchObject({ type: "reasoning", presentation: { phase: "planning" } });

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
		expect(frames).toHaveLength(1);
		expect(frames[0]).toMatchObject({
			type: "reasoning",
			messageId: `${state.runId}-a0`,
			presentation: { phase: "planning", streaming: true },
		});
		expect(JSON.stringify(frames)).not.toContain("…");

		const endFrames = mapAgentSessionEvent(state, {
			type: "message_update",
			message: mkAssistant(),
			assistantMessageEvent: {
				type: "thinking_end",
				contentIndex: 0,
				partial: mkAssistant(),
			},
		} as unknown as AgentSessionEvent);
		expect(endFrames).toEqual([]);
	});

	it("recovers terminal-only assistant text without exposing terminal thinking", () => {
		const state = createEventMapperState();
		const completed = mkAssistant({
			content: [
				{ type: "thinking", thinking: "never-render-this" },
				{ type: "text", text: "Recovered final answer." },
			] as AssistantMessage["content"],
		});
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		mapAgentSessionEvent(state, {
			type: "message_update",
			message: completed,
			assistantMessageEvent: {
				type: "done",
				reason: "stop",
				message: completed,
			},
		} as unknown as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [],
		} as unknown as AgentSessionEvent);
		const done = frames.find((frame) => frame.type === "done") as Extract<ChatStreamEvent, { type: "done" }>;
		expect(done.message.parts).toEqual([{ type: "text", text: "Recovered final answer." }]);
		expect(JSON.stringify(done.message)).not.toContain("never-render-this");
	});

	it("recovers text from an assistant message_end without exposing its thinking", () => {
		const state = createEventMapperState();
		const completed = mkAssistant({
			content: [
				{ type: "thinking", thinking: "still-never-render-this" },
				{ type: "text", text: "Message-end final answer." },
			] as AssistantMessage["content"],
		});
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		mapAgentSessionEvent(state, {
			type: "message_end",
			message: completed,
		} as unknown as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [],
		} as unknown as AgentSessionEvent);
		const done = frames.find((frame) => frame.type === "done") as Extract<ChatStreamEvent, { type: "done" }>;
		expect(done.message.parts).toEqual([{ type: "text", text: "Message-end final answer." }]);
		expect(JSON.stringify(done.message)).not.toContain("still-never-render-this");
	});

	it.each([
		["error", "Assistant error"],
		["aborted", "Operation aborted"],
	] as const)("preserves %s assistant errors in the terminal done message", (stopReason, title) => {
		const state = createEventMapperState();
		const completed = mkAssistant({ stopReason, errorMessage: "The assistant did not finish." });
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		mapAgentSessionEvent(state, {
			type: "message_end",
			message: completed,
		} as unknown as AgentSessionEvent);

		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [],
		} as unknown as AgentSessionEvent);
		const done = frames.find((frame) => frame.type === "done") as Extract<ChatStreamEvent, { type: "done" }>;

		expect(done.message.parts).toEqual([{ type: "error", title, message: "The assistant did not finish." }]);
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
		expect(frames).toHaveLength(2);
		const tool = frames.find((frame) => frame.type === "tool");
		expect(tool?.type).toBe("tool");
		const part = (tool as { part: { type: string } }).part;
		expect(part.type).toBe("tool-IPython");
	});

	it("merges one tool call through start, update, and terminal events", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvents(state, [
			{
				type: "tool_execution_start",
				toolCallId: "ipython-1",
				toolName: "ipython",
				args: { code: "1 + 1" },
			} as AgentSessionEvent,
			{
				type: "tool_execution_update",
				toolCallId: "ipython-1",
				toolName: "ipython",
				args: undefined,
				partialResult: { details: { stdout: "2" } },
			} as unknown as AgentSessionEvent,
			{
				type: "tool_execution_end",
				toolCallId: "ipython-1",
				toolName: "ipython",
				result: { details: { stdout: "2", durationMs: 8 } },
				isError: false,
			} as AgentSessionEvent,
		]);

		const toolFrames = frames.filter((frame) => frame.type === "tool");
		expect(toolFrames).toHaveLength(3);
		expect(state.currentToolParts).toHaveLength(1);
		expect(state.currentToolParts[0]).toMatchObject({
			toolCallId: "ipython-1",
			state: "output-available",
			input: { code: "1 + 1" },
			output: { details: { stdout: "2", durationMs: 8 } },
		});
		expect(state.currentToolParts.some((part) => part.state === "input-streaming")).toBe(false);
	});

	it("preserves backgroundOutput in tool_execution_update, tool_execution_end, and agent message hydration", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvents(state, [
			{
				type: "tool_execution_start",
				toolCallId: "ipython-bg",
				toolName: "ipython",
				args: { code: "import threading" },
			} as AgentSessionEvent,
			{
				type: "tool_execution_update",
				toolCallId: "ipython-bg",
				toolName: "ipython",
				args: undefined,
				partialResult: { details: { stdout: "starting...", backgroundOutput: "Thread started\n" } },
			} as unknown as AgentSessionEvent,
			{
				type: "tool_execution_end",
				toolCallId: "ipython-bg",
				toolName: "ipython",
				result: { details: { stdout: "done", backgroundOutput: "Thread completed\n", durationMs: 42 } },
				isError: false,
			} as AgentSessionEvent,
		]);

		const toolFrames = frames.filter((frame) => frame.type === "tool");
		expect(toolFrames).toHaveLength(3);
		expect(state.currentToolParts[0]).toMatchObject({
			toolCallId: "ipython-bg",
			state: "output-available",
			backgroundOutput: "Thread completed\n",
			durationMs: 42,
		});

		// Also verify hydration from AgentMessage[]
		const hydrated = toChatMessagesFromAgentMessages(
			[
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id: "ipython-bg",
							name: "ipython",
							arguments: { code: "import threading" },
						},
					],
				} as unknown as AgentMessage,
				{
					role: "toolResult",
					toolCallId: "ipython-bg",
					toolName: "ipython",
					details: { stdout: "done", backgroundOutput: "Thread completed\n", durationMs: 42 },
				} as unknown as AgentMessage,
			],
			"session-bg",
		);
		expect(hydrated).toHaveLength(1);
		const hydratedPart = hydrated[0].parts[0] as ChatToolPart;
		expect(hydratedPart.backgroundOutput).toBe("Thread completed\n");
		expect(hydratedPart.durationMs).toBe(42);
	});

	it("keeps concurrent tool calls distinct when their updates interleave", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		mapAgentSessionEvents(state, [
			{
				type: "tool_execution_start",
				toolCallId: "a",
				toolName: "bash",
				args: { command: "pwd" },
			} as AgentSessionEvent,
			{
				type: "tool_execution_start",
				toolCallId: "b",
				toolName: "ipython",
				args: { code: "2 + 2" },
			} as AgentSessionEvent,
			{
				type: "tool_execution_update",
				toolCallId: "a",
				toolName: "bash",
				args: undefined,
				partialResult: { stdout: "/workspace" },
			} as unknown as AgentSessionEvent,
			{
				type: "tool_execution_end",
				toolCallId: "b",
				toolName: "ipython",
				result: { result: 4 },
				isError: false,
			} as AgentSessionEvent,
			{
				type: "tool_execution_end",
				toolCallId: "a",
				toolName: "bash",
				result: { stdout: "/workspace" },
				isError: false,
			} as AgentSessionEvent,
		]);

		expect(state.currentToolParts).toHaveLength(2);
		expect(state.currentToolParts.map((part) => part.toolCallId)).toEqual(["a", "b"]);
		expect(state.currentToolParts.map((part) => part.state)).toEqual(["output-available", "output-available"]);
		expect(state.currentToolParts[0]?.input).toEqual({ command: "pwd" });
		expect(state.currentToolParts[1]?.input).toEqual({ code: "2 + 2" });
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

	it("appends an end-without-start and carries terminal parts into done", () => {
		const state = createEventMapperState();
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		mapAgentSessionEvent(state, {
			type: "tool_execution_end",
			toolCallId: "missing-start",
			toolName: "bash",
			result: { stdout: "done" },
			isError: false,
		} as AgentSessionEvent);

		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [],
		} as unknown as AgentSessionEvent);
		const done = frames.find((frame) => frame.type === "done") as Extract<ChatStreamEvent, { type: "done" }>;
		const toolPart = done.message.parts.find((part) => "toolCallId" in part && part.toolCallId === "missing-start");

		expect(toolPart).toMatchObject({
			state: "output-available",
			output: { stdout: "done" },
		});
		expect(done.message.parts.some((part) => "state" in part && part.state === "input-streaming")).toBe(false);
	});

	it("translates compaction_start/end into compaction frames", () => {
		const state = createEventMapperState();
		const start = mapAgentSessionEvent(state, {
			type: "compaction_start",
			reason: "tokens",
		} as unknown as AgentSessionEvent);
		expect(start).toContainEqual({ type: "compaction", phase: "start", reason: "tokens" });
		expect(start).toContainEqual(expect.objectContaining({ type: "reasoning" }));
		const compactionEnd = mapAgentSessionEvent(state, {
			type: "compaction_end",
			reason: "tokens",
			aborted: false,
			willRetry: false,
		} as unknown as AgentSessionEvent);
		expect(compactionEnd).toContainEqual({
			type: "compaction",
			phase: "end",
			reason: "tokens",
			aborted: false,
			willRetry: false,
		});
		expect(compactionEnd).toContainEqual(
			expect.objectContaining({
				type: "reasoning",
				presentation: expect.objectContaining({ phase: "recovering", streaming: false }),
			}),
		);
	});

	it("translates auto_retry_start/end into retry frames", () => {
		const state = createEventMapperState();
		const retryStart = mapAgentSessionEvent(state, {
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 500,
			errorMessage: "boom",
		} as unknown as AgentSessionEvent);
		expect(retryStart).toContainEqual(
			expect.objectContaining({
				type: "retry",
				phase: "start",
				attempt: 1,
				maxAttempts: 3,
				delayMs: 500,
				errorMessage: "boom",
			}),
		);
		expect(retryStart).toContainEqual(expect.objectContaining({ type: "reasoning" }));
		const retryEnd = mapAgentSessionEvent(state, {
			type: "auto_retry_end",
			attempt: 1,
			success: true,
		} as unknown as AgentSessionEvent);
		expect(retryEnd).toContainEqual({ type: "retry", phase: "end", attempt: 1, success: true });
		expect(retryEnd).toContainEqual(
			expect.objectContaining({
				type: "reasoning",
				presentation: expect.objectContaining({ phase: "recovering", streaming: false }),
			}),
		);
	});

	it("never promotes thinking-only assistant output into the standard transcript", () => {
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
		expect(done.message.parts).toEqual([]);
		expect(JSON.stringify(done.message)).not.toContain("fleet-web-ok");
	});

	it("excludes persisted upstream thinking blocks from cold transcript hydration", () => {
		const hydrated = toChatMessageFromAssistant(
			mkAssistant({
				content: [
					{ type: "thinking", thinking: "never-render-this" },
					{ type: "text", text: "safe answer" },
				] as AssistantMessage["content"],
			}),
			"hydrated-a0",
		);
		expect(hydrated.parts).toEqual([{ type: "text", text: "safe answer" }]);
		expect(JSON.stringify(hydrated)).not.toContain("never-render-this");
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

	it("hydrates TUI-visible runtime message types as browser payload parts", () => {
		const hydrated = toChatMessagesFromAgentMessages(
			[
				{
					role: "bashExecution",
					command: "git status --short",
					output: "clean",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					excludeFromContext: false,
					fullOutputPath: "/private/full-output.txt",
				} as unknown as AgentMessage,
				{
					role: "custom",
					customType: "refinement_outcome",
					display: true,
					content: "Refinement completed",
					details: { summary: "safe", secret: "do-not-send" },
				} as unknown as AgentMessage,
				{
					role: "custom",
					customType: "hidden_internal",
					display: false,
					content: "must stay hidden",
				} as unknown as AgentMessage,
				{
					role: "branchSummary",
					fromId: "branch-1",
					summary: "Branch context",
				} as unknown as AgentMessage,
				{
					role: "compactionSummary",
					summary: "Compacted context",
					tokensBefore: 1200,
					retainedMessageCount: 4,
				} as unknown as AgentMessage,
			],
			"session-1",
		);

		expect(hydrated).toHaveLength(4);
		expect(hydrated[0]?.parts[0]).toMatchObject({ type: "payload", kind: "bashExecution", title: "Bash" });
		expect(hydrated[1]?.parts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "text", text: "Refinement completed" }),
				expect.objectContaining({ type: "payload", kind: "refinement_outcome" }),
			]),
		);
		expect(hydrated[2]?.parts[0]).toMatchObject({ type: "payload", kind: "branchSummary" });
		expect(hydrated[3]?.parts[0]).toMatchObject({ type: "payload", kind: "compactionSummary" });
		expect(JSON.stringify(hydrated)).not.toContain("do-not-send");
		expect(JSON.stringify(hydrated)).not.toContain("full-output.txt");
		expect(JSON.stringify(hydrated)).not.toContain("must stay hidden");
	});

	it("emits every visible runtime payload before the terminal done frame", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "agent_end",
			messages: [
				{
					role: "custom",
					customType: "first",
					display: true,
					content: "first payload",
				} as unknown as AgentMessage,
				{
					role: "custom",
					customType: "second",
					display: true,
					content: "second payload",
				} as unknown as AgentMessage,
			],
		} as unknown as AgentSessionEvent);

		const payloads = frames.filter(
			(frame): frame is Extract<ChatStreamEvent, { type: "payload" }> => frame.type === "payload",
		);
		expect(payloads).toHaveLength(2);
		expect(payloads.map((frame) => frame.part.kind)).toEqual(["first", "second"]);
		expect(new Set(payloads.map((frame) => frame.part.id)).size).toBe(2);
		expect(frames.at(-1)?.type).toBe("done");
	});

	it("keeps late IPython agent messages attached to the tool payload", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "ipython_sent_agent_message",
			toolCallId: "ipython-1",
			message: {
				id: "sent-1",
				message: "child result",
				deliveryStatus: "delivered",
				target: { activeSessionId: "active-1", sessionId: "session-1" },
			},
		} as unknown as AgentSessionEvent);

		const tool = frames.find((frame): frame is Extract<ChatStreamEvent, { type: "tool" }> => frame.type === "tool");
		expect(tool?.part.result).toMatchObject({
			details: { sentAgentMessages: [{ id: "sent-1", message: "child result" }] },
		});
	});

	it("rewrites the 0.8.0 MCP OAuth binding error into re-login guidance", () => {
		const guided = withOAuthBindingGuidance(
			"Stored OAuth credentials are not bound to https://mcp.example.com; re-run /mcp login slack",
		);
		expect(guided).toContain('"slack"');
		expect(guided).toContain("/mcp login slack");
		expect(guided).not.toContain("not bound to");

		const passthrough = withOAuthBindingGuidance("boom");
		expect(passthrough).toBe("boom");
	});

	it("applies OAuth binding guidance to retry error surfaces", () => {
		const state = createEventMapperState();
		const frames = mapAgentSessionEvent(state, {
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 500,
			errorMessage: "Stored OAuth credentials are not bound to https://mcp.example.com; re-run /mcp login slack",
		} as unknown as AgentSessionEvent);
		const retry = frames.find(
			(frame): frame is Extract<ChatStreamEvent, { type: "retry"; phase: "start" }> =>
				frame.type === "retry" && frame.phase === "start",
		);
		expect(retry?.errorMessage).toContain("must be signed in again");
	});

	it("maps the missing session presentation events into revisioned safe snapshots", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		const frames = mapAgentSessionEvents(state, [
			{ type: "session_info_changed", name: "Renamed session" },
			{ type: "thinking_level_changed", level: "high" },
			{ type: "service_tier_changed", serviceTier: "flex" },
			{
				type: "rlm_child_update",
				child: {
					id: "child-1",
					label: "Research child",
					status: "running",
					sessionDir: "/private/child-session",
					activity: { kind: "executing", toolName: "search" },
				},
			},
			{ type: "recap_update", recap: "Child completed the repository scan." },
			{
				type: "goal_update",
				goal: {
					active: true,
					status: "active",
					goalId: "goal-1",
					objective: "Ship the browser path",
					tokensUsed: 3,
					timeUsedSeconds: 2,
					continuationsUsed: 0,
				},
			},
			{ type: "refine_failed", error: "No safe edit was available" },
		] as unknown as AgentSessionEvent[]);

		const presentation = frames.filter(
			(frame): frame is Extract<ChatStreamEvent, { type: "presentation" }> => frame.type === "presentation",
		);
		expect(presentation.map((frame) => frame.presentation.revision)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(state.presentation.sessionName).toBe("Renamed session");
		expect(state.presentation.thinkingLevel).toBe("high");
		expect(state.presentation.serviceTier).toBe("flex");
		expect(state.presentation.rlmChildren[0]).toMatchObject({ id: "child-1", status: "running" });
		expect(state.presentation.goal?.objective).toBe("Ship the browser path");
		expect(state.presentation.refinements[0]).toMatchObject({ status: "error", error: "No safe edit was available" });
		expect(JSON.stringify(state.presentation)).not.toContain("sessionDir");
		expect(JSON.stringify(state.presentation)).not.toContain("/private/child-session");
	});

	it("applies authoritative daemon child status and heartbeat overrides to the tree and artifact", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		mapAgentSessionEvent(state, {
			type: "rlm_child_update",
			child: {
				id: "child-1",
				label: "Research worker",
				status: "running",
			},
		} as unknown as AgentSessionEvent);

		const failedFrames = applyRlmChildStatusOverrides(
			state,
			new Map([["child-1", { status: "failed", lastHeardFrom: 1710000000000 }]]),
		);
		const failedPresentation = failedFrames[0];
		if (failedPresentation?.type !== "presentation") throw new Error("missing failed presentation");
		expect(failedPresentation.presentation.rlmChildren[0]).toMatchObject({
			status: "failed",
			lastHeardFrom: 1710000000000,
		});
		expect(failedPresentation.presentation.artifactRuns[0]?.artifacts[0]).toMatchObject({
			status: "error",
			output: expect.objectContaining({ status: "failed" }),
		});

		const recoveringFrames = applyRlmChildStatusOverrides(
			state,
			new Map([["child-1", { status: "recovering", lastHeardFrom: 1710000001000 }]]),
		);
		const recoveringPresentation = recoveringFrames[0];
		if (recoveringPresentation?.type !== "presentation") throw new Error("missing recovering presentation");
		expect(recoveringPresentation.presentation.rlmChildren[0]).toMatchObject({
			status: "recovering",
			lastHeardFrom: 1710000001000,
		});
		expect(recoveringPresentation.presentation.artifactRuns[0]?.artifacts[0]).toMatchObject({
			status: "running",
			output: expect.objectContaining({ status: "recovering" }),
		});
	});

	it("sanitizes refinement edits while preserving diff content for artifact rendering", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		mapAgentSessionEvent(state, {
			type: "refine_complete",
			result: {
				id: "refine-1",
				summary: "Improve the prompt",
				rationale: "The run showed a repeatable gap.",
				expectedOutcome: "The next run is more reliable.",
				appliedEdits: [
					{
						action: "update",
						kind: "prompt",
						id: "prompt-1",
						title: "Prompt note",
						before: {
							path: "/private/harness/prompt-1",
							content: "old guidance",
							reference: { secret: "do-not-send" },
						},
						after: {
							path: "/private/harness/prompt-1",
							content: "new guidance",
						},
						metadata: { secret: "do-not-send" },
						applied: true,
					},
				],
				harnessStatePath: "/private/harness/state.json",
			},
		} as unknown as AgentSessionEvent);

		const edit = state.presentation.refinements[0]?.edits[0];
		expect(edit).toMatchObject({ before: "old guidance", after: "new guidance" });
		expect(edit).not.toHaveProperty("reference");
		expect(edit).not.toHaveProperty("metadata");
		expect(JSON.stringify(state.presentation)).not.toContain("/private/harness");
		expect(JSON.stringify(state.presentation)).not.toContain("do-not-send");
		expect(state.presentation.artifactRuns[0]?.artifacts[0]?.output).toMatchObject({
			edits: [{ before: "old guidance", after: "new guidance" }],
		});
	});

	it("joins user Bash chunks into one stable completed artifact", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		mapAgentSessionEvent(state, {
			type: "bash_start",
			command: "git status",
			excludeFromContext: true,
			runId: "bash-1",
		} as unknown as AgentSessionEvent);
		mapAgentSessionEvent(state, { type: "bash_output", chunk: "clean\n" } as unknown as AgentSessionEvent);
		const end = mapAgentSessionEvent(state, {
			type: "bash_end",
			exitCode: 0,
			cancelled: false,
			truncated: false,
			runId: "bash-1",
		} as unknown as AgentSessionEvent);

		const entry = state.presentation.userBash[0];
		expect(entry).toMatchObject({ runId: "bash-1", output: "clean\n", status: "success", excludeFromContext: true });
		expect(state.presentation.artifactRuns.flatMap((run) => run.artifacts)).toEqual([
			expect.objectContaining({
				runId: "bash-1",
				kind: "bash",
				status: "success",
				output: expect.objectContaining({ stdout: "clean\n" }),
			}),
		]);
		expect(end).toHaveLength(1);
	});

	it("keeps streamed Bash presentation output within the runtime preview limits", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		mapAgentSessionEvent(state, {
			type: "bash_start",
			command: "generate logs",
			excludeFromContext: true,
			runId: "bash-large",
		} as unknown as AgentSessionEvent);

		mapAgentSessionEvent(state, {
			type: "bash_output",
			chunk: Array.from({ length: 2_500 }, (_, index) => `line-${index}`).join("\n"),
		} as unknown as AgentSessionEvent);
		const lineBoundOutput = state.presentation.userBash[0]?.output ?? "";
		expect(lineBoundOutput.split("\n")).toHaveLength(2_000);
		expect(lineBoundOutput).not.toContain("line-0");
		expect(lineBoundOutput).toContain("line-2499");

		mapAgentSessionEvent(state, {
			type: "bash_output",
			chunk: "x".repeat(60 * 1024),
		} as unknown as AgentSessionEvent);
		const byteBoundOutput = state.presentation.userBash[0]?.output ?? "";
		expect(Buffer.byteLength(byteBoundOutput, "utf8")).toBeLessThanOrEqual(50 * 1024);
	});

	it("hydrates images and joins persisted tool results to their call", () => {
		const assistant = mkAssistant({
			content: [
				{ type: "toolCall", id: "tool-1", name: "bash", arguments: { command: "pwd" } },
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			] as AssistantMessage["content"],
		});
		const hydrated = toChatMessagesFromAgentMessages(
			[
				assistant as unknown as AgentMessage,
				{
					role: "toolResult",
					toolCallId: "tool-1",
					toolName: "bash",
					content: [{ type: "text", text: "clean" }],
					isError: false,
				} as unknown as AgentMessage,
			],
			"session-1",
		);
		const parts = hydrated[0]?.parts ?? [];
		expect(parts).toContainEqual(expect.objectContaining({ type: "image", url: "data:image/png;base64,aW1hZ2U=" }));
		expect(parts).toContainEqual(
			expect.objectContaining({
				toolCallId: "tool-1",
				state: "output-available",
				output: expect.objectContaining({ content: [{ type: "text", text: "clean" }] }),
			}),
		);
	});

	it("emits image-bearing user messages on the live stream", () => {
		const state = createEventMapperState({ sessionId: "session-1" });
		mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
		const frames = mapAgentSessionEvent(state, {
			type: "message_start",
			message: {
				role: "user",
				content: [
					{ type: "text", text: "Inspect this" },
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
				],
			},
		} as unknown as AgentSessionEvent);
		const message = frames.find(
			(frame): frame is Extract<ChatStreamEvent, { type: "message" }> => frame.type === "message",
		);
		expect(message?.message.parts).toContainEqual(expect.objectContaining({ type: "image", mimeType: "image/png" }));
	});

	describe("Phase 1: Normalized Tool Categories & Actionable Errors", () => {
		it("categorizes kernel, system, mcp, question, and plan tools correctly", () => {
			expect(categorizeTool("ipython")).toEqual({ category: "kernel", toolName: "ipython" });
			expect(categorizeTool("jupyter")).toEqual({ category: "kernel", toolName: "ipython" });
			expect(categorizeTool("bash")).toEqual({ category: "system", toolName: "bash" });
			expect(categorizeTool("edit_file")).toEqual({ category: "system", toolName: "edit_file" });
			expect(categorizeTool("read_file")).toEqual({ category: "system", toolName: "read_file" });
			expect(categorizeTool("ask_question")).toEqual({ category: "question", toolName: "ask_question" });
			expect(categorizeTool("plan_write")).toEqual({ category: "plan", toolName: "plan_write" });
			expect(categorizeTool("mcp__github_create_issue")).toEqual({
				category: "mcp",
				toolName: "create_issue",
				serverName: "github",
			});
			expect(categorizeTool("unknown_custom")).toEqual({ category: "custom", toolName: "unknown_custom" });
		});

		it("creates actionable remediation hints for known error categories", () => {
			const authErr = createFleetErrorEnvelope("Token expired for provider");
			expect(authErr.code).toBe("AUTH_CREDENTIAL_EXPIRED");
			expect(authErr.remediation?.action).toBe("open_settings_tab");

			const rateErr = createFleetErrorEnvelope("Rate limit exceeded (429)");
			expect(rateErr.code).toBe("RATE_LIMIT");
			expect(rateErr.remediation?.action).toBe("retry_turn");

			const contextErr = createFleetErrorEnvelope("Maximum context length overflow");
			expect(contextErr.code).toBe("CONTEXT_OVERFLOW");
			expect(contextErr.remediation?.action).toBe("compact_context");

			const kernelErr = createFleetErrorEnvelope("Jupyter kernel died unexpectedly");
			expect(kernelErr.code).toBe("KERNEL_CRASH");
			expect(kernelErr.remediation?.action).toBe("restart_kernel");
		});

		it("emits normalized category, toolName, and serverName on tool execution events", () => {
			const state = createEventMapperState();
			mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
			const frames = mapAgentSessionEvent(state, {
				type: "tool_execution_start",
				toolCallId: "call-1",
				toolName: "mcp__github_search",
				args: { query: "fleet" },
			} as AgentSessionEvent);

			const toolFrame = frames.find((f) => f.type === "tool");
			expect(toolFrame).toBeDefined();
			expect((toolFrame as any).part).toMatchObject({
				type: "tool-MCPGithubSearch",
				category: "mcp",
				toolName: "search",
				serverName: "github",
				toolCallId: "call-1",
				state: "input-streaming",
			});
		});

		it("maps extension_error and closed errors to structured FleetErrorEnvelopes", () => {
			const state = createEventMapperState({ sessionId: "test-session" });
			const extFrames = mapAgentConnectionEvent(state, {
				type: "extension_error",
				extensionPath: "/plugins/my-ext.js",
				event: "onTurn",
				error: "Module failed to load",
			} as AgentConnectionEvent);

			expect(extFrames).toHaveLength(1);
			expect(extFrames[0]).toMatchObject({
				type: "error",
				code: "EXTENSION_ERROR",
				error: {
					code: "EXTENSION_ERROR",
					message: "Extension error in /plugins/my-ext.js: Module failed to load",
				},
			});
		});
	});

	describe("Phase 2: Hierarchical RLM Tree & Subagent State", () => {
		it("computes recursive tree hierarchy, depths, and child mappings correctly", () => {
			const children = [
				{
					id: "sub-1",
					parentId: "root-session",
					label: "Researcher",
					status: "done" as const,
					timestamp: 1000,
				},
				{
					id: "sub-2",
					parentId: "sub-1",
					label: "Nested Planner",
					status: "running" as const,
					timestamp: 2000,
				},
				{
					id: "sub-3",
					parentId: "sub-1",
					label: "Nested Verifier",
					status: "queued" as const,
					timestamp: 2500,
				},
				{
					id: "sub-4",
					parentId: "sub-2",
					label: "Deep Coder",
					status: "running" as const,
					timestamp: 3000,
				},
				{
					id: "sub-5",
					parentId: "root-session",
					label: "Independent Subagent",
					status: "done" as const,
					timestamp: 3500,
				},
			];

			const tree = computeRlmExecutionTree("root-session", children, "sub-4");

			expect(tree.rootSessionId).toBe("root-session");
			expect(tree.activeNodeId).toBe("sub-4");
			expect(tree.rootChildrenIds).toEqual(["sub-1", "sub-5"]);

			// Level 1 depths
			expect(tree.nodes["sub-1"].depth).toBe(1);
			expect(tree.nodes["sub-1"].childrenIds).toEqual(["sub-2", "sub-3"]);
			expect(tree.nodes["sub-5"].depth).toBe(1);
			expect(tree.nodes["sub-5"].childrenIds).toEqual([]);

			// Level 2 depths
			expect(tree.nodes["sub-2"].depth).toBe(2);
			expect(tree.nodes["sub-2"].childrenIds).toEqual(["sub-4"]);
			expect(tree.nodes["sub-3"].depth).toBe(2);
			expect(tree.nodes["sub-3"].childrenIds).toEqual([]);

			// Level 3 depth
			expect(tree.nodes["sub-4"].depth).toBe(3);
			expect(tree.nodes["sub-4"].childrenIds).toEqual([]);
		});

		it("emits discrete rlm stream event alongside presentation on rlm_child_update", () => {
			const state = createEventMapperState({ sessionId: "root-session" });

			const frames1 = mapAgentSessionEvent(state, {
				type: "rlm_child_update",
				child: {
					id: "child-a",
					label: "Worker A",
					status: "running",
					sessionDir: "/hidden/path",
				},
			} as unknown as AgentSessionEvent);

			expect(frames1).toHaveLength(2);
			expect(frames1[0].type).toBe("presentation");
			expect(frames1[1].type).toBe("rlm");

			const rlmEvent1 = frames1[1] as Extract<ChatStreamEvent, { type: "rlm" }>;
			expect(rlmEvent1.child).toMatchObject({
				id: "child-a",
				label: "Worker A",
				status: "running",
				depth: 1,
			});
			expect(rlmEvent1.tree?.rootChildrenIds).toEqual(["child-a"]);

			// Nested child update
			const frames2 = mapAgentSessionEvent(state, {
				type: "rlm_child_update",
				child: {
					id: "child-b",
					parentId: "child-a",
					label: "Worker B (nested under A)",
					status: "running",
					sessionDir: "/hidden/path/b",
				},
			} as unknown as AgentSessionEvent);

			const rlmEvent2 = frames2[1] as Extract<ChatStreamEvent, { type: "rlm" }>;
			expect(rlmEvent2.child).toMatchObject({
				id: "child-b",
				parentId: "child-a",
				depth: 2,
			});
			expect(rlmEvent2.tree?.nodes["child-a"].childrenIds).toEqual(["child-b"]);
			expect(state.presentation.rlmTree?.nodes["child-b"].depth).toBe(2);
		});

		it("maps recovering and failed lifecycle statuses and lastHeardFrom on rlm_child_update", () => {
			const state = createEventMapperState({ sessionId: "root-session" });

			const frames1 = mapAgentSessionEvent(state, {
				type: "rlm_child_update",
				child: {
					id: "worker-rec",
					label: "Worker Recovering",
					status: "recovering",
					lastHeardFrom: 1710000000000,
				},
			} as unknown as AgentSessionEvent);

			const rlmEvent1 = frames1.find((frame) => frame.type === "rlm") as Extract<ChatStreamEvent, { type: "rlm" }>;
			expect(rlmEvent1.child).toMatchObject({
				id: "worker-rec",
				label: "Worker Recovering",
				status: "recovering",
				lastHeardFrom: 1710000000000,
			});

			const frames2 = mapAgentSessionEvent(state, {
				type: "rlm_child_update",
				child: {
					id: "worker-rec",
					label: "Worker Recovering",
					status: "failed",
					error: "Worker socket disconnected unexpectedly",
				},
			} as unknown as AgentSessionEvent);

			const rlmEvent2 = frames2.find((frame) => frame.type === "rlm") as Extract<ChatStreamEvent, { type: "rlm" }>;
			expect(rlmEvent2.child).toMatchObject({
				id: "worker-rec",
				status: "failed",
				error: "Worker socket disconnected unexpectedly",
			});
		});

		it("resyncs parent session metadata and computes RLM tree on session_resynced", () => {
			const state = createEventMapperState({ sessionId: "child-session" });

			const frames = mapAgentConnectionEvent(state, {
				type: "session_resynced",
				snapshot: {
					parent: {
						activeSessionId: "parent-active-1",
						sessionId: "parent-session-1",
						nodeId: "node-1",
						childId: "child-session",
					},
					children: [
						{
							id: "sub-child-1",
							parentId: "child-session",
							label: "Sub worker",
							status: "done",
							sessionDir: "/tmp/sub",
						},
					],
				},
			} as unknown as AgentConnectionEvent);

			expect(frames.length).toBeGreaterThanOrEqual(3);
			const presFrame = frames.find(
				(f): f is Extract<ChatStreamEvent, { type: "presentation" }> => f.type === "presentation",
			);
			expect(presFrame).toBeDefined();
			expect(presFrame?.presentation.parent).toMatchObject({
				activeSessionId: "parent-active-1",
				sessionId: "parent-session-1",
				childId: "child-session",
			});
			expect(presFrame?.presentation.rlmChildren).toHaveLength(1);
			expect(presFrame?.presentation.rlmTree?.nodes["sub-child-1"]).toMatchObject({
				id: "sub-child-1",
				depth: 1,
			});
		});
	});

	describe("Phase 3: Interactive Clarification Questions & Extension Dialog Protocol", () => {
		it("maps extension_ui_request with structured questions array to tool-Question part", () => {
			const state = createEventMapperState({ sessionId: "test-session" });

			const questions = [
				{
					id: "opt-1",
					question: "Which database do you prefer?",
					options: ["PostgreSQL", "SQLite"],
					isMultiSelect: false,
				},
				{
					id: "opt-2",
					question: "Include documentation?",
					options: ["Yes", "No"],
					isMultiSelect: false,
				},
			];

			const frames = mapAgentConnectionEvent(state, {
				type: "extension_ui_request",
				request: {
					id: "dialog-req-1",
					method: "questions",
					payload: {
						title: "Architecture Choices",
						message: "Please choose from the options below:",
						questions,
						options: ["PostgreSQL", "SQLite"],
						placeholder: "Type custom option...",
					},
				},
			} as unknown as AgentConnectionEvent);

			expect(frames).toHaveLength(1);
			expect(frames[0].type).toBe("tool");

			const toolFrame = frames[0] as Extract<ChatStreamEvent, { type: "tool" }>;
			expect(toolFrame.part.type).toBe("tool-Question");
			expect(toolFrame.part.category).toBe("question");
			expect(toolFrame.part.toolName).toBe("ask_question");
			expect(toolFrame.part.toolCallId).toBe("dialog-req-1");
			expect(toolFrame.part.state).toBe("input-streaming");
			expect(toolFrame.part.input).toMatchObject({
				kind: "extension",
				method: "questions",
				title: "Architecture Choices",
				message: "Please choose from the options below:",
				questions: [
					{
						id: "opt-1",
						question: "Which database do you prefer?",
						prompt: "Which database do you prefer?",
						title: "Which database do you prefer?",
						kind: "single",
						options: [
							{ value: "PostgreSQL", label: "PostgreSQL" },
							{ value: "SQLite", label: "SQLite" },
						],
					},
					{
						id: "opt-2",
						question: "Include documentation?",
						prompt: "Include documentation?",
						title: "Include documentation?",
						kind: "single",
						options: [
							{ value: "Yes", label: "Yes" },
							{ value: "No", label: "No" },
						],
					},
				],
				options: ["PostgreSQL", "SQLite"],
				placeholder: "Type custom option...",
			});
		});
	});

	describe("normalizeDaemonQuestions helpers", () => {
		it("normalizes camelCase and snake_case daemon shapes with fallback ids", () => {
			const raw = [
				{
					prompt: "Pick a color",
					options: ["red", { id: "g-1", label: "Green", description: "A calm color" }, { value: "blue" }],
					is_multi_select: true,
					allow_write_in: true,
					defaultOption: "red",
				},
				{ title: "Your name?" },
				{},
			];

			const normalized = normalizeDaemonQuestions(raw);
			expect(normalized).toEqual([
				{
					id: "question-1",
					question: "Pick a color",
					options: [
						{ value: "red", label: "red" },
						{ value: "g-1", label: "Green", description: "A calm color" },
						{ value: "blue", label: "blue" },
					],
					isMultiSelect: true,
					defaultOption: "red",
					allowWriteIn: true,
				},
				{
					id: "question-2",
					question: "Your name?",
					options: [],
					isMultiSelect: false,
					allowWriteIn: false,
				},
				{
					id: "question-3",
					question: "",
					options: [],
					isMultiSelect: false,
					allowWriteIn: false,
				},
			]);
		});

		it("returns undefined for non-array or empty input", () => {
			expect(normalizeDaemonQuestions(undefined)).toBeUndefined();
			expect(normalizeDaemonQuestions("nope")).toBeUndefined();
			expect(normalizeDaemonQuestions({})).toBeUndefined();
			expect(normalizeDaemonQuestions([])).toBeUndefined();
		});

		it("projects normalized questions to the clarification registry shape", () => {
			const normalized = normalizeDaemonQuestions([
				{
					id: "q-1",
					question: "Choose a plan",
					options: ["A", "B"],
					isMultiSelect: true,
					allowOther: true,
					defaultOption: "A",
				},
				{ question: "Any notes?" },
			]);

			expect(normalizedQuestionsToClarification(normalized)).toEqual([
				{
					id: "q-1",
					question: "Choose a plan",
					options: ["A", "B"],
					isMultiSelect: true,
					defaultOption: "A",
					allowWriteIn: true,
				},
				{ id: "question-2", question: "Any notes?" },
			]);
			expect(normalizedQuestionsToClarification(undefined)).toBeUndefined();
		});

		it("projects normalized questions to the browser wire shape", () => {
			const normalized = normalizeDaemonQuestions([
				{ question: "Multi?", options: ["x", "y"], isMultiSelect: true },
				{ question: "Single?", options: ["a"] },
				{ question: "Open text?", allowCustom: true },
			]);

			expect(normalizedQuestionsToWire(normalized)).toEqual([
				{
					id: "question-1",
					question: "Multi?",
					prompt: "Multi?",
					title: "Multi?",
					kind: "multi",
					options: [
						{ value: "x", label: "x" },
						{ value: "y", label: "y" },
					],
				},
				{
					id: "question-2",
					question: "Single?",
					prompt: "Single?",
					title: "Single?",
					kind: "single",
					options: [{ value: "a", label: "a" }],
				},
				{
					id: "question-3",
					question: "Open text?",
					prompt: "Open text?",
					title: "Open text?",
					kind: "text",
					allowOther: true,
					allowCustom: true,
				},
			]);
			expect(normalizedQuestionsToWire(undefined)).toBeUndefined();
			expect(normalizedQuestionsToWire([])).toBeUndefined();
		});
	});

	describe("extractToolErrorText content extraction", () => {
		it("extracts error text from content blocks in a live tool_execution_end", () => {
			const state = createEventMapperState();
			mapAgentSessionEvent(state, { type: "agent_start" } as AgentSessionEvent);
			const frames = mapAgentSessionEvent(state, {
				type: "tool_execution_end",
				toolCallId: "content-err",
				toolName: "bash",
				result: { content: [{ type: "text", text: "boom" }] },
				isError: true,
			} as AgentSessionEvent);

			expect(frames[0].type).toBe("tool");
			const part = (frames[0] as { part: { state: string; error?: { message: string } } }).part;
			expect(part.state).toBe("output-error");
			expect(part.error?.message).toContain("boom");
		});

		it("extracts error text from content blocks during hydration", () => {
			const hydrated = toChatMessagesFromAgentMessages(
				[
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "call-err", name: "bash", arguments: { command: "false" } }],
					} as unknown as AgentMessage,
					{
						role: "toolResult",
						toolCallId: "call-err",
						toolName: "bash",
						isError: true,
						content: [{ type: "text", text: "fatal: nothing to commit" }],
					} as unknown as AgentMessage,
				],
				"session-err",
			);

			const toolPart = hydrated[0].parts.find((part) => part.type.startsWith("tool-")) as
				| (ChatToolPart & { error?: FleetErrorEnvelope })
				| undefined;
			expect(toolPart?.state).toBe("output-error");
			expect(toolPart?.error?.message).toContain("fatal: nothing to commit");
		});
	});

	describe("Phase 4: Streaming Compaction, Auto-Retry Envelopes & Presentation Sync", () => {
		it("maps compaction_start and compaction_end with result metrics and artifact emission", () => {
			const state = createEventMapperState({ sessionId: "session-compact" });

			const startFrames = mapAgentSessionEvent(state, {
				type: "compaction_start",
				reason: "threshold",
			} as unknown as AgentSessionEvent);

			expect(startFrames).toHaveLength(2);
			expect(startFrames[1]).toEqual({
				type: "compaction",
				phase: "start",
				reason: "threshold",
			});

			const endFrames = mapAgentSessionEvent(state, {
				type: "compaction_end",
				reason: "threshold",
				aborted: false,
				willRetry: false,
				result: {
					summary: "Compacted 15 turns of conversation context.",
					tokensBefore: 120000,
					firstKeptEntryId: "entry-16",
				},
			} as unknown as AgentSessionEvent);

			expect(endFrames).toHaveLength(3);
			const presFrame = endFrames.find((f) => f.type === "presentation") as Extract<
				ChatStreamEvent,
				{ type: "presentation" }
			>;
			expect(presFrame).toBeDefined();
			expect(presFrame.presentation.artifactRuns).toHaveLength(1);
			expect(presFrame.presentation.artifactRuns[0].artifacts[0]).toMatchObject({
				kind: "compaction",
				status: "success",
				title: "Compacted (threshold)",
				output: {
					reason: "threshold",
					summary: "Compacted 15 turns of conversation context.",
					tokensBefore: 120000,
					firstKeptEntryId: "entry-16",
				},
			});

			const compactFrame = endFrames.find(
				(f) => f.type === "compaction" && (f as { phase?: string }).phase === "end",
			) as Extract<ChatStreamEvent, { type: "compaction"; phase: "end" }>;
			expect(compactFrame).toMatchObject({
				type: "compaction",
				phase: "end",
				reason: "threshold",
				aborted: false,
				willRetry: false,
				summary: "Compacted 15 turns of conversation context.",
				tokensBefore: 120000,
				firstKeptEntryId: "entry-16",
			});
		});

		it("maps auto_retry_start and auto_retry_end with structured error envelopes", () => {
			const state = createEventMapperState({ sessionId: "session-retry" });

			const startFrames = mapAgentSessionEvent(state, {
				type: "auto_retry_start",
				attempt: 1,
				maxAttempts: 3,
				delayMs: 2000,
				errorMessage: "Rate limit reached (429)",
			} as unknown as AgentSessionEvent);

			expect(startFrames).toHaveLength(2);
			const retryStart = startFrames[1] as Extract<ChatStreamEvent, { type: "retry"; phase: "start" }>;
			expect(retryStart).toMatchObject({
				type: "retry",
				phase: "start",
				attempt: 1,
				maxAttempts: 3,
				delayMs: 2000,
				errorMessage: "Rate limit reached (429)",
				error: {
					code: "RATE_LIMIT",
					remediation: {
						action: "retry_turn",
					},
				},
			});

			const endFrames = mapAgentSessionEvent(state, {
				type: "auto_retry_end",
				success: false,
				attempt: 3,
				finalError: "Context length overflow",
			} as unknown as AgentSessionEvent);

			expect(endFrames).toHaveLength(2);
			const retryEnd = endFrames[1] as Extract<ChatStreamEvent, { type: "retry"; phase: "end" }>;
			expect(retryEnd).toMatchObject({
				type: "retry",
				phase: "end",
				success: false,
				attempt: 3,
				finalError: "Context length overflow",
				error: {
					code: "CONTEXT_OVERFLOW",
					remediation: {
						action: "compact_context",
					},
				},
			});
		});

		it("maps auth_stale event to error frame with re-auth remediation", () => {
			const state = createEventMapperState({ sessionId: "session-auth" });

			const frames = mapAgentSessionEvent(state, {
				type: "auth_stale",
				provider: "anthropic",
			} as unknown as AgentSessionEvent);

			expect(frames).toHaveLength(2);
			const errorFrame = frames[1] as Extract<ChatStreamEvent, { type: "error" }>;
			expect(errorFrame.type).toBe("error");
			expect(errorFrame.message).toBe("Authentication for anthropic is stale. Sign in again to continue.");
			expect(errorFrame.error).toMatchObject({
				code: "AUTH_CREDENTIAL_EXPIRED",
				isTerminal: true,
				remediation: {
					action: "open_settings_tab",
				},
			});
		});

		it("maps goal_update and recap_update presentation changes", () => {
			const state = createEventMapperState({ sessionId: "session-goals" });

			const goalFrames = mapAgentSessionEvent(state, {
				type: "goal_update",
				goal: {
					active: true,
					status: "active",
					objective: "Deploy fleet stack",
					tokensUsed: 4500,
					timeUsedSeconds: 30,
					continuationsUsed: 1,
				},
			} as unknown as AgentSessionEvent);

			expect(goalFrames).toHaveLength(1);
			const goalPres = goalFrames[0] as Extract<ChatStreamEvent, { type: "presentation" }>;
			expect(goalPres.presentation.goal).toMatchObject({
				active: true,
				status: "active",
				objective: "Deploy fleet stack",
				tokensUsed: 4500,
			});

			const recapFrames = mapAgentSessionEvent(state, {
				type: "recap_update",
				recap: "Completed database setup and schema migrations.",
			} as unknown as AgentSessionEvent);

			expect(recapFrames).toHaveLength(1);
			const recapPres = recapFrames[0] as Extract<ChatStreamEvent, { type: "presentation" }>;
			expect(recapPres.presentation.recap).toBe("Completed database setup and schema migrations.");
			expect(recapPres.presentation.artifactRuns[0].artifacts[0]).toMatchObject({
				kind: "recap",
				status: "success",
				output: {
					text: "Completed database setup and schema migrations.",
				},
			});
		});

		it("attaches durationMs and structured error envelopes during tool streaming and hydration", () => {
			const state = createEventMapperState({ sessionId: "test-session-5" });

			// Tool execution start
			const startFrames = mapAgentSessionEvent(state, {
				type: "tool_execution_start",
				toolName: "bash",
				toolCallId: "call-1",
				args: { command: "pytest -v" },
			} as unknown as AgentSessionEvent);

			expect(startFrames).toHaveLength(2);
			const startTool = startFrames[1] as Extract<ChatStreamEvent, { type: "tool" }>;
			expect(startTool.part).toMatchObject({
				type: "tool-Bash",
				category: "system",
				toolName: "bash",
				toolCallId: "call-1",
				state: "input-streaming",
			});

			// Tool execution update
			const updateFrames = mapAgentSessionEvent(state, {
				type: "tool_execution_update",
				toolName: "bash",
				toolCallId: "call-1",
				args: { command: "pytest -v" },
				partialResult: { stdout: "running tests...\n" },
			} as unknown as AgentSessionEvent);

			expect(updateFrames).toHaveLength(1);
			const updateTool = updateFrames[0] as Extract<ChatStreamEvent, { type: "tool" }>;
			expect(updateTool.part.result).toEqual({ stdout: "running tests...\n" });

			// Tool execution end with failure and duration
			const endFrames = mapAgentSessionEvent(state, {
				type: "tool_execution_end",
				toolName: "bash",
				toolCallId: "call-1",
				isError: true,
				result: {
					stderr: "Command timeout after 30000ms",
					durationMs: 30042,
				},
			} as unknown as AgentSessionEvent);

			expect(endFrames).toHaveLength(1);
			const endTool = endFrames[0] as Extract<ChatStreamEvent, { type: "tool" }>;
			expect(endTool.part).toMatchObject({
				type: "tool-Bash",
				state: "output-error",
				durationMs: 30042,
				error: {
					code: "TOOL_TIMEOUT",
					message: "Command timeout after 30000ms",
				},
			});

			// Hydration from agent messages preserves durationMs and error envelope
			const hydrated = toChatMessagesFromAgentMessages(
				[
					{
						role: "assistant",
						content: [
							{
								type: "toolCall",
								id: "call-1",
								name: "bash",
								arguments: { command: "pytest -v" },
							},
						],
					} as unknown as AgentMessage,
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "bash",
						isError: true,
						content: [{ type: "text", text: "Command timeout after 30000ms" }],
						details: { durationMs: 30042, stderr: "Command timeout after 30000ms" },
					} as unknown as AgentMessage,
				],
				"test-session-5",
			);

			expect(hydrated).toHaveLength(1);
			const toolPart = hydrated[0].parts[0] as ChatToolPart;
			expect(toolPart).toMatchObject({
				type: "tool-Bash",
				toolCallId: "call-1",
				state: "output-error",
				durationMs: 30042,
				error: {
					code: "TOOL_TIMEOUT",
					message: "Command timeout after 30000ms",
				},
			});
		});
	});
});
