/**
 * Contract replay: raw daemon frames → stock DaemonAgentConnection → Fleet
 * event mapper → ChatStreamEvent. Any change in how Fleet maps a recorded
 * daemon stream (or in the frozen ChatStreamEvent schema) fails here.
 *
 * The stock adapter is what produced these goldens, but it is not the path
 * Fleet runs after the Rust cutover. `fleet-adapter-contract.test.ts` replays
 * the same fixtures through `FleetDaemonAgentConnection` and requires identical
 * output, so the pinned contract covers production.
 *
 * Regenerate the v0.9.8 set with `pnpm --filter @prime-agent/web-server record:contract-fixtures`
 * (see fixtures/daemon-frames/v0.9.8/README.md).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatStreamEvent, ChatToolPart } from "@prime-agent/web-protocol";
import { ChatStreamEventSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { describe, expect, it } from "vitest";
import {
	DAEMON_FRAMES_ROOT,
	type DaemonFrame,
	inferActiveSessionId,
	listDaemonFrameScenarios,
	PLACEHOLDER_ACTIVE_SESSION_ID,
	readDaemonFrameScenario,
	replayDaemonFrameScenario,
} from "./daemon-frame-replay";

/** Sets whose mapper output is pinned. */
const PINNED_SETS = ["v0.9.8", "rust-v0.10.1"] as const;

/**
 * Scenarios that legitimately map to no ChatStreamEvent: a lone hello, and the
 * Rust top-level frames the mapper consumes silently (session_binding,
 * model_catalog_changed). Everything else must produce output.
 */
const EXPECTED_EMPTY_OUTPUT: Readonly<Record<(typeof PINNED_SETS)[number], ReadonlySet<string>>> = {
	"v0.9.8": new Set(),
	"rust-v0.10.1": new Set(["daemon-hello", "model-catalog-changed", "session-binding"]),
};

const V098_SCENARIOS = [
	"auto-retry",
	"cancel-mid-tool",
	"compaction",
	"extension-ui",
	"ipython-call",
	"normal-turn",
	"queued-steer",
	"subagent-spawn",
	"tool-call",
	"tool-update",
];

function toolParts(events: readonly ChatStreamEvent[], toolCallId: string): ChatToolPart[] {
	return events.flatMap((event) =>
		event.type === "tool" && event.part.toolCallId === toolCallId ? [event.part] : [],
	);
}

function sessionEventTypes(frames: readonly DaemonFrame[]): string[] {
	return frames.flatMap((frame) =>
		frame.type === "session_event" ? [String((frame.event as { type?: unknown }).type)] : [frame.type],
	);
}

describe.each(PINNED_SETS)("daemon-frames/%s contract replay", (set) => {
	const scenarios = listDaemonFrameScenarios(set);

	it.each(scenarios)("%s replays to the recorded ChatStreamEvents", async (name) => {
		const scenario = readDaemonFrameScenario(set, name);
		expect(scenario.expectedEvents, `${name}.events.json is missing`).toBeDefined();
		const { events } = await replayDaemonFrameScenario(scenario);
		expect(events).toEqual(scenario.expectedEvents);
	});

	it.each(scenarios)("%s output parses against the frozen ChatStreamEvent schema", async (name) => {
		const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, name));
		if (EXPECTED_EMPTY_OUTPUT[set].has(name)) expect(events).toEqual([]);
		else expect(events.length).toBeGreaterThan(0);
		for (const [index, event] of events.entries()) {
			const parsed = ChatStreamEventSchema.safeParse(event);
			expect(parsed.success, `${name} event #${index} (${event.type}): ${parsed.error?.message}`).toBe(true);
		}
	});
});

describe("daemon-frame replay harness", () => {
	it("uses a placeholder session for frames that never name one, without throwing", async () => {
		const frames: DaemonFrame[] = [{ type: "daemon_hello", protocol: { name: "prime-agent.daemon", version: 7 } }];
		const activeSessionId = inferActiveSessionId(frames, []);
		expect(activeSessionId).toBe(PLACEHOLDER_ACTIVE_SESSION_ID);
		await expect(replayDaemonFrameScenario({ frames, activeSessionId })).resolves.toEqual({
			connectionEvents: [],
			events: [],
		});
	});
});

