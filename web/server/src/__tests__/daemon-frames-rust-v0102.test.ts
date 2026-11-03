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

	it("the settled done message keeps the failed tool as output-error", async () => {
		const { events } = await replayDaemonFrameScenario(scenario);
		const done = [...events].reverse().find((event) => event.type === "done");
		const part =
			done?.type === "done"
				? done.message.parts.find((entry) => "toolCallId" in entry && entry.toolCallId === CALL_ID)
				: undefined;
		expect((part as ChatToolPart | undefined)?.state).toBe("output-error");
		expect((part as ChatToolPart | undefined)?.error).toMatchObject({
			message: "cat: missing.txt: No such file or directory",
		});
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

/**
 * Live v0.10.2 capture of a `python_repl` cell that raises FileNotFoundError. The daemon sends
 * `isError:false` (its tool bridge drops the tool's own flag) and reports the failure only as
 * `result.details.status: "error"`; Fleet must still show the live part and the settled done
 * part as `output-error`.
 */
describe(`daemon-frames/${SET}/python-cell-raises`, () => {
	const scenario = readDaemonFrameScenario(SET, "python-cell-raises");
	const end = scenario.frames
		.map(
			(frame) =>
				frame.event as
					| {
							type?: unknown;
							toolCallId?: unknown;
							isError?: unknown;
							result?: { details?: { status?: unknown; errorEname?: unknown } };
					  }
					| undefined,
		)
		.find((event) => event?.type === "tool_execution_end");
	const callId = end?.toolCallId as string;

	it("the daemon reports the raised cell only through details.status", () => {
		expect(end?.isError).toBe(false);
		expect(end?.result?.details?.status).toBe("error");
		expect(end?.result?.details?.errorEname).toBe("FileNotFoundError");
	});

	it("maps the live tool part and the settled done part to output-error", async () => {
		const { events } = await replayDaemonFrameScenario(scenario);
		const start = scenario.frames
			.map((frame) => frame.event as { type?: unknown; toolCallId?: unknown; toolName?: unknown } | undefined)
			.find((event) => event?.type === "tool_execution_start" && event.toolCallId === callId);
		expect(start?.toolName).toBe("python_repl");
		const live = events.flatMap((event) =>
			event.type === "tool" && event.part.toolCallId === callId ? [event.part] : [],
		);
		expect(live.at(-1)?.state).toBe("output-error");
		expect(live.at(-1)?.error).toMatchObject({ message: expect.stringContaining("FileNotFoundError") });

		const done = [...events].reverse().find((event) => event.type === "done");
		const part =
			done?.type === "done"
				? (done.message.parts.find((entry) => "toolCallId" in entry && entry.toolCallId === callId) as
						| ChatToolPart
						| undefined)
				: undefined;
		expect(part?.state).toBe("output-error");
		expect(part?.error).toMatchObject({ message: expect.stringContaining("FileNotFoundError") });
	});
});
