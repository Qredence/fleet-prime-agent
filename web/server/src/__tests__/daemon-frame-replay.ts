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
import type { AgentConnectionEvent } from "prime-agent";
import { DaemonAgentConnection } from "prime-agent";
import { createEventMapperState, mapAgentConnectionEvent } from "../event-mapper";

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

/** The session the client attached to: last `attach` command, else the first frame naming one. */
export function inferActiveSessionId(frames: readonly DaemonFrame[], commands: readonly DaemonFrame[]): string {
	for (const envelope of [...commands].reverse()) {
		const command = envelope.command as { type?: unknown; activeSessionId?: unknown } | undefined;
		if (command?.type === "attach" && typeof command.activeSessionId === "string") return command.activeSessionId;
	}
	const named = frames.find((frame) => typeof frame.activeSessionId === "string");
	if (!named) throw new Error("cannot infer activeSessionId: no attach command and no frame names a session");
	return named.activeSessionId as string;
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

/** Replay raw daemon frames through the stock adapter and collect its connection events. */
export async function replayDaemonFrames(
	frames: readonly DaemonFrame[],
	activeSessionId: string,
): Promise<AgentConnectionEvent[]> {
	const transport = new ReplayTransport();
	const connection = new DaemonAgentConnection(transport, activeSessionId, { supportsExtensionUi: true });
	const events: AgentConnectionEvent[] = [];
	const unsubscribe = connection.subscribe((event) => {
		events.push(structuredClone(event));
	});
	try {
		for (const frame of frames) {
			transport.deliver(frame);
			await drain();
		}
	} finally {
		unsubscribe();
	}
	return events;
}

/** Map connection events with Fleet's event mapper under a frozen clock and RNG. */
export function mapConnectionEventsDeterministically(
	events: readonly AgentConnectionEvent[],
	sessionId: string,
): ChatStreamEvent[] {
	const realNow = Date.now;
	const realRandom = Math.random;
	Date.now = () => CONTRACT_FIXED_NOW;
	Math.random = () => CONTRACT_FIXED_RANDOM;
	try {
		const state = createEventMapperState({ sessionId });
		const out: ChatStreamEvent[] = [];
		for (const event of events) out.push(...mapAgentConnectionEvent(state, event));
		// JSON round-trip: the browser receives these frames over SSE as JSON.
		return JSON.parse(JSON.stringify(out)) as ChatStreamEvent[];
	} finally {
		Date.now = realNow;
		Math.random = realRandom;
	}
}

export async function replayDaemonFrameScenario(
	scenario: Pick<DaemonFrameScenario, "frames" | "activeSessionId">,
): Promise<{ connectionEvents: AgentConnectionEvent[]; events: ChatStreamEvent[] }> {
	const connectionEvents = await replayDaemonFrames(scenario.frames, scenario.activeSessionId);
	return {
		connectionEvents,
		events: mapConnectionEventsDeterministically(connectionEvents, scenario.activeSessionId),
	};
}