describe("daemon-frames/v0.9.8 scenario coverage", () => {
	const set = "v0.9.8";

	it("records every planned scenario", () => {
		expect(listDaemonFrameScenarios(set)).toEqual(V098_SCENARIOS);
	});

	it.each([
		["normal-turn", ["agent_start", "message_update", "agent_end"]],
		["tool-call", ["tool_execution_start", "tool_execution_end"]],
		["ipython-call", ["tool_execution_start", "tool_execution_update", "tool_execution_end"]],
		["cancel-mid-tool", ["tool_execution_start", "tool_execution_end", "agent_end"]],
		["compaction", ["compaction_start", "compaction_end"]],
		["auto-retry", ["auto_retry_start", "auto_retry_end"]],
		["queued-steer", ["session_action_update", "tool_execution_end", "agent_start"]],
		["extension-ui", ["extension_ui_request", "tool_execution_end"]],
		["subagent-spawn", ["rlm_child_update"]],
		["tool-update", ["tool_execution_start", "tool_execution_update", "tool_execution_end"]],
	] as const)("%s frames include %j", (name, types) => {
		const seen = new Set(sessionEventTypes(readDaemonFrameScenario(set, name).frames));
		for (const type of types) expect(seen, `${name} lacks ${type}`).toContain(type);
	});

	it("tool-update: update/end frames keep the tool name of their tool_execution_start (matched by toolCallId)", async () => {
		const scenario = readDaemonFrameScenario(set, "tool-update");
		const { events } = await replayDaemonFrameScenario(scenario);
		const parts = toolParts(events, "call_progress_1");
		expect(parts.length).toBeGreaterThanOrEqual(4);
		expect(new Set(parts.map((part) => part.toolName))).toEqual(new Set(["fleet_progress"]));
		expect(new Set(parts.map((part) => part.type))).toEqual(new Set([parts[0]?.type]));
		expect(parts.at(-1)?.state).toBe("output-available");
		// v0.9.8 still sends toolName on every tool frame; the Rust daemon does not (R1).
		const toolFrames = scenario.frames.filter(
			(frame) =>
				frame.type === "session_event" &&
				String((frame.event as { type?: unknown }).type).startsWith("tool_execution_"),
		);
		for (const frame of toolFrames) {
			expect((frame.event as { toolName?: unknown; toolCallId?: unknown }).toolName).toBe("fleet_progress");
			expect((frame.event as { toolCallId?: unknown }).toolCallId).toBe("call_progress_1");
		}
	});

	it("ipython-call: the kernel tool is surfaced as `ipython` on v0.9.8", async () => {
		const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, "ipython-call"));
		const parts = toolParts(events, "call_ipython_1");
		expect(parts.length).toBeGreaterThan(0);
		expect(new Set(parts.map((part) => part.toolName))).toEqual(new Set(["ipython"]));
		expect(parts.at(-1)?.state).toBe("output-available");
	});

	it("cancel-mid-tool: the aborted cell ends as a tool error and the run settles", async () => {
		const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, "cancel-mid-tool"));
		expect(toolParts(events, "call_sleep_1").at(-1)?.state).toBe("output-error");
		const errorIndex = events.findIndex(
			(event) =>
				event.type === "tool" && event.part.toolCallId === "call_sleep_1" && event.part.state === "output-error",
		);
		expect(events.findIndex((event, index) => index > errorIndex && event.type === "done")).toBeGreaterThan(
			errorIndex,
		);
	});

	it("documents v0.9.8 behavior: ipython setWorkingMessage requests reach the mapper as question tool parts", async () => {
		// PrimeBridge intercepts dialogs, notify and setStatus before the mapper, but not
		// setWorkingMessage, so the mapper turns each one into a `tool-Question` part.
		// Pinned as-is for the baseline; extension_ui_request is gone on the Rust daemon.
		const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, "ipython-call"));
		const workingMessages = events.filter(
			(event) =>
				event.type === "tool" &&
				event.part.category === "question" &&
				(event.part.input as { method?: unknown } | undefined)?.method === "setWorkingMessage",
		);
		expect(workingMessages.length).toBeGreaterThan(0);
	});

	it("extension-ui: the confirm dialog is forwarded as a question tool part", async () => {
		const { events } = await replayDaemonFrameScenario(readDaemonFrameScenario(set, "extension-ui"));
		const questions = events.flatMap((event) =>
			event.type === "tool" && event.part.category === "question" ? [event.part] : [],
		);
		expect(questions).toHaveLength(1);
		expect(questions[0]?.input).toMatchObject({ kind: "extension", method: "confirm" });
	});

	it("never surfaces hidden (display:false) custom messages such as harness_digest", async () => {
		for (const name of listDaemonFrameScenarios(set)) {
			const scenario = readDaemonFrameScenario(set, name);
			// v0.9.8 puts a hidden harness_digest custom message in agent_end.messages.
			const hidden = scenario.frames.flatMap((frame) => {
				const event = frame.event as { type?: unknown; messages?: unknown } | undefined;
				if (frame.type !== "session_event" || event?.type !== "agent_end" || !Array.isArray(event.messages))
					return [];
				return event.messages.filter(
					(message: { role?: unknown; display?: unknown }) =>
						message.role === "custom" && message.display === false,
				) as Array<{ customType?: unknown; content?: unknown }>;
			});
			expect(hidden.length, `${name}: no hidden custom message in agent_end`).toBeGreaterThan(0);
			expect(hidden[0]?.customType).toBe("harness_digest");
			const { events } = await replayDaemonFrameScenario(scenario);
			const output = JSON.stringify(events);
			expect(output, name).not.toContain("harness_digest");
			expect(output, name).not.toContain("[harness-digest]");
			expect(output, name).not.toContain("Continual Harness State");
		}
	});
});

describe("daemon-frames fixtures are scrubbed", () => {
	const FORBIDDEN: Array<[string, RegExp]> = [
		["macOS user path", /\/Users\//],
		["external volume path", /\/Volumes\//],
		["private tmp path", /\/private\/var\//],
		["non-placeholder home", /\/home\/(?!user\b)[A-Za-z0-9._-]+/],
		["OpenAI-style key", /\bsk-[A-Za-z0-9_-]{8,}/],
		["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}/],
		["bearer credential", /Bearer\s+[A-Za-z0-9._-]{12,}/],
		["unredacted token field", /"(token|accessToken|refreshToken|apiKey|grantId)":"(?!<redacted>)[^"]+"/],
	];
	const files = readdirSync(DAEMON_FRAMES_ROOT, { recursive: true, encoding: "utf8" }).filter((file) =>
		/\.jsonl?$/.test(file),
	);

	it("has fixture files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)("%s contains no absolute host paths or secrets", (file) => {
		const text = readFileSync(join(DAEMON_FRAMES_ROOT, file), "utf8");
		for (const [label, pattern] of FORBIDDEN) {
			expect(pattern.test(text), `${file}: ${label} (${pattern})`).toBe(false);
		}
	});
});
