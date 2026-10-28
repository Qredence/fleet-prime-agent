/**
 * Fleet-owned adapter for the per-session Prime Agent daemon protocol.
 *
 * This is intentionally not the production connection factory yet. The stock
 * adapter still owns production attachment until Fleet has parity coverage for
 * the full AgentConnection surface used by the server.
 */

import { join } from "node:path";
import type {
	FleetAgentConnection,
	FleetConnectionEvent,
	FleetConnectionListener,
	MessagesFor,
	ModelFor,
	QueueFor,
	SessionTreeFor,
	SnapshotFor,
	StateFor,
	StatsFor,
	WatcherFor,
} from "./agent-connection-port";
import { resolveAgentDir } from "./agent-dir";
import { isDaemonSessionBindingFrame, READ_ONLY_DAEMON_COMMANDS } from "./daemon-protocol";
import { createDaemonSequenceGapTracker, type DaemonSequenceGap } from "./daemon-sequence-gap";
import type { DaemonSocketClient } from "./daemon-socket-client";
import { DaemonCommandOutcomeUnknownError } from "./daemon-socket-client";

type JsonRecord = Record<string, unknown>;
type FleetConnectionSnapshot = {
	state: JsonRecord;
	messages: unknown[];
	lastEventSequence?: number;
	lastEventCursor?: JsonRecord;
	replay?: JsonRecord;
	[key: string]: unknown;
};
type Listener = FleetConnectionListener;
type ConnectionSnapshot = FleetConnectionSnapshot;
type QueueMutation =
	| { type: "delete" }
	| { type: "move"; direction: -1 | 1 }
	| { type: "replace"; text: string; images?: unknown[]; lane: "steering" | "followUp" };
type PromptOptions = {
	images?: unknown[];
	streamingBehavior?: "steer" | "followUp";
	queueIfBusy?: boolean;
	source?: string;
	signal?: AbortSignal;
};
type ForkOptions = { position?: "before" | "at" };
type NavigateOptions = {
	summarize?: boolean;
	customInstructions?: string;
	replaceInstructions?: boolean;
	label?: string;
};
type EventCursor = { generation?: string; sequence: number };
type FlatSessionTree = {
	entry: { id: string; parentId?: string | null; timestamp: string | number };
	[key: string]: unknown;
};
const LONG_RUNNING_REQUEST_TIMEOUT_MS = 24 * 60 * 60 * 1_000;

export class FleetQueueMutationOutcomeUnknownError extends Error {
	readonly code = "DAEMON_COMMAND_OUTCOME_UNKNOWN";
	readonly command = "mutate_queued_message";
	readonly activeSessionId: string;
	readonly requestId: string;

	constructor(activeSessionId: string, cause: DaemonCommandOutcomeUnknownError) {
		super("The queued-message change may have been applied. Refresh the queue before trying again.", { cause });
		this.name = "FleetQueueMutationOutcomeUnknownError";
		this.activeSessionId = activeSessionId;
		this.requestId = cause.requestId;
	}
}

function buildSessionTree(flatNodes: FlatSessionTree[]): unknown[] {
	const byId = new Map<string, FlatSessionTree & { children: unknown[] }>();
	const roots: Array<FlatSessionTree & { children: unknown[] }> = [];
	for (const node of flatNodes) byId.set(node.entry.id, { ...node, children: [] });
	for (const node of flatNodes) {
		const current = byId.get(node.entry.id);
		if (!current) continue;
		const parentId = node.entry.parentId;
		const parent = parentId && parentId !== node.entry.id ? byId.get(parentId) : undefined;
		if (parent) parent.children.push(current);
		else roots.push(current);
	}
	const sort = (nodes: Array<FlatSessionTree & { children: unknown[] }>) => {
		nodes.sort((left, right) => new Date(left.entry.timestamp).getTime() - new Date(right.entry.timestamp).getTime());
		for (const node of nodes) sort(node.children as Array<FlatSessionTree & { children: unknown[] }>);
	};
	sort(roots);
	return roots;
}

