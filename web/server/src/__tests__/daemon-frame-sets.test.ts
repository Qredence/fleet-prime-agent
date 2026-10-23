/**
 * Cross-set event-mapper invariants for every `fixtures/daemon-frames/<set>/`
 * folder (v0.9.8 baseline, v0.10.1 Rust daemon), plus Rust-specific behavior:
 * nameless tool frames, mid-tool attach, python_repl progress, top-level frames
 * and `meta.sequence` gap detection. Pinned per-scenario output (goldens) is
 * checked in daemon-frame-contract.test.ts; regenerate the Rust goldens with
 * `pnpm --filter @prime-agent/web-server replay:contract-events rust-v0.10.1`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ChatStreamEvent, ChatToolPart } from "@prime-agent/web-protocol";
import { ChatStreamEventSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { describe, expect, it } from "vitest";
import { createDaemonSequenceGapTracker, type DaemonSequenceGap } from "../daemon-sequence-gap";
import {
	categorizeTool,
	createEventMapperState,
	type EventMapperState,
	mapAgentConnectionEvent,
	resyncAfterSequenceGap,
	seedToolCallStartsFromMessages,
} from "../event-mapper";
import {
	DAEMON_FRAMES_ROOT,
	type DaemonFrame,
	listDaemonFrameScenarios,
	readDaemonFrameScenario,
	replayDaemonFrameScenario,
} from "./daemon-frame-replay";

const RUST_SET = "rust-v0.10.1";

/** Baseline scenarios with no Rust counterpart: the Rust daemon has no `extension_ui` capability. */
const NO_RUST_SOURCE: Readonly<Record<string, string>> = {
	"extension-ui": "no Rust source: v0.10.1 hello drops the extension_ui server capability",
};

const FRAME_SETS = readdirSync(DAEMON_FRAMES_ROOT)
	.filter((entry) => statSync(join(DAEMON_FRAMES_ROOT, entry)).isDirectory())
	.sort();

const HIDDEN_MARKERS = ["harness_digest", "[harness-digest]", "Continual Harness State"];

/** Last tool part per toolCallId, in first-seen order. */
function finalToolParts(events: readonly ChatStreamEvent[]): ChatToolPart[] {
	const byId = new Map<string, ChatToolPart>();
	for (const event of events) {
		if (event.type === "tool" && typeof event.part.toolCallId === "string")
			byId.set(event.part.toolCallId, event.part);
	}
	return [...byId.values()];
}

function toolParts(events: readonly ChatStreamEvent[], toolCallId?: string): ChatToolPart[] {
	return events.flatMap((event) =>
		event.type === "tool" && (toolCallId === undefined || event.part.toolCallId === toolCallId) ? [event.part] : [],
	);
}

function sessionEvents(frames: readonly DaemonFrame[]): Array<{ type?: unknown; [key: string]: unknown }> {
	return frames.flatMap((frame) =>
		frame.type === "session_event" ? [frame.event as { type?: unknown; [key: string]: unknown }] : [],
	);
}

/** Text of every hidden (`display:false`) custom message the daemon put in agent_end. */
function hiddenAgentEndTexts(frames: readonly DaemonFrame[]): string[] {
	return sessionEvents(frames).flatMap((event) => {
		if (event.type !== "agent_end" || !Array.isArray(event.messages)) return [];
		return (event.messages as Array<{ role?: unknown; display?: unknown; content?: unknown }>)
			.filter((message) => message.role === "custom" && message.display === false)
			.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));
	});
}

it("finds both fixture sets", () => {
	expect(FRAME_SETS).toContain(RUST_SET);
	expect(FRAME_SETS).toContain("v0.9.8");
});

