/**
 * The frozen contract goldens must hold for the adapter Fleet ships.
 *
 * `daemon-frame-contract.test.ts` pins mapper output for recorded daemon
 * streams, but it replays them through the stock v0.9.8 SDK adapter that the
 * Rust cutover retired. This suite replays the same Rust fixtures through
 * `FleetDaemonAgentConnection` and requires identical `ChatStreamEvent`
 * output, so the pinned contract covers the production path.
 */
import type { ChatStreamEvent } from "@prime-agent/web-protocol";
import { describe, expect, it } from "vitest";
import type { DaemonFrameScenario } from "./daemon-frame-replay";
import { listDaemonFrameScenarios, readDaemonFrameScenario } from "./daemon-frame-replay";
import { replayThroughFleetAdapter } from "./daemon-frame-replay-fleet";

const RUST_SET = "rust-v0.10.1";

/**
 * Scenarios with no `attach` response in the recording. They are frame excerpts
 * (a lone hello, top-level frames, or a mid-stream tool sequence lifted out of a
 * longer capture) rather than attachable sessions, so the adapter has no
 * snapshot to build. Their mapper output is still pinned by the SDK-based
 * replay and by the top-level-frame tests, which do not go through a connection.
 */
const WITHOUT_ATTACH = new Set([
	"daemon-hello",
	"model-catalog-changed",
	"tool-execution-nameless",
	"tool-execution-nameless-bash-mcp",
]);

function attachResponse(scenario: DaemonFrameScenario): unknown {
	return scenario.frames.find(
		(frame) => frame.type === "response" && frame.command === "attach" && frame.success === true,
	);
}

describe("FleetDaemonAgentConnection reproduces the pinned contract", () => {
	for (const name of listDaemonFrameScenarios(RUST_SET)) {
		const scenario = readDaemonFrameScenario(RUST_SET, name);
		const expected = scenario.expectedEvents;
		if (!expected) continue;

		it(`${name} maps the same events as the pinned golden`, async () => {
			const attach = attachResponse(scenario);

			// Without an attach response the adapter cannot build a snapshot; those
			// scenarios are covered by the SDK-based replay and by the top-level
			// frame tests, which do not go through a connection at all.
			if (!attach) {
				expect(WITHOUT_ATTACH.has(name)).toBe(true);
				return;
			}

			const { events } = await replayThroughFleetAdapter({
				frames: scenario.frames,
				activeSessionId: scenario.activeSessionId,
				attachData: (attach as { data?: unknown }).data,
			});

			expect(events).toEqual(expected satisfies ChatStreamEvent[]);
		});
	}
});
