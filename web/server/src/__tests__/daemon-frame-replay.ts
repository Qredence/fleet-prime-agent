/**
 * Generic daemon-frame replay harness for `fixtures/daemon-frames/<set>/`.
 *
 * A set is a flat directory of `<scenario>.jsonl` files: raw daemon → client
 * frames, one JSON frame per line, exactly as read off the socket (scrubbed).
 * Optional siblings per scenario:
 *   - `<scenario>.commands.jsonl`  client command envelopes that produced them
 *   - `<scenario>.events.json`     expected Fleet `ChatStreamEvent[]` output
 *
 * Replay feeds every frame through the stock `DaemonAgentConnection` adapter
 * (the class daemon-runtime.ts attaches) over an offline transport, then maps
 * the resulting connection events with Fleet's real event mapper under a
 * frozen clock and RNG. The same code produces committed `events.json`
 * (scripts/record-contract-fixtures.ts), so expected output is never edited
 * by hand.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatStreamEvent } from "@prime-agent/web-protocol";
import { DaemonAgentConnection } from "prime-agent";
import {
	isDaemonHeartbeatsChangedFrame,
	isDaemonModelCatalogChangedFrame,
	isDaemonSessionBindingFrame,
} from "../daemon-protocol";
import {
	createEventMapperState,
	type EventMapperState,
	type MapperInputEvent,
	mapAgentConnectionEvent,
	seedToolCallStartsFromMessages,
} from "../event-mapper";

export const DAEMON_FRAMES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "daemon-frames");

/** Frozen clock used while mapping, so run ids and timestamps are stable. */
export const CONTRACT_FIXED_NOW = 1_767_225_600_000;
const CONTRACT_FIXED_RANDOM = 0.5;

export type DaemonFrame = { type: string } & Record<string, unknown>;

export type DaemonFrameScenario = {
	set: string;
	name: string;
	frames: DaemonFrame[];
	commands: DaemonFrame[];
	/** Undefined when the set does not (yet) pin mapper output for this scenario. */
	expectedEvents: ChatStreamEvent[] | undefined;
	activeSessionId: string;
};

export function parseJsonl(text: string): DaemonFrame[] {
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as DaemonFrame);
}

/** Session id used for scenarios whose frames never name a session (e.g. a lone hello). */
export const PLACEHOLDER_ACTIVE_SESSION_ID = "replay-session";

/** The session the client attached to: last `attach` command, else the first frame naming one, else a placeholder. */
export function inferActiveSessionId(frames: readonly DaemonFrame[], commands: readonly DaemonFrame[]): string {
	for (const envelope of [...commands].reverse()) {
		// Supervisor commands are wrapped in an envelope; direct-worker commands are bare.
		const command = (envelope.command ?? envelope) as { type?: unknown; activeSessionId?: unknown };
		if (command.type === "attach" && typeof command.activeSessionId === "string") return command.activeSessionId;
	}
	const named = frames.find((frame) => typeof frame.activeSessionId === "string");
	return typeof named?.activeSessionId === "string" ? named.activeSessionId : PLACEHOLDER_ACTIVE_SESSION_ID;
}

export function listDaemonFrameScenarios(set: string): string[] {
	return readdirSync(join(DAEMON_FRAMES_ROOT, set))
		.filter((file) => file.endsWith(".jsonl") && !file.endsWith(".commands.jsonl"))
		.map((file) => file.slice(0, -".jsonl".length))
		.sort();
}

export function readDaemonFrameScenario(set: string, name: string): DaemonFrameScenario {
	const directory = join(DAEMON_FRAMES_ROOT, set);
	const frames = parseJsonl(readFileSync(join(directory, `${name}.jsonl`), "utf8"));
	const commandsPath = join(directory, `${name}.commands.jsonl`);
	const commands = existsSync(commandsPath) ? parseJsonl(readFileSync(commandsPath, "utf8")) : [];
	const eventsPath = join(directory, `${name}.events.json`);
	const expectedEvents = existsSync(eventsPath)
		? (JSON.parse(readFileSync(eventsPath, "utf8")) as ChatStreamEvent[])
		: undefined;
	return { set, name, frames, commands, expectedEvents, activeSessionId: inferActiveSessionId(frames, commands) };
}

type DaemonTransportClient = ConstructorParameters<typeof DaemonAgentConnection>[0];
type MessageListener = Parameters<DaemonTransportClient["onMessage"]>[0];

/** Offline transport: frames are pushed in by the harness; commands succeed without effect. */
class ReplayTransport implements DaemonTransportClient {
	readonly hello = undefined;
	readonly isConnected = true;
	private readonly listeners = new Set<MessageListener>();