describe.each(FRAME_SETS)("daemon-frames/%s through the event mapper", (set) => {
	const scenarios = listDaemonFrameScenarios(set);

	it.each(scenarios)("%s: every output frame parses against ChatStreamEventSchema", async (name) => {
		const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, name));
		for (const [index, event] of events.entries()) {
			const parsed = ChatStreamEventSchema.safeParse(event);
			expect(parsed.success, `${set}/${name} event #${index} (${event.type}): ${parsed.error?.message}`).toBe(true);
		}
	});

	it.each(scenarios)("%s: tool cards reach a done state with a real tool name", async (name) => {
		const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, name));
		// Question parts are dialogs (extension UI / setWorkingMessage), not tool executions.
		for (const part of finalToolParts(events).filter((entry) => entry.category !== "question")) {
			expect(part.toolName, `${set}/${name} ${part.toolCallId}`).toMatch(/^[A-Za-z][\w.-]*$/);
			expect(part.toolName).not.toBe("unknown_tool");
			expect(part.type).not.toBe("tool-UnknownTool");
			expect(["output-available", "output-error"], `${set}/${name} ${part.toolCallId}`).toContain(part.state);
		}
	});

	it.each(scenarios)("%s: hidden harness_digest text never reaches an outgoing frame", async (name) => {
		const scenario = readDaemonFrameScenario(set, name);
		const { events } = await replayDaemonFrameScenario(scenario);
		const output = JSON.stringify(events);
		for (const marker of HIDDEN_MARKERS) expect(output, `${set}/${name}`).not.toContain(marker);
		for (const text of hiddenAgentEndTexts(scenario.frames)) expect(output, `${set}/${name}`).not.toContain(text);
	});
});