async function collectSnapshotMessages(
	client: DaemonSocketClient,
	snapshotId: string,
	bufferedFrames: unknown[],
): Promise<{ snapshot: JsonRecord; messages: unknown[]; lastEventSequence?: number; lastEventCursor?: JsonRecord }> {
	const matchingFrames = () => bufferedFrames.filter((frame) => isRecord(frame) && frame.snapshotId === snapshotId);
	const hasEnd = () => matchingFrames().some((frame) => isRecord(frame) && frame.type === "session_snapshot_end");
	if (!hasEnd()) {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				unsubscribe();
				reject(new Error(`Timed out waiting for daemon snapshot ${snapshotId}`));
			}, 30_000);
			const unsubscribe = client.onFrame((frame) => {
				if (!isRecord(frame) || !("snapshotId" in frame) || frame.snapshotId !== snapshotId) return;
				if (frame.type !== "session_snapshot_end") return;
				clearTimeout(timeout);
				unsubscribe();
				resolve();
			});
		});
	}
	const frames = matchingFrames();
	const begin = frames.find((frame) => isRecord(frame) && frame.type === "session_snapshot_begin");
	const end = frames.find((frame) => isRecord(frame) && frame.type === "session_snapshot_end");
	if (
		!isRecord(begin) ||
		!isRecord(begin.snapshot) ||
		!isRecord(end) ||
		!Number.isInteger(end.chunkCount) ||
		(end.chunkCount as number) < 0
	) {
		throw new Error(
			`The Prime Agent daemon returned an incomplete snapshot ${snapshotId} (${frames.map((frame) => (isRecord(frame) ? frame.type : "invalid")).join(",")})`,
		);
	}
	const beginFrames = frames.filter((frame) => isRecord(frame) && frame.type === "session_snapshot_begin");
	const endFrames = frames.filter((frame) => isRecord(frame) && frame.type === "session_snapshot_end");
	if (beginFrames.length !== 1 || endFrames.length !== 1) {
		throw new Error(`The Prime Agent daemon returned duplicate snapshot boundaries for ${snapshotId}`);
	}
	const activeSessionId = begin.activeSessionId;
	if (
		typeof activeSessionId !== "string" ||
		end.activeSessionId !== activeSessionId ||
		(begin.snapshot.activeSessionId !== undefined && begin.snapshot.activeSessionId !== activeSessionId)
	) {
		throw new Error(`The Prime Agent daemon returned inconsistent session ids for snapshot ${snapshotId}`);
	}
	const chunks = new Map<number, unknown[]>();
	const chunkCount = end.chunkCount as number;
	for (const frame of frames) {
		if (!isRecord(frame) || frame.type !== "session_snapshot_chunk") continue;
		if (
			!Number.isInteger(frame.index) ||
			(frame.index as number) < 0 ||
			(frame.index as number) >= (end.chunkCount as number) ||
			!Array.isArray(frame.messages) ||
			frame.activeSessionId !== activeSessionId
		) {
			throw new Error(`The Prime Agent daemon returned an invalid snapshot chunk for ${snapshotId}`);
		}
		if (chunks.has(frame.index as number)) {
			throw new Error(`The Prime Agent daemon returned duplicate snapshot chunk ${frame.index} for ${snapshotId}`);
		}
		chunks.set(frame.index as number, frame.messages);
	}
	const messages: unknown[] = [];
	for (let index = 0; index < chunkCount; index++) {
		const chunk = chunks.get(index);
		if (!chunk) throw new Error(`The Prime Agent daemon omitted snapshot chunk ${index} for ${snapshotId}`);
		messages.push(...chunk);
	}
	if (
		begin.messageCount !== undefined &&
		(!Number.isInteger(begin.messageCount) || begin.messageCount !== messages.length)
	) {
		throw new Error(`The Prime Agent daemon returned an incomplete message count for snapshot ${snapshotId}`);
	}
	return {
		snapshot: begin.snapshot,
		messages,
		...(typeof end.lastEventSequence === "number" ? { lastEventSequence: end.lastEventSequence } : {}),
		...(isRecord(end.lastEventCursor) ? { lastEventCursor: end.lastEventCursor } : {}),
	};
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseRecord(value: unknown, command: string): JsonRecord {
	if (!isRecord(value)) throw new Error(`The Prime Agent daemon returned an invalid ${command} response`);
	return value;
}

/** Attach to a Rust worker and adapt its supported protocol surface to Fleet. */
/**
 * Turn a `session_closed` reason into text a person can act on.
 *
 * The daemon's `reason` is a protocol token (`killed`, `shutdown`, `replaced`,
 * `error`; pa-daemon worker/env.rs), not a sentence. The retired SDK adapter
 * composed a user-facing message here, so passing the raw token through would
 * regress what the error surface shows.
 */
function describeSessionClose(reason: unknown): string | undefined {
	if (typeof reason !== "string" || !reason) return undefined;
	const logPath = join(resolveAgentDir(), "logs", "agent.jsonl");
	if (reason === "killed") {
		return `The daemon stopped this agent session. Its transcript remains saved and can be reopened from Agents View. Diagnostic log: ${logPath}.`;
	}
	if (reason === "shutdown" || reason === "replaced") return `The agent session was closed by the daemon (${reason}).`;
	return `The agent session closed unexpectedly: ${reason}. Diagnostic log: ${logPath}.`;
}