	supportsServerCapability(): boolean {
		return true;
	}
	waitForHello(): never {
		throw new Error("replay transport has no daemon hello");
	}
	async connect(): Promise<void> {}
	async reconnect(): Promise<void> {}
	disconnectForReconnect(): void {}
	resetTransportForReconnect(): void {}
	onMessage(listener: MessageListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	onClose(): () => void {
		return () => undefined;
	}
	enableRequestRecovery(): void {}
	async request(command: { type: string }) {
		return { type: "response", id: "replay", command: command.type, success: true, data: {} } as never;
	}
	close(): void {}

	deliver(frame: DaemonFrame): void {
		for (const listener of [...this.listeners]) listener(frame as never);
	}
}

/** Let the adapter's async per-frame handling (and its emit awaits) settle. */
async function drain(): Promise<void> {
	for (let index = 0; index < 5; index++) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}

/**
 * Snapshot transcripts the bridge would hand the mapper at attach time
 * (`createEventMapperState({ initialMessages })`): an `attach` response's
 * `snapshot.messages` or chunked `session_snapshot_chunk.messages` for the
 * replayed session. Seeding them in stream order mirrors that.
 */
function snapshotMessages(frame: DaemonFrame, activeSessionId: string): unknown[] | undefined {
	if (frame.type === "response" && frame.command === "attach" && frame.success === true) {
		const data = frame.data as { activeSessionId?: unknown; snapshot?: { messages?: unknown } } | undefined;
		if (data?.activeSessionId === activeSessionId && Array.isArray(data.snapshot?.messages))
			return data.snapshot.messages;
	}
	if (frame.type === "session_snapshot_chunk" && frame.activeSessionId === activeSessionId)
		return Array.isArray(frame.messages) ? frame.messages : undefined;
	return undefined;
}

/**
 * Rust-only top-level frames (no `meta`) the stock v0.9.8 adapter drops. In
 * production daemon-runtime receives them on the client's raw frame channel;
 * here they go to the mapper directly, in stream order.
 */
function topLevelMapperFrame(frame: DaemonFrame): MapperInputEvent | undefined {
	return isDaemonSessionBindingFrame(frame) ||
		isDaemonModelCatalogChangedFrame(frame) ||
		isDaemonHeartbeatsChangedFrame(frame)
		? (structuredClone(frame) as MapperInputEvent)
		: undefined;
}

/** Same env var daemon-runtime.ts pins (`AGENT_DIR_ENV`); value matches the fixtures' scrubbed agent dir. */
const REPLAY_AGENT_DIR_ENV = "PRIME_AGENT_CODING_AGENT_DIR";
const REPLAY_AGENT_DIR = "/home/user/.prime/agent";

function withFrozenClock<T>(fn: () => T): T {
	const realNow = Date.now;
	const realRandom = Math.random;
	Date.now = () => CONTRACT_FIXED_NOW;
	Math.random = () => CONTRACT_FIXED_RANDOM;
	try {
		return fn();
	} finally {
		Date.now = realNow;
		Math.random = realRandom;
	}
}

/**
 * Replay one scenario in stream order: each top-level frame is delivered to the stock
 * adapter, the adapter settles, and whatever connection events it emitted are mapped by
 * Fleet's event mapper (frozen clock and RNG) before the next frame is delivered.
 * Frames the adapter ignores (other sessions, responses, hellos) yield no events.
 */
export async function replayDaemonFrameScenario(
	scenario: Pick<DaemonFrameScenario, "frames" | "activeSessionId">,
	options: { onState?: (state: EventMapperState) => void } = {},
): Promise<{ connectionEvents: MapperInputEvent[]; events: ChatStreamEvent[] }> {
	// The stock adapter embeds the agent log path in close errors; pin it to the
	// scrubbed placeholder so goldens never carry a host home directory.
	const previousAgentDir = process.env[REPLAY_AGENT_DIR_ENV];
	process.env[REPLAY_AGENT_DIR_ENV] = REPLAY_AGENT_DIR;
	const transport = new ReplayTransport();
	const connection = new DaemonAgentConnection(transport, scenario.activeSessionId, { supportsExtensionUi: true });
	const state = withFrozenClock(() => createEventMapperState({ sessionId: scenario.activeSessionId }));
	options.onState?.(state);
	const connectionEvents: MapperInputEvent[] = [];
	const events: ChatStreamEvent[] = [];
	let pending: MapperInputEvent[] = [];
	const unsubscribe = connection.subscribe((event) => {
		pending.push(structuredClone(event));
	});
	try {
		for (const frame of scenario.frames) {
			const seed = snapshotMessages(frame, scenario.activeSessionId);
			if (seed) seedToolCallStartsFromMessages(state, seed);
			transport.deliver(frame);
			await drain();
			const topLevel = topLevelMapperFrame(frame);
			if (topLevel) pending.push(topLevel);
			const batch = pending;
			pending = [];
			connectionEvents.push(...batch);
			withFrozenClock(() => {
				for (const event of batch) events.push(...mapAgentConnectionEvent(state, event));
			});
		}
	} finally {
		unsubscribe();
		if (previousAgentDir === undefined) delete process.env[REPLAY_AGENT_DIR_ENV];
		else process.env[REPLAY_AGENT_DIR_ENV] = previousAgentDir;
	}
	// JSON round-trip: the browser receives these frames over SSE as JSON.
	return { connectionEvents, events: JSON.parse(JSON.stringify(events)) as ChatStreamEvent[] };
}
