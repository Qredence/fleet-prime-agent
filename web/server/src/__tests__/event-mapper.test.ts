import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ChatStreamEvent } from "@prime-agent/web-protocol";
import type { AgentConnectionEvent, AgentSessionEvent } from "prime-agent";
import { describe, expect, it } from "vitest";
import {
	categorizeTool,
	computeRlmExecutionTree,
	createEventMapperState,
	createFleetErrorEnvelope,
	mapAgentConnectionEvent,
	mapAgentSessionEvent,
	mapAgentSessionEvents,
	toChatMessageFromAssistant,
	toChatMessageFromUnknownRole,
	toChatMessagesFromAgentMessages,
	withOAuthBindingGuidance,
} from "../event-mapper";

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
		expect(retryStart).toContainEqual({
			type: "retry",
			phase: "start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 500,
			errorMessage: "boom",
		});
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

	it("hydrates unknown runtime message types as empty assistant messages", () => {
		// 0.8.0 added transcript message types Fleet does not model (e.g.
		// `refinement_outcome` custom messages). They must hydrate without
		// throwing and without carrying unmodeled content into the browser.
		const hydrated = toChatMessageFromUnknownRole("session-1-m7");
		expect(hydrated).toEqual({ id: "session-1-m7", role: "assistant", parts: [] });
		expect(JSON.stringify(hydrated)).not.toContain("refinement_outcome");
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
});