export class FleetDaemonAgentConnection {
	#activeSessionId: string;
	#snapshot: ConnectionSnapshot;
	#listeners = new Set<Listener>();
	#pendingEvents: FleetConnectionEvent[] = [];
	#pendingGaps: DaemonSequenceGap[] = [];
	#snapshotFrames: unknown[] = [];
	#handledSnapshotIds = new Set<string>();
	#recoveryFrames: unknown[] = [];
	#beforeInvalidate = new Set<() => void>();
	#gapListeners = new Set<(gap: DaemonSequenceGap) => void>();
	#bindingListeners = new Set<(binding: { previousActiveSessionId: string; activeSessionId: string }) => void>();
	#sequenceGapTracker = createDaemonSequenceGapTracker((gap) => {
		queueMicrotask(() => {
			if (this.#disposed || gap.activeSessionId !== this.#activeSessionId) return;
			if (this.#gapListeners.size === 0) this.#pendingGaps.push(gap);
			for (const listener of [...this.#gapListeners]) listener(gap);
		});
	});
	#unsubscribe: () => void;
	#unsubscribeClose: () => void;
	#disposed = false;
	#recoveryPromise: Promise<void> | undefined;
	#lastEventCursor: EventCursor | undefined;
	#recovering = false;
	#snapshotFresh = true;

	private constructor(
		private readonly client: DaemonSocketClient,
		activeSessionId: string,
		snapshot: ConnectionSnapshot,
		bufferedFrames: unknown[],
		private readonly recoverDaemon?: () => Promise<void>,
		private readonly closeClientOnDispose = true,
	) {
		this.#activeSessionId = activeSessionId;
		this.#snapshot = snapshot;
		this.#snapshotFresh = true;
		this.#lastEventCursor = this.#cursorFromSnapshot(snapshot);
		this.#unsubscribe = client.onFrame((frame) => this.#onFrame(frame));
		this.#unsubscribeClose = client.onClose((error) => this.#onClose(error));
		this.#sequenceGapTracker.observe({
			type: "response",
			command: "attach",
			success: true,
			data: {
				activeSessionId,
				snapshot: { lastEventSequence: snapshot.lastEventSequence, lastEventCursor: snapshot.lastEventCursor },
			},
		});
		for (const frame of bufferedFrames) this.#onFrame(frame);
	}

