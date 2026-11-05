/**
 * Replay fixtures through the connection Fleet actually runs.
 *
 * `daemon-frame-replay.ts` feeds recorded frames through the stock v0.9.8 SDK
 * `DaemonAgentConnection`, which was the production path before the Rust
 * cutover and is now retired. The frozen goldens still describe what a recorded
 * daemon stream must map to, so this harness replays the same frames through
 * `FleetDaemonAgentConnection` over a `DaemonSocketClient` double and asserts
 * the mapper output is identical. A divergence means the adapter Fleet ships
 * does not reproduce the contract the fixtures pin.
 */
import type { ChatStreamEvent } from "@prime-agent/web-protocol";
import { createDaemonSequenceGapTracker } from "../daemon-sequence-gap";
import type { DaemonSocketClient } from "../daemon-socket-client";
import {
	createEventMapperState,
	type EventMapperState,
	mapAgentConnectionEvent,
	seedToolCallStartsFromMessages,
} from "../event-mapper";
import { FleetDaemonAgentConnection } from "../fleet-daemon-connection";

type Frame = Record<string, unknown>;

/**
 * The subset of `DaemonSocketClient` the adapter drives.
 *
 * `FleetDaemonAgentConnection` uses exactly these members, so a double over them
 * exercises the adapter's real frame handling without a live daemon.
 */
function createReplayClient(scenario: { frames: Frame[]; attachData: unknown }) {
	const frameListeners = new Set<(frame: unknown) => void>();
	const closeListeners = new Set<(error: Error) => void>();
	const delivered: Frame[] = [];
	let cursor = 0;

	const deliverFrame = (frame: Frame) => {
		for (const listener of [...frameListeners]) listener(frame);
	};

	const client = {
		hello: undefined,
		isConnected: true,
		supportsServerCapability: () => false,
		onFrame(listener: (frame: unknown) => void) {
			frameListeners.add(listener);
			return () => {
				frameListeners.delete(listener);
			};
		},
		onClose(listener: (error: Error) => void) {
			closeListeners.add(listener);
			return () => {
				closeListeners.delete(listener);
			};
		},
		async request(command: { type: string }) {
			if (command.type === "attach") {
				// A real daemon answers `attach` and then streams the snapshot frames.
				// The adapter subscribes its buffer before requesting, so deliver every
				// recorded snapshot frame once this response has settled. They are
				// consumed from the fixture regardless of position, because the stream
				// scanner stops at the first non-snapshot frame (a pre-attach `kill` or
				// `create` response in several recordings) and those frames are the
				// driver loop's to deliver.
				void (async () => {
					await Promise.resolve();
					await Promise.resolve();
					const remaining: Frame[] = [];
					while (cursor < scenario.frames.length) {
						const frame = scenario.frames[cursor++];
						if (!frame) break;
						if (typeof frame.type === "string" && frame.type.startsWith("session_snapshot_")) {
							delivered.push(frame);
							deliverFrame(frame);
							continue;
						}
						remaining.push(frame);
					}
					// Put the non-snapshot frames back for the driver loop, in order.
					scenario.frames.splice(0, scenario.frames.length, ...remaining);
					cursor = 0;
				})();
				return { type: "response", id: "replay", command: "attach", success: true, data: scenario.attachData };
			}
			return { type: "response", id: "replay", command: command.type, success: true, data: {} };
		},
		async reconnect() {},
		close() {},
	};

	return {
		client: client as unknown as DaemonSocketClient,
		/** Feed every frame after the attach response, which `request` already served. */
		frames: scenario.frames,
		nextFrame(): Frame | undefined {
			while (cursor < scenario.frames.length) {
				const frame = scenario.frames[cursor++];
				if (frame?.type === "daemon_hello") continue;
				if (frame?.type === "response" && frame.command === "attach") continue;
				delivered.push(frame);
				return frame;
			}
			return undefined;
		},
		async deliver(frame: Frame) {
			for (const listener of [...frameListeners]) listener(frame);
			// The adapter's per-frame work is async (snapshot application, emit).
			await new Promise<void>((resolve) => setImmediate(resolve));
		},
		delivered,
		closeListeners,
	};
}

/** Same env var `daemon-runtime.ts` pins; value matches the fixtures' scrubbed agent dir. */
const REPLAY_AGENT_DIR_ENV = "PRIME_AGENT_CODING_AGENT_DIR";
const REPLAY_AGENT_DIR = "/home/user/.prime/agent";

/** Frozen clock used while mapping, so run ids and timestamps match the goldens. */
const REPLAY_FIXED_NOW = 1_767_225_600_000;
const REPLAY_FIXED_RANDOM = 0.5;

function withFrozenClock<T>(fn: () => T): T {
	const realNow = Date.now;
	const realRandom = Math.random;
	Date.now = () => REPLAY_FIXED_NOW;
	Math.random = () => REPLAY_FIXED_RANDOM;
	try {
		return fn();
	} finally {
		Date.now = realNow;
		Math.random = realRandom;
	}
}

/**
 * Replay one scenario through the production adapter.
 *
 * Returns the mapped events in stream order. Frames the adapter ignores (other
 * sessions, responses) yield no events, exactly as in the SDK-based harness.
 */
export async function replayThroughFleetAdapter(scenario: {
	frames: Frame[];
	activeSessionId: string;
	attachData: unknown;
}): Promise<{ events: ChatStreamEvent[]; states: EventMapperState }> {
	const state = createEventMapperState({ sessionId: scenario.activeSessionId });
	// The runtime omits `toolName` and `args` on tool update/end frames, so the
	// mapper resolves them from the snapshot's toolCall blocks. The bridge seeds
	// those from the attach snapshot; do the same here.
	const snapshotMessages = (scenario.attachData as { snapshot?: { messages?: unknown } } | undefined)?.snapshot
		?.messages;
	if (Array.isArray(snapshotMessages)) seedToolCallStartsFromMessages(state, snapshotMessages);
	// The adapter observes raw frames before attach, so the gap tracker it owns
	// sees the same stream the SDK adapter did.
	createDaemonSequenceGapTracker();
	const replay = createReplayClient(scenario);
	// The adapter embeds the agent log path in close errors; pin it to the
	// scrubbed placeholder so output matches the goldens on any host.
	const previousAgentDir = process.env[REPLAY_AGENT_DIR_ENV];
	process.env[REPLAY_AGENT_DIR_ENV] = REPLAY_AGENT_DIR;
	const connection = await FleetDaemonAgentConnection.attach(replay.client, scenario.activeSessionId);
	const events: ChatStreamEvent[] = [];
	const pending: unknown[] = [];
	const unsubscribe = connection.subscribe((event) => {
		pending.push(event);
	});
	try {
		for (;;) {
			const frame = replay.nextFrame();
			if (!frame) break;
			await replay.deliver(frame);
			for (const event of pending.splice(0)) {
				events.push(...withFrozenClock(() => mapAgentConnectionEvent(state, event as never)));
			}
		}
	} finally {
		unsubscribe();
		await connection.dispose();
		if (previousAgentDir === undefined) delete process.env[REPLAY_AGENT_DIR_ENV];
		else process.env[REPLAY_AGENT_DIR_ENV] = previousAgentDir;
	}
	return { events: JSON.parse(JSON.stringify(events)) as ChatStreamEvent[], states: state };
}
