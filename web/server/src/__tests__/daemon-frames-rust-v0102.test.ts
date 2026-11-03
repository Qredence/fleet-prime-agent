/**
 * Rust v0.10.2 daemon fixtures (fixtures/daemon-frames/rust-v0.10.2/).
 *
 * A failed tool's `tool_execution_end` carries `isError:true` on the socket, and
 * Fleet maps it to an `output-error` tool part with an error envelope, through
 * both the stock adapter replay and the production `FleetDaemonAgentConnection`.
 */
import type { ChatStreamEvent, ChatToolPart } from "@prime-agent/web-protocol";
import { describe, expect, it } from "vitest";
import { readDaemonFrameScenario, replayDaemonFrameScenario } from "./daemon-frame-replay";
import { replayThroughFleetAdapter } from "./daemon-frame-replay-fleet";

const SET = "rust-v0.10.2";
const CALL_ID = "call-bash-err-1";

function toolParts(events: readonly ChatStreamEvent[]): ChatToolPart[] {
	return events.flatMap((event) => (event.type === "tool" && event.part.toolCallId === CALL_ID ? [event.part] : []));
}

describe(`daemon-frames/${SET}/tool-execution-error`, () => {
	const scenario = readDaemonFrameScenario(SET, "tool-execution-error");

	it("was recorded from a v0.10.2 protocol-7 daemon", () => {
		const hello = scenario.frames.find((frame) => frame.type === "daemon_hello") as
			| {
					appVersion?: unknown;
					runtime?: { buildId?: unknown };
					protocol?: { version?: unknown };
					schemaId?: unknown;
			  }
			| undefined;
		expect(hello?.appVersion).toBe("0.10.2");
		expect(hello?.runtime?.buildId).toBe("pa-daemon-rs-0.10.2");
		expect(hello?.protocol?.version).toBe(7);
		expect(hello?.schemaId).toBe("protocol-7-schema-30-8e4b17c2a9f5");
	});

	it("the tool_execution_end frame carries isError:true", () => {
		const end = scenario.frames
			.map((frame) => frame.event as { type?: unknown; toolCallId?: unknown; isError?: unknown } | undefined)
			.find((event) => event?.type === "tool_execution_end" && event.toolCallId === CALL_ID);
		expect(end?.isError).toBe(true);
	});

	it("maps isError:true to an output-error tool part with the tool's error text", async () => {
		const { events } = await replayDaemonFrameScenario(scenario);
		const last = toolParts(events).at(-1);
		expect(last?.toolName).toBe("bash");
		expect(last?.state).toBe("output-error");
		expect(last?.error).toMatchObject({ message: "cat: missing.txt: No such file or directory" });
	});

	it("FleetDaemonAgentConnection maps the same events", async () => {
		const attach = scenario.frames.find(
			(frame) => frame.type === "response" && frame.command === "attach" && frame.success === true,
		) as { data?: unknown } | undefined;
		expect(attach).toBeDefined();
		const { events } = await replayThroughFleetAdapter({
			frames: scenario.frames,
			activeSessionId: scenario.activeSessionId,
			attachData: attach?.data,
		});
		expect(events).toEqual(scenario.expectedEvents);
		expect(toolParts(events).at(-1)?.state).toBe("output-error");
	});
});