describe(`daemon-frames/${RUST_SET} specifics`, () => {
	const scenarios = listDaemonFrameScenarios(RUST_SET);

	it("the real turn has a hidden harness_digest in agent_end (so the leak check is meaningful)", () => {
		const hidden = hiddenAgentEndTexts(readDaemonFrameScenario(RUST_SET, "real-turn-python-repl").frames);
		expect(hidden.length).toBeGreaterThan(0);
		expect(hidden[0]).toContain("[harness-digest]");
	});

	it("no Rust output contains a question part (no extension UI on v0.10.1)", async () => {
		for (const name of scenarios) {
			const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(RUST_SET, name));
			expect(
				toolParts(events).filter((part) => part.category === "question" || part.type === "tool-Question"),
				name,
			).toEqual([]);
		}
	});

	it.each(["real-turn-python-repl", "tool-execution-nameless"])(
		"%s: nameless update/end frames keep python_repl from the start frame, with its args",
		async (name) => {
			const scenario = readDaemonFrameScenario(RUST_SET, name);
			const nameless = sessionEvents(scenario.frames).filter(
				(event) =>
					(event.type === "tool_execution_update" || event.type === "tool_execution_end") &&
					event.toolName === undefined,
			);
			expect(nameless.length, "fixture should contain nameless tool frames").toBeGreaterThan(0);
			const { events } = await replayDaemonFrameScenario(scenario);
			const parts = toolParts(events);
			expect(parts.length).toBeGreaterThan(0);
			for (const part of parts) {
				expect(part).toMatchObject({ toolName: "python_repl", category: "kernel", type: "tool-IPython" });
				expect((part.input as { code?: unknown } | undefined)?.code, part.toolCallId).toEqual(expect.any(String));
			}
			const finals = finalToolParts(events);
			expect(finals.length).toBeGreaterThanOrEqual(2);
			for (const part of finals) expect(part.state).toBe("output-available");
		},
	);

	it("python_repl tool_execution_update partials render as progress on the kernel card", async () => {
		const scenario = readDaemonFrameScenario(RUST_SET, "tool-execution-nameless");
		const updates = sessionEvents(scenario.frames).filter((event) => event.type === "tool_execution_update");
		expect(updates.length).toBe(3);
		const { events } = await replayDaemonFrameScenario(scenario);
		const firstId = updates[0]?.toolCallId as string;
		const parts = toolParts(events, firstId);
		// start, three progress updates, end
		expect(parts.map((part) => part.state)).toEqual([
			"input-streaming",
			"input-streaming",
			"input-streaming",
			"input-streaming",
			"output-available",
		]);
		const progress = parts.slice(1, 4);
		expect(
			progress.map((part) => (part.result as { content?: Array<{ text?: string }> }).content?.[0]?.text),
		).toEqual(["Starting Python kernel...", "Restoring Python state...", "Preparing Python runtime..."]);
		for (const part of progress) {
			expect(part).toMatchObject({
				type: "tool-IPython",
				category: "kernel",
				toolName: "python_repl",
				result: { details: { status: "starting" } },
			});
		}
	});

	it.each(["tool-execution-nameless-bash-mcp", "scripted-bash-mcp-turn"])(
		"%s: nameless bash and MCP ends keep their start names (mcp__ split into server + tool)",
		async (name) => {
			const scenario = readDaemonFrameScenario(RUST_SET, name);
			const namelessEnds = sessionEvents(scenario.frames).filter(
				(event) => event.type === "tool_execution_end" && event.toolName === undefined,
			);
			expect(namelessEnds.map((event) => event.toolCallId)).toEqual(["call-bash-1", "call-mcp-1"]);
			const { events } = await replayDaemonFrameScenario(scenario);
			for (const part of toolParts(events, "call-bash-1")) {
				expect(part).toMatchObject({
					type: "tool-Bash",
					category: "system",
					toolName: "bash",
					input: { command: "ls" },
				});
			}
			for (const part of toolParts(events, "call-mcp-1")) {
				expect(part).toMatchObject({
					category: "mcp",
					serverName: "github",
					toolName: "list_issues",
					input: { owner: "example", repo: "demo", state: "open" },
				});
			}
			expect(toolParts(events, "call-bash-1").at(-1)?.state).toBe("output-available");
			expect(toolParts(events, "call-mcp-1").at(-1)?.state).toBe("output-available");
		},
	);

	it.each([
		["mcp__github__list_issues", { category: "mcp", serverName: "github", toolName: "list_issues" }],
		["mcp__my_server__do_thing", { category: "mcp", serverName: "my_server", toolName: "do_thing" }],
		["mcp__github_create_issue", { category: "mcp", serverName: "github", toolName: "create_issue" }],
		["python_repl", { category: "kernel", toolName: "python_repl" }],
		["ipython", { category: "kernel", toolName: "ipython" }],
	] as const)("categorizeTool(%s)", (raw, expected) => {
		expect(categorizeTool(raw)).toEqual(expected);
	});

	describe("attach mid-tool (update/end before start)", () => {
		it("the fixture really has no start for the in-flight call, and the snapshot carries its toolCall", () => {
			const scenario = readDaemonFrameScenario(RUST_SET, "attach-mid-tool");
			const events = sessionEvents(scenario.frames);
			expect(
				events.some((event) => event.type === "tool_execution_start" && event.toolCallId === "call-bash-1"),
			).toBe(false);
			expect(events.find((event) => event.type === "tool_execution_end")?.toolCallId).toBe("call-bash-1");
		});

		it("resolves the real name and args via snapshot seeding", async () => {
			let state: EventMapperState | undefined;
			const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(RUST_SET, "attach-mid-tool"), {
				onState: (next) => {
					state = next;
				},
			});
			const bash = toolParts(events, "call-bash-1");
			expect(bash).toHaveLength(1);
			expect(bash[0]).toMatchObject({
				type: "tool-Bash",
				toolName: "bash",
				category: "system",
				state: "output-available",
				input: { command: "ls" },
			});
			expect(toolParts(events, "call-mcp-1").at(-1)).toMatchObject({
				toolName: "list_issues",
				serverName: "github",
			});
			expect(state?.toolCallStarts.size).toBe(0);
		});

		it("without a snapshot the same frames fall back to unknown_tool (last resort only)", () => {
			const scenario = readDaemonFrameScenario(RUST_SET, "attach-mid-tool");
			const end = scenario.frames.find(
				(frame) =>
					frame.type === "session_event" && (frame.event as { type?: unknown }).type === "tool_execution_end",
			);
			const state = createEventMapperState({ sessionId: "s" });
			const [frame] = mapAgentConnectionEvent(state, { type: "session_event", event: end?.event } as never);
			expect(frame).toMatchObject({ type: "tool", part: { toolName: "unknown_tool" } });
		});

		it("createEventMapperState({ initialMessages }) seeds from the last assistant message only; live starts win", () => {
			const messages = [
				{ role: "assistant", content: [{ type: "toolCall", id: "old", name: "read", arguments: {} }] },
				{ role: "user", content: "next" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "working" },
						{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } },
						{ type: "toolCall", id: "c2", name: "mcp__github__list_issues", arguments: { repo: "demo" } },
					],
				},
			];
			const state = createEventMapperState({ sessionId: "s", initialMessages: messages });
			expect([...state.toolCallStarts.keys()]).toEqual(["c1", "c2"]);
			state.toolCallStarts.set("c3", { toolName: "python_repl", args: { code: "1" } });
			expect(
				seedToolCallStartsFromMessages(state, [
					{ role: "assistant", content: [{ type: "toolCall", id: "c3", name: "bash", arguments: {} }] },
				]),
			).toBe(0);
			expect(state.toolCallStarts.get("c3")?.toolName).toBe("python_repl");
		});
	});

	describe("meta.sequence gap detection", () => {
		const withGaps = (frames: readonly DaemonFrame[]) => {
			const gaps: DaemonSequenceGap[] = [];
			const tracker = createDaemonSequenceGapTracker((gap) => gaps.push(gap));
			for (const frame of frames) tracker.observe(frame);
			return gaps;
		};

		/** Excerpts of a longer capture: their sequence jumps are cuts, not drops. */
		const EXCERPT_FIXTURES = new Set(["tool-execution-nameless", "tool-execution-nameless-bash-mcp"]);

		it.each(scenarios.filter((name) => !EXCERPT_FIXTURES.has(name)))("%s: a full live capture has no gap", (name) => {
			expect(withGaps(readDaemonFrameScenario(RUST_SET, name).frames)).toEqual([]);
		});

		it("coalesced delta jumps (landing on message_update) are not gaps", () => {
			const frames = readDaemonFrameScenario(RUST_SET, "real-turn-python-repl").frames;
			const sequences = frames.flatMap((frame) => {
				const sequence = (frame.meta as { sequence?: unknown } | undefined)?.sequence;
				return typeof sequence === "number" ? [sequence] : [];
			});
			expect(sequences.some((sequence, index) => index > 0 && sequence > (sequences[index - 1] ?? 0) + 1)).toBe(
				true,
			);
			expect(withGaps(frames)).toEqual([]);
		});

		it("a dropped session_event inside a turn is reported once with the missing count", () => {
			const frames = readDaemonFrameScenario(RUST_SET, "real-turn-python-repl").frames;
			// Drop the first python_repl progress update (sequence 27).
			const dropped = frames.filter(
				(frame) => !((frame.meta as { sequence?: unknown } | undefined)?.sequence === 27),
			);
			expect(dropped.length).toBe(frames.length - 1);
			expect(withGaps(dropped)).toEqual([
				{
					activeSessionId: "61506e70f987",
					generation: "e11cee063920",
					lastSequence: 26,
					receivedSequence: 28,
					missing: 1,
				},
			]);
		});

		it("events dropped between the attach snapshot and subscription are caught against the snapshot baseline", () => {
			const frames = readDaemonFrameScenario(RUST_SET, "attach-mid-tool").frames;
			// The attach response pins lastEventSequence 7; drop the first live event (8).
			const dropped = frames.filter((frame) => (frame.meta as { sequence?: unknown } | undefined)?.sequence !== 8);
			expect(withGaps(dropped)).toEqual([
				{
					activeSessionId: "b134578a8e2f",
					generation: "e1d418183e22",
					lastSequence: 7,
					receivedSequence: 9,
					missing: 1,
				},
			]);
		});

		it("a new cursor generation or a session_binding re-baselines instead of reporting a gap", () => {
			const tracker = createDaemonSequenceGapTracker();
			const event = (activeSessionId: string, generation: string, sequence: number) => ({
				type: "session_event",
				activeSessionId,
				event: { type: "turn_start" },
				meta: { sequence, cursor: { generation, sequence } },
			});
			expect(tracker.observe(event("a", "g1", 1))).toBeUndefined();
			expect(tracker.observe(event("a", "g2", 40))).toBeUndefined();
			expect(tracker.observe(event("a", "g2", 41))).toBeUndefined();
			expect(tracker.observe(event("a", "g2", 41))).toBeUndefined(); // duplicate
			tracker.observe({ type: "session_binding", previousActiveSessionId: "a", activeSessionId: "b" });
			expect(tracker.position("a")).toBeUndefined();
			expect(tracker.observe(event("b", "g3", 5))).toBeUndefined();
			expect(tracker.observe(event("b", "g3", 8))).toMatchObject({ activeSessionId: "b", missing: 2 });
		});

		it("a gap surfaces through the existing session_resynced path (done + sessionReset, tools re-seeded)", () => {
			const state = createEventMapperState({ sessionId: "s" });
			const frames = resyncAfterSequenceGap(state, {
				state: {} as never,
				messages: [
					{
						role: "assistant",
						content: [{ type: "toolCall", id: "c9", name: "python_repl", arguments: { code: "x" } }],
					},
				] as never,
			});
			expect(frames.at(-1)).toMatchObject({ type: "done", sessionReset: true, sessionId: "s" });
			for (const frame of frames) expect(ChatStreamEventSchema.safeParse(frame).success).toBe(true);
			expect(state.toolCallStarts.get("c9")).toEqual({ toolName: "python_repl", args: { code: "x" } });
		});
	});

	it("real-turn-python-repl: delta-only text (no text_start/text_end) streams into the final message", async () => {
		const scenario = readDaemonFrameScenario(RUST_SET, "real-turn-python-repl");
		const subtypes = sessionEvents(scenario.frames).flatMap((event) =>
			event.type === "message_update"
				? [String((event.assistantMessageEvent as { type?: unknown } | undefined)?.type)]
				: [],
		);
		expect(subtypes).toContain("text_delta");
		expect(subtypes).not.toContain("text_start");
		expect(subtypes).not.toContain("text_end");

		const { events } = await replayDaemonFrameScenario(scenario);
		const deltas = events.flatMap((event) => (event.type === "delta" ? [event] : []));
		expect(deltas).toHaveLength(subtypes.filter((type) => type === "text_delta").length);
		const streamed = deltas.map((event) => event.text).join("");
		expect(streamed).toBe("`ls` showed `README.md`, `hello.py`, and `src`; 6×7 = 42.");
		expect(new Set(deltas.map((event) => event.messageId)).size).toBe(1);
		const done = events.find((event) => event.type === "done");
		expect(done?.type === "done" && JSON.stringify(done.message.parts)).toContain(streamed);
	});

	it("scripted-bash-mcp-turn: a message_update with no assistantMessageEvent is tolerated", async () => {
		const scenario = readDaemonFrameScenario(RUST_SET, "scripted-bash-mcp-turn");
		expect(
			sessionEvents(scenario.frames).some(
				(event) => event.type === "message_update" && event.assistantMessageEvent === undefined,
			),
		).toBe(true);
		const { events } = await replayDaemonFrameScenario(scenario);
		expect(events.some((event) => event.type === "done")).toBe(true);
	});

	it.each(["session-binding", "model-catalog-changed"])(
		"%s: top-level frames are consumed without crashing or emitting frames",
		async (name) => {
			const scenario = readDaemonFrameScenario(RUST_SET, name);
			const { connectionEvents, events } = await replayDaemonFrameScenario(scenario);
			const topLevel = scenario.frames.filter(
				(frame) => frame.type === "session_binding" || frame.type === "model_catalog_changed",
			);
			expect(topLevel.length).toBeGreaterThan(0);
			expect(connectionEvents.filter((event) => event.type === topLevel[0]?.type)).toHaveLength(topLevel.length);
			expect(events).toEqual([]);
		},
	);

	it("session_binding drops cached tool starts from the replaced runtime", () => {
		const state = createEventMapperState({ sessionId: "s" });
		mapAgentConnectionEvent(state, {
			type: "session_event",
			event: { type: "tool_execution_start", toolCallId: "c1", toolName: "python_repl", args: { code: "1" } },
		} as never);
		expect(state.toolCallStarts.size).toBe(1);
		mapAgentConnectionEvent(state, { type: "session_binding", previousActiveSessionId: "a", activeSessionId: "b" });
		expect(state.toolCallStarts.size).toBe(0);
	});

	it("tool_execution_end and agent_end clear the start cache", () => {
		const state = createEventMapperState({ sessionId: "s" });
		const send = (event: unknown) => mapAgentConnectionEvent(state, { type: "session_event", event } as never);
		send({ type: "agent_start" });
		send({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } });
		send({ type: "tool_execution_start", toolCallId: "c2", toolName: "python_repl", args: { code: "1" } });
		const [endFrame] = send({
			type: "tool_execution_end",
			toolCallId: "c1",
			result: { content: [] },
			isError: false,
		});
		expect(endFrame).toMatchObject({
			type: "tool",
			part: { toolName: "bash", category: "system", type: "tool-Bash" },
		});
		expect([...state.toolCallStarts.keys()]).toEqual(["c2"]);
		send({ type: "agent_end", messages: [] });
		expect(state.toolCallStarts.size).toBe(0);
	});

	it("no-Rust-source baseline scenarios are documented", () => {
		const hello = readFileSync(join(DAEMON_FRAMES_ROOT, RUST_SET, "daemon-hello.jsonl"), "utf8");
		expect(JSON.parse(hello).serverCapabilities).not.toContain("extension_ui");
		for (const name of Object.keys(NO_RUST_SOURCE)) {
			expect(listDaemonFrameScenarios("v0.9.8")).toContain(name);
			expect(scenarios).not.toContain(name);
		}
	});
});