	#cursorFromSnapshot(snapshot: FleetConnectionSnapshot): EventCursor | undefined {
		if (isRecord(snapshot.lastEventCursor) && typeof snapshot.lastEventCursor.sequence === "number") {
			return {
				sequence: snapshot.lastEventCursor.sequence,
				...(typeof snapshot.lastEventCursor.generation === "string"
					? { generation: snapshot.lastEventCursor.generation }
					: {}),
			};
		}
		return typeof snapshot.lastEventSequence === "number" ? { sequence: snapshot.lastEventSequence } : undefined;
	}

	static async attach(
		client: DaemonSocketClient,
		activeSessionId: string,
		options: {
			recoverDaemon?: () => Promise<void>;
			closeClientOnDispose?: boolean;
			/** Last cursor this client applied, so the daemon can replay from it. */
			resumeCursor?: EventCursor;
		} = {},
	): Promise<FleetDaemonAgentConnection> {
		const bufferedFrames: unknown[] = [];
		const unsubscribe = client.onFrame((frame) => bufferedFrames.push(frame));
		try {
			const response = await client.request({
				type: "attach",
				activeSessionId,
				supportsExtensionUi: false,
				capabilities: ["attach_snapshot", "event_sequence"],
				...(options.resumeCursor ? { resumeCursor: options.resumeCursor } : {}),
			});
			if (!response.success)
				throw new Error(response.error ?? "The Prime Agent daemon could not attach the session");
			const data = responseRecord(response.data, "attach");
			let snapshotData = responseRecord(data.snapshot, "attach snapshot");
			if (isRecord(data.snapshotStream) && typeof data.snapshotStream.id === "string") {
				const streamed = await collectSnapshotMessages(client, data.snapshotStream.id, bufferedFrames);
				snapshotData = {
					...snapshotData,
					...streamed.snapshot,
					messages: streamed.messages,
					...(streamed.lastEventSequence !== undefined ? { lastEventSequence: streamed.lastEventSequence } : {}),
					...(streamed.lastEventCursor ? { lastEventCursor: streamed.lastEventCursor } : {}),
				};
			}
			const state = snapshotData.state;
			const messages = snapshotData.messages;
			if (!isRecord(state) || !Array.isArray(messages)) {
				throw new Error("The Prime Agent daemon returned an invalid attach snapshot");
			}
			const snapshot = {
				state,
				messages,
				...(isRecord(snapshotData.summary) && "streamingMessage" in snapshotData.summary
					? { streamingMessage: snapshotData.summary.streamingMessage }
					: {}),
				...(isRecord(snapshotData.sessionContext) ? { sessionContext: snapshotData.sessionContext } : {}),
				...(isRecord(snapshotData.sessionTree) ? { sessionTree: snapshotData.sessionTree } : {}),
				...(isRecord(snapshotData.parent) ? { parent: snapshotData.parent } : {}),
				...(Array.isArray(snapshotData.children) ? { children: snapshotData.children } : {}),
				...(typeof snapshotData.lastEventSequence === "number" || typeof data.lastEventSequence === "number"
					? { lastEventSequence: (snapshotData.lastEventSequence ?? data.lastEventSequence) as number }
					: {}),
				...(isRecord(snapshotData.lastEventCursor) || isRecord(data.lastEventCursor)
					? { lastEventCursor: (snapshotData.lastEventCursor ?? data.lastEventCursor) as JsonRecord }
					: {}),
				...(isRecord(data.replay) ? { replay: data.replay } : {}),
			} as unknown as ConnectionSnapshot;
			const attachedId = typeof data.activeSessionId === "string" ? data.activeSessionId : activeSessionId;
			const connection = new FleetDaemonAgentConnection(
				client,
				attachedId,
				snapshot,
				bufferedFrames,
				options.recoverDaemon,
				options.closeClientOnDispose,
			);
			unsubscribe();
			return connection;
		} catch (error) {
			unsubscribe();
			throw error;
		}
	}

	#onClose(error: Error): void {
		if (this.#disposed || this.#recoveryPromise) return;
		this.#recovering = true;
		this.#emit({ type: "connection_status", status: "reconnecting", error: error.message });
		const recovery = (async () => {
			const deadline = Date.now() + 60_000;
			let lastError: unknown = error;
			try {
				while (!this.#disposed && Date.now() < deadline) {
					try {
						await this.recoverDaemon?.();
						await this.client.reconnect(1_000);
						break;
					} catch (reconnectError) {
						lastError = reconnectError;
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
				}
				if (!this.client.isConnected) throw lastError;
				const response = await this.client.request({
					type: "reattach",
					activeSessionId: this.#activeSessionId,
					// Ask for replay from the last applied event. The daemon may answer
					// `replay.status: "unavailable"` (see stale-resume-attach.jsonl);
					// the snapshot below is authoritative in that case.
					...(this.#lastEventCursor ? { resumeCursor: this.#lastEventCursor } : {}),
				});
				if (!response.success)
					throw new Error(response.error ?? "The Prime Agent daemon could not reattach the session");
				const data = responseRecord(response.data, "reattach");
				let snapshot = responseRecord(data.snapshot, "reattach snapshot");
				if (isRecord(data.snapshotStream) && typeof data.snapshotStream.id === "string") {
					const streamed = await collectSnapshotMessages(
						this.client,
						data.snapshotStream.id,
						this.#snapshotFrames,
					);
					this.#snapshotFrames = [];
					snapshot = {
						...snapshot,
						...streamed.snapshot,
						messages: streamed.messages,
						...(streamed.lastEventSequence !== undefined
							? { lastEventSequence: streamed.lastEventSequence }
							: {}),
						...(streamed.lastEventCursor ? { lastEventCursor: streamed.lastEventCursor } : {}),
					};
				}
				this.#snapshotFrames = [];
				if (!isRecord(snapshot.state) || !Array.isArray(snapshot.messages)) {
					throw new Error("The Prime Agent daemon returned an invalid reattach snapshot");
				}
				this.#snapshot = snapshot as unknown as ConnectionSnapshot;
				this.#snapshotFresh = true;
				this.#lastEventCursor = this.#cursorFromSnapshot(this.#snapshot);
				this.#sequenceGapTracker.observe({
					type: "response",
					command: "attach",
					success: true,
					data: {
						activeSessionId: this.#activeSessionId,
						snapshot: {
							lastEventSequence: snapshot.lastEventSequence,
							lastEventCursor: snapshot.lastEventCursor,
						},
					},
				});
				this.#emit({ type: "session_resynced", snapshot: this.#snapshot });
				this.#recovering = false;
				for (const frame of this.#recoveryFrames.splice(0)) this.#onFrame(frame);
				this.#emit({
					type: "connection_status",
					status: "connected",
					...(typeof this.client.hello?.appVersion === "string"
						? { daemonVersion: this.client.hello.appVersion }
						: {}),
				});
			} catch (recoveryError) {
				if (this.#disposed) return;
				this.#recovering = false;
				this.#recoveryFrames = [];
				this.#emit({
					type: "closed",
					error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
				});
			} finally {
				this.#recoveryPromise = undefined;
			}
		})();
		this.#recoveryPromise = recovery;
	}

	#onFrame(frame: unknown): void {
		if (!isRecord(frame)) return;
		if (typeof frame.type === "string" && frame.type.startsWith("session_snapshot_")) {
			// A connection can carry snapshots for more than one session: a child
			// watcher streams its own snapshots, and those must never enter this
			// session's buffer. A foreign snapshot would then be handed to
			// #applyReplacementSnapshot, fail its activeSessionId check, and emit a
			// terminal `closed` that kills the parent session.
			if (frame.activeSessionId !== this.#activeSessionId) {
				// Still evict the tail so a foreign snapshot cannot leak.
				if (frame.type === "session_snapshot_end") this.#evictSnapshotFrames(frame.snapshotId);
				this.#sequenceGapTracker.observe(frame);
				return;
			}
			this.#snapshotFrames.push(frame);
			this.#sequenceGapTracker.observe(frame);
			if (frame.type === "session_snapshot_end") void this.#applyReplacementSnapshot(frame);
			return;
		}
		if (this.#recovering) {
			this.#recoveryFrames.push(frame);
			return;
		}
		this.#sequenceGapTracker.observe(frame);
		if (isDaemonSessionBindingFrame(frame)) {
			if (frame.previousActiveSessionId !== this.#activeSessionId && frame.activeSessionId !== this.#activeSessionId)
				return;
			this.#activeSessionId = frame.activeSessionId;
			this.#snapshotFresh = false;
			for (const listener of [...this.#bindingListeners]) listener(frame);
			return;
		}
		if (frame.type === "session_event" && frame.activeSessionId === this.#activeSessionId && isRecord(frame.event)) {
			const meta = isRecord(frame.meta) ? frame.meta : undefined;
			const cursor = meta ? this.#cursorFromMeta(meta) : undefined;
			const previous = this.#lastEventCursor;
			const sameGeneration =
				previous !== undefined &&
				(previous.generation === undefined ||
					cursor?.generation === undefined ||
					previous.generation === cursor.generation);
			// Dedupe before invalidating: a redundant frame is not evidence that the
			// snapshot went stale, so this must not cost a round trip.
			if (cursor && sameGeneration && cursor.sequence <= previous.sequence) return;
			if (cursor) this.#lastEventCursor = cursor;
			this.#snapshotFresh = false;
			this.#emit({ type: "session_event", event: frame.event });
			return;
		}
		if (frame.type === "heartbeats_changed") {
			this.#emit({ type: "heartbeats_changed" });
			return;
		}
		if (frame.type === "session_closed" && frame.activeSessionId === this.#activeSessionId) {
			this.#snapshotFresh = false;
			this.#emit({ type: "closed", error: describeSessionClose(frame.reason) });
		}
	}

	async #applyReplacementSnapshot(end: JsonRecord): Promise<void> {
		if (typeof end.snapshotId !== "string") return;
		if (this.#handledSnapshotIds.has(end.snapshotId)) {
			this.#evictSnapshotFrames(end.snapshotId);
			return;
		}
		const frames = this.#snapshotFrames.filter((frame) => isRecord(frame) && frame.snapshotId === end.snapshotId);
		const begin = frames.find((frame) => isRecord(frame) && frame.type === "session_snapshot_begin");
		// Every snapshot purpose ends here, so buffers are released for all of
		// them. Only `replacement` is applied; `attach` snapshots were already
		// consumed by the attach call and would otherwise accumulate for the
		// lifetime of the connection.
		if (!isRecord(begin) || begin.purpose !== "replacement") {
			this.#evictSnapshotFrames(end.snapshotId);
			return;
		}
		this.#handledSnapshotIds.add(end.snapshotId);
		try {
			const streamed = await collectSnapshotMessages(this.client, end.snapshotId, frames);
			if (begin.activeSessionId !== this.#activeSessionId || !isRecord(streamed.snapshot.state)) {
				throw new Error(`The Prime Agent daemon returned an invalid replacement snapshot ${end.snapshotId}`);
			}
			const snapshot: ConnectionSnapshot = {
				...streamed.snapshot,
				state: streamed.snapshot.state,
				messages: streamed.messages,
				...(isRecord(streamed.snapshot.summary) && "streamingMessage" in streamed.snapshot.summary
					? { streamingMessage: streamed.snapshot.summary.streamingMessage }
					: {}),
				...(isRecord(streamed.snapshot.sessionContext) ? { sessionContext: streamed.snapshot.sessionContext } : {}),
				...(isRecord(streamed.snapshot.sessionTree) ? { sessionTree: streamed.snapshot.sessionTree } : {}),
				...(isRecord(streamed.snapshot.parent) ? { parent: streamed.snapshot.parent } : {}),
				...(Array.isArray(streamed.snapshot.children) ? { children: streamed.snapshot.children } : {}),
				...(streamed.lastEventSequence !== undefined ? { lastEventSequence: streamed.lastEventSequence } : {}),
				...(streamed.lastEventCursor ? { lastEventCursor: streamed.lastEventCursor } : {}),
			};
			for (const listener of [...this.#beforeInvalidate]) listener();
			this.#snapshot = snapshot;
			this.#lastEventCursor = this.#cursorFromSnapshot(snapshot);
			this.#snapshotFresh = true;
			this.#emit({ type: "session_replaced", state: snapshot.state, messages: snapshot.messages });
		} catch (error) {
			this.#emit({
				type: "closed",
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.#evictSnapshotFrames(end.snapshotId);
			this.#handledSnapshotIds.delete(end.snapshotId);
		}
	}

	/** Drop buffered frames for one snapshot and forget its identity. */
	#evictSnapshotFrames(snapshotId: unknown): void {
		if (typeof snapshotId !== "string") return;
		this.#snapshotFrames = this.#snapshotFrames.filter(
			(frame) => !isRecord(frame) || frame.snapshotId !== snapshotId,
		);
	}

	#cursorFromMeta(meta: JsonRecord): EventCursor | undefined {
		if (isRecord(meta.cursor) && typeof meta.cursor.sequence === "number") {
			return {
				sequence: meta.cursor.sequence,
				...(typeof meta.cursor.generation === "string" ? { generation: meta.cursor.generation } : {}),
			};
		}
		return typeof meta.sequence === "number"
			? { sequence: meta.sequence, ...(typeof meta.generation === "string" ? { generation: meta.generation } : {}) }
			: undefined;
	}

	#emit(event: FleetConnectionEvent): void {
		if (this.#listeners.size === 0) {
			this.#pendingEvents.push(event);
			return;
		}
		// One throwing listener must not stop delivery to the others: the events
		// are independent consumers of the same frame, and a dropped frame leaves
		// the survivor desynchronized from the transcript.
		for (const listener of [...this.#listeners]) {
			try {
				void listener(event);
			} catch {
				// Listener failures are theirs to report; the connection proceeds.
			}
		}
	}

	async #data<T>(type: string, fields: JsonRecord = {}, timeoutMs?: number): Promise<T> {
		if (!READ_ONLY_DAEMON_COMMANDS.has(type)) this.#snapshotFresh = false;
		const response = await this.client.request(
			{ type, activeSessionId: this.#activeSessionId, ...fields },
			timeoutMs,
		);
		if (!response.success) throw new Error(response.error ?? `The Prime Agent daemon rejected ${type}`);
		return response.data as T;
	}

	subscribe(listener: Listener): () => void {
		this.#listeners.add(listener);
		for (const event of this.#pendingEvents.splice(0)) void listener(event);
		return () => this.#listeners.delete(listener);
	}

	onSequenceGap(listener: (gap: DaemonSequenceGap) => void): () => void {
		this.#gapListeners.add(listener);
		for (const gap of this.#pendingGaps.splice(0)) listener(gap);
		return () => this.#gapListeners.delete(listener);
	}

	onSessionBinding(
		listener: (binding: { previousActiveSessionId: string; activeSessionId: string }) => void,
	): () => void {
		this.#bindingListeners.add(listener);
		return () => this.#bindingListeners.delete(listener);
	}

	onBeforeSessionInvalidate(listener: () => void): () => void {
		this.#beforeInvalidate.add(listener);
		return () => this.#beforeInvalidate.delete(listener);
	}

	async getState(): Promise<StateFor<FleetAgentConnection>> {
		// The daemon returns a state object; individual fields are validated where
		// they are consumed (thinking level, model, streaming flags).
		return (await this.#data("get_connection_state")) as StateFor<FleetAgentConnection>;
	}

	async getInitialSnapshot(): Promise<SnapshotFor<FleetAgentConnection>> {
		if (this.#snapshotFresh) return this.#snapshot as unknown as SnapshotFor<FleetAgentConnection>;
		const [stateData, messagesData, sessionContextData] = await Promise.all([
			this.getState(),
			this.#data<unknown>("get_messages"),
			this.#data<unknown>("get_session_context"),
		]);
		const messages = Array.isArray(messagesData)
			? messagesData
			: responseRecord(messagesData, "get_messages").messages;
		if (!Array.isArray(messages)) throw new Error("The Prime Agent daemon returned invalid messages");
		const state = stateData as unknown as JsonRecord;
		const sessionContext = responseRecord(sessionContextData, "get_session_context").context;
		const { streamingMessage: previousStreamingMessage, ...base } = this.#snapshot;
		this.#snapshot = {
			...base,
			state,
			messages,
			...(state.isStreaming && previousStreamingMessage ? { streamingMessage: previousStreamingMessage } : {}),
			...(isRecord(sessionContext) ? { sessionContext } : {}),
			...(this.#lastEventCursor ? { lastEventCursor: this.#lastEventCursor } : {}),
			...(this.#lastEventCursor ? { lastEventSequence: this.#lastEventCursor.sequence } : {}),
		};
		this.#snapshotFresh = true;
		// The daemon protocol is validated frame by frame above (state is an
		// object, messages an array); the event mapper is what narrows the rest
		// into Fleet's presentation shapes.
		return this.#snapshot as unknown as SnapshotFor<FleetAgentConnection>;
	}

	async getMessages(): Promise<MessagesFor<FleetAgentConnection>> {
		const data = await this.#data<unknown>("get_messages");
		const messages = Array.isArray(data) ? data : responseRecord(data, "get_messages").messages;
		if (!Array.isArray(messages)) throw new Error("The Prime Agent daemon returned invalid messages");
		// Validated as an array here; the event mapper and transcript hydrator
		// narrow individual messages further downstream.
		return messages as unknown as MessagesFor<FleetAgentConnection>;
	}

	async getSessionTree(): Promise<SessionTreeFor<FleetAgentConnection>> {
		const data = responseRecord(await this.#data("get_session_tree"), "get_session_tree");
		if (!Array.isArray(data.flatNodes)) throw new Error("The Prime Agent daemon returned an invalid session tree");
		// `buildSessionTree` assembles nodes from validated wire entries; the
		// session-tree mapper narrows them into Fleet's typed nodes.
		return {
			tree: buildSessionTree(data.flatNodes as FlatSessionTree[]),
			leafId: typeof data.leafId === "string" ? data.leafId : null,
		} as unknown as SessionTreeFor<FleetAgentConnection>;
	}

	async getSessionStats(): Promise<StatsFor<FleetAgentConnection>> {
		return (await this.#data("get_session_stats")) as StatsFor<FleetAgentConnection>;
	}

	async getQueue(): Promise<QueueFor<FleetAgentConnection>> {
		return (await this.#data("get_queue")) as QueueFor<FleetAgentConnection>;
	}

	async getSessionHeader(): Promise<unknown> {
		const data = responseRecord(await this.#data("get_session_header"), "get_session_header");
		return data.header;
	}

	async getCommands(): Promise<unknown[]> {
		const data = responseRecord(await this.#data("get_commands"), "get_commands");
		if (!Array.isArray(data.commands)) throw new Error("The Prime Agent daemon returned invalid commands");
		return data.commands;
	}

	async getToolDefinition(name: string): Promise<unknown> {
		const data = responseRecord(await this.#data("get_tool_definition", { name }), "get_tool_definition");
		return data.toolDefinition;
	}

	/**
	 * Remove a persisted transcript. The daemon owns the file, so deleting
	 * through it keeps the saved-session catalog and the on-disk transcript in
	 * agreement; Fleet never unlinks that path itself.
	 */
	async deleteSavedSession(
		sessionPath: string,
	): Promise<{ ok: true; method: "trash" | "unlink" } | { ok: false; error: string }> {
		const response = await this.client.request({
			type: "delete_saved_session",
			activeSessionId: this.#activeSessionId,
			sessionPath,
		});
		if (!response.success) return { ok: false, error: response.error ?? "The daemon could not delete the session" };
		const data = responseRecord(response.data, "delete_saved_session");
		if (data.ok !== true) {
			return {
				ok: false,
				error: typeof data.error === "string" ? data.error : "The daemon could not delete the session",
			};
		}
		return { ok: true, method: data.method === "unlink" ? "unlink" : "trash" };
	}

	async getSystemPrompt(): Promise<string> {
		const data = responseRecord(await this.#data("get_system_prompt"), "get_system_prompt");
		return typeof data.systemPrompt === "string" ? data.systemPrompt : "";
	}

	async mutateQueuedMessage(
		lane: "steering" | "followUp",
		index: number,
		expectedText: string,
		mutation: QueueMutation,
	): Promise<"applied" | "rejected" | "invalid" | "unsupported"> {
		if (!this.client.supportsServerCapability("queue_message_mutation")) return "unsupported";
		const activeSessionId = this.#activeSessionId;
		let result: unknown;
		try {
			result = await this.#data("mutate_queued_message", { lane, index, expectedText, mutation });
		} catch (error) {
			if (error instanceof DaemonCommandOutcomeUnknownError) {
				throw new FleetQueueMutationOutcomeUnknownError(activeSessionId, error);
			}
			throw error;
		}
		const data = responseRecord(result, "mutate_queued_message");
		if (data.status === "applied" || data.status === "rejected" || data.status === "invalid") return data.status;
		throw new Error("The Prime Agent daemon returned an invalid queued-message mutation status");
	}

	async promptAndWait(message: string, options: PromptOptions = {}): Promise<void> {
		// `prompt_and_wait` can legitimately block for a whole turn, so the signal
		// the caller passed must be able to end the wait. Without this the request
		// held for up to 24 hours after the caller had already given up.
		if (options.signal?.aborted) throw new Error("The prompt was aborted before it was sent");
		const pending = this.#data(
			"prompt_and_wait",
			{
				message,
				...(options.images ? { images: options.images } : {}),
				...(options.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {}),
				...(options.queueIfBusy !== undefined ? { queueIfBusy: options.queueIfBusy } : {}),
				...(options.source ? { source: options.source } : {}),
			},
			LONG_RUNNING_REQUEST_TIMEOUT_MS,
		).then(() => undefined);
		if (!options.signal) return pending;
		const signal = options.signal;
		return new Promise<void>((resolve, reject) => {
			const onAbort = () => reject(new Error("The prompt was aborted"));
			signal.addEventListener("abort", onAbort, { once: true });
			pending.then(
				() => {
					signal.removeEventListener("abort", onAbort);
					resolve();
				},
				(error: unknown) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				},
			);
		});
	}

	async waitForIdle(): Promise<void> {
		await this.#data("wait_for_idle", {}, LONG_RUNNING_REQUEST_TIMEOUT_MS);
	}

	async setModel(provider: string, modelId: string): Promise<ModelFor<FleetAgentConnection>> {
		return (await this.#data("set_model", { provider, modelId })) as ModelFor<FleetAgentConnection>;
	}

	async setThinkingLevel(level: Parameters<FleetAgentConnection["setThinkingLevel"]>[0]): Promise<void> {
		await this.#data("set_thinking_level", { level });
	}

	// A null tier clears the override; rejecting it would make the setting
	// impossible to unset from Fleet.
	async setServiceTier(serviceTier: Parameters<FleetAgentConnection["setServiceTier"]>[0]): Promise<void> {
		await this.#data("set_service_tier", { serviceTier });
	}

	async fork(entryId: string, options: ForkOptions = {}): Promise<{ cancelled: boolean; selectedText?: string }> {
		return this.#data("fork", { entryId, ...options });
	}

	async navigateTree(
		targetId: string,
		options: NavigateOptions = {},
	): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean }> {
		return this.#data("navigate_tree", { targetId, ...options });
	}

	async setSessionName(name: string): Promise<void> {
		await this.#data("set_session_name", { name });
	}

	async exportToJsonl(outputPath?: string): Promise<string> {
		const data = responseRecord(await this.#data("export_jsonl", { outputPath }), "export_jsonl");
		if (typeof data.path !== "string")
			throw new Error("The Prime Agent daemon returned an invalid JSONL export path");
		return data.path;
	}

	async exportToHtml(outputPath?: string): Promise<string> {
		const data = responseRecord(await this.#data("export_html", { outputPath }), "export_html");
		if (typeof data.path !== "string") throw new Error("The Prime Agent daemon returned an invalid HTML export path");
		return data.path;
	}

	async reload(): Promise<void> {
		await this.#data("reload");
	}

	async watchSession(activeSessionId: string): Promise<WatcherFor<FleetAgentConnection>> {
		let watcher: FleetDaemonAgentConnection;
		try {
			watcher = await FleetDaemonAgentConnection.attach(this.client, activeSessionId, {
				closeClientOnDispose: false,
			});
		} catch {
			return undefined;
		}
		// Watcher traffic is wire-shaped like the rest of the adapter; the bridge's
		// mapper narrows it.
		return {
			getMessages: () => watcher.getMessages(),
			getCommands: () => watcher.getCommands(),
			subscribe: (listener: Listener) => watcher.subscribe(listener),
			getToolDefinition: (name: string) => watcher.getToolDefinition(name),
			close: () => watcher.dispose(),
		} as unknown as WatcherFor<FleetAgentConnection>;
	}

	async abort(): Promise<void> {
		await this.#data("abort");
	}

	async dispose(): Promise<void> {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#unsubscribe();
		this.#unsubscribeClose();
		this.#listeners.clear();
		this.#pendingEvents = [];
		this.#pendingGaps = [];
		this.#beforeInvalidate.clear();
		this.#gapListeners.clear();
		this.#bindingListeners.clear();
		await this.#recoveryPromise?.catch(() => undefined);
		await this.#data("detach").catch(() => undefined);
		if (this.closeClientOnDispose) this.client.close();
	}
}
