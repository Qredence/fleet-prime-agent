/**
 * Fleet-owned adapter for the per-session Prime Agent daemon protocol.
 *
 * This is intentionally not the production connection factory yet. The stock
 * adapter still owns production attachment until Fleet has parity coverage for
 * the full AgentConnection surface used by the server.
 */

import { isDaemonSessionBindingFrame, READ_ONLY_DAEMON_COMMANDS } from "./daemon-protocol";
import { createDaemonSequenceGapTracker, type DaemonSequenceGap } from "./daemon-sequence-gap";
import type { DaemonSocketClient } from "./daemon-socket-client";
import { DaemonCommandOutcomeUnknownError } from "./daemon-socket-client";

type JsonRecord = Record<string, unknown>;
export type FleetConnectionSnapshot = {
	state: JsonRecord;
	messages: unknown[];
	lastEventSequence?: number;
	lastEventCursor?: JsonRecord;
	replay?: JsonRecord;
	[key: string]: unknown;
};
export type FleetConnectionEvent =
	| { type: "session_event"; event: JsonRecord }
	| { type: "session_replaced"; state: JsonRecord; messages: unknown[] }
	| { type: "session_resynced"; snapshot: FleetConnectionSnapshot }
	| { type: "connection_status"; status: "reconnecting" | "connected"; error?: string; daemonVersion?: string }
	| { type: "heartbeats_changed" }
	| { type: "closed"; error?: string };
type Listener = (event: FleetConnectionEvent) => void | Promise<void>;
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
type Watcher = {
	getMessages(): Promise<unknown[]>;
	getCommands(): Promise<unknown[]>;
	subscribe(listener: Listener): () => void;
	getToolDefinition(name: string): Promise<unknown>;
	close(): Promise<void>;
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
		options: { recoverDaemon?: () => Promise<void>; closeClientOnDispose?: boolean } = {},
	): Promise<FleetDaemonAgentConnection> {
		const bufferedFrames: unknown[] = [];
		const unsubscribe = client.onFrame((frame) => bufferedFrames.push(frame));
		try {
			const response = await client.request({
				type: "attach",
				activeSessionId,
				supportsExtensionUi: false,
				capabilities: ["attach_snapshot", "event_sequence"],
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
			this.#snapshotFrames.push(frame);
			this.#sequenceGapTracker.observe(frame);
			if (frame.type === "session_snapshot_end") void this.#applyReplacementSnapshot(frame);
			return;
		}
		if (this.#recovering) {
			this.#recoveryFrames.push(frame);
			return;
		}
		if (frame.type === "session_event" && frame.activeSessionId === this.#activeSessionId) {
			this.#snapshotFresh = false;
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
			this.#emit({ type: "closed", error: typeof frame.reason === "string" ? frame.reason : undefined });
		}
	}

	async #applyReplacementSnapshot(end: JsonRecord): Promise<void> {
		if (typeof end.snapshotId !== "string" || this.#handledSnapshotIds.has(end.snapshotId)) return;
		const frames = this.#snapshotFrames.filter((frame) => isRecord(frame) && frame.snapshotId === end.snapshotId);
		const begin = frames.find((frame) => isRecord(frame) && frame.type === "session_snapshot_begin");
		if (!isRecord(begin) || begin.purpose !== "replacement") return;
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
			this.#snapshotFrames = this.#snapshotFrames.filter(
				(frame) => !isRecord(frame) || frame.snapshotId !== end.snapshotId,
			);
			this.#handledSnapshotIds.delete(end.snapshotId);
		}
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
		for (const listener of [...this.#listeners]) void listener(event);
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

	async getState(): Promise<JsonRecord> {
		return this.#data("get_connection_state");
	}

	async getInitialSnapshot(): Promise<ConnectionSnapshot> {
		if (this.#snapshotFresh) return this.#snapshot;
		const [state, messagesData, sessionContextData] = await Promise.all([
			this.getState(),
			this.#data<unknown>("get_messages"),
			this.#data<unknown>("get_session_context"),
		]);
		const messages = Array.isArray(messagesData)
			? messagesData
			: responseRecord(messagesData, "get_messages").messages;
		if (!Array.isArray(messages)) throw new Error("The Prime Agent daemon returned invalid messages");
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
		return this.#snapshot;
	}

	async getMessages(): Promise<ConnectionSnapshot["messages"]> {
		const data = await this.#data<unknown>("get_messages");
		return (
			Array.isArray(data) ? data : responseRecord(data, "get_messages").messages
		) as ConnectionSnapshot["messages"];
	}

	async getSessionTree(): Promise<{ tree: unknown[]; leafId: string | null }> {
		const data = responseRecord(await this.#data("get_session_tree"), "get_session_tree");
		if (!Array.isArray(data.flatNodes)) throw new Error("The Prime Agent daemon returned an invalid session tree");
		return {
			tree: buildSessionTree(data.flatNodes as FlatSessionTree[]),
			leafId: typeof data.leafId === "string" ? data.leafId : null,
		};
	}

	async getSessionStats(): Promise<unknown> {
		return this.#data("get_session_stats");
	}

	async getQueue(): Promise<{ steering: string[]; followUp: string[] }> {
		return this.#data("get_queue");
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
		await this.#data(
			"prompt_and_wait",
			{
				message,
				...(options.images ? { images: options.images } : {}),
				...(options.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {}),
				...(options.queueIfBusy !== undefined ? { queueIfBusy: options.queueIfBusy } : {}),
				...(options.source ? { source: options.source } : {}),
			},
			LONG_RUNNING_REQUEST_TIMEOUT_MS,
		);
	}

	async waitForIdle(): Promise<void> {
		await this.#data("wait_for_idle", {}, LONG_RUNNING_REQUEST_TIMEOUT_MS);
	}

	async setModel(provider: string, modelId: string): Promise<unknown> {
		return this.#data("set_model", { provider, modelId });
	}

	async setThinkingLevel(level: string): Promise<void> {
		await this.#data("set_thinking_level", { level });
	}

	async setServiceTier(serviceTier: string): Promise<void> {
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

	async watchSession(activeSessionId: string): Promise<Watcher | undefined> {
		let watcher: FleetDaemonAgentConnection;
		try {
			watcher = await FleetDaemonAgentConnection.attach(this.client, activeSessionId, {
				closeClientOnDispose: false,
			});
		} catch {
			return undefined;
		}
		return {
			getMessages: () => watcher.getMessages(),
			getCommands: () => watcher.getCommands(),
			subscribe: (listener) => watcher.subscribe(listener),
			getToolDefinition: (name) => watcher.getToolDefinition(name),
			close: () => watcher.dispose(),
		};
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
