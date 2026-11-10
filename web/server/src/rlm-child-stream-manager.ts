import type {
	ChatMessage,
	ChatStreamEvent,
	ChatThinkingLevel,
	PrimeAgentRlmChild,
	PrimeAgentSessionPresentation,
	ProjectId,
} from "@prime-agent/web-protocol";
import type { FleetAgentConnection, FleetConnectionEvent } from "./agent-connection-port";
import {
	effectiveRlmChildStatus,
	hasSessionLineage,
	initialPresentationForSession,
	resolveRlmLineage,
	rlmChildStatusOverride,
} from "./bridge-helpers";
import { CoalescingRefreshQueue } from "./coalescing-refresh-queue";
import type { DaemonSessionSummary as SessionSummary } from "./daemon-protocol";
import type { DaemonChildPromptHandle, listDaemonSessions, startDaemonChildPrompt } from "./daemon-runtime";
import {
	applyRlmChildStatusOverrides,
	createEventMapperState,
	mapAgentConnectionEvent,
	type RlmChildStatusOverride,
	toChatMessagesFromAgentMessages,
} from "./event-mapper";
import { readLegacySession } from "./legacy/prime-agent-sdk";
import { loadManagedPrimePresentation } from "./prime-agent-presentation";
import type { BridgeSession } from "./prime-bridge";
import { getPrimeConfig } from "./prime-config";
import type { RingBuffer } from "./ring-buffer";
import { readSessionHeaderId } from "./session-header";

export interface RlmChildTranscript {
	readonly sessionId: string;
	readonly projectId: ProjectId | null;
	readonly messages: Array<ChatMessage>;
	readonly presentation: PrimeAgentSessionPresentation;
}

export interface RlmChildStream {
	readonly sessionId: string;
	readonly projectId: ProjectId | null;
	readonly snapshot: Extract<ChatStreamEvent, { type: "session_snapshot" }>;
	readonly channelId: string;
	readonly streamGeneration: string;
	readonly mode: "live" | "snapshot-only";
	readonly resumeAccepted: boolean;
	readonly cursorReset: boolean;
	readonly replayFrom: number;
	readonly includeSnapshot: boolean;
	release(): Promise<void>;
}

export type RlmChildStreamResume = {
	streamGeneration?: string;
	lastEventId?: number;
};

type AuthorizedRlmChild = {
	parent: BridgeSession;
	child: PrimeAgentRlmChild;
	summary: SessionSummary;
};

type AgentConnectionSessionWatcher = NonNullable<Awaited<ReturnType<FleetAgentConnection["watchSession"]>>>;

type ManagedRlmChildStream = {
	key: string;
	parentSessionId: string;
	childId: string;
	streamSessionId: string;
	canonicalSessionId: string;
	channelId: string;
	streamGeneration: string;
	projectId: ProjectId | null;
	child: PrimeAgentRlmChild;
	summary: SessionSummary;
	watcher: AgentConnectionSessionWatcher;
	mapperState: ReturnType<typeof createEventMapperState>;
	snapshot: Extract<ChatStreamEvent, { type: "session_snapshot" }>;
	replayFrom: number;
	refs: number;
	closed: boolean;
	buffering: boolean;
	bufferedEvents: FleetConnectionEvent[];
	removeWatcherListener: () => void;
	refreshTail: Promise<void>;
};

export class RlmChildStreamManager {
	readonly #streams = new Map<string, ManagedRlmChildStream>();
	readonly #initializations = new Map<string, Promise<ManagedRlmChildStream | undefined>>();
	readonly #metadataRefreshQueue = new CoalescingRefreshQueue();
	readonly #childPrompts = new Map<string, Set<DaemonChildPromptHandle>>();
	readonly #getSession: (sessionId: string) => BridgeSession | undefined;
	readonly #sessionLister: typeof listDaemonSessions;
	readonly #childPromptStarter: typeof startDaemonChildPrompt;
	readonly #ringBufferFor: (channelId: string) => RingBuffer;
	readonly #deleteRingBuffer: (channelId: string) => void;
	readonly #dispatch: (channelId: string, frame: ChatStreamEvent) => void;
	readonly #persistPresentation: (
		sessionId: string,
		sessionPath: string,
		presentation: PrimeAgentSessionPresentation,
	) => void;

	constructor(options: {
		getSession: (sessionId: string) => BridgeSession | undefined;
		sessionLister: typeof listDaemonSessions;
		childPromptStarter: typeof startDaemonChildPrompt;
		ringBufferFor: (channelId: string) => RingBuffer;
		deleteRingBuffer: (channelId: string) => void;
		dispatch: (channelId: string, frame: ChatStreamEvent) => void;
		persistPresentation: (
			sessionId: string,
			sessionPath: string,
			presentation: PrimeAgentSessionPresentation,
		) => void;
	}) {
		this.#getSession = options.getSession;
		this.#sessionLister = options.sessionLister;
		this.#childPromptStarter = options.childPromptStarter;
		this.#ringBufferFor = options.ringBufferFor;
		this.#deleteRingBuffer = options.deleteRingBuffer;
		this.#dispatch = options.dispatch;
		this.#persistPresentation = options.persistPresentation;
	}

	resetForTests(): void {
		for (const stream of this.#streams.values()) {
			stream.closed = true;
			stream.removeWatcherListener();
			void stream.watcher.close().catch(() => undefined);
		}
		this.#streams.clear();
		this.#initializations.clear();
		this.#metadataRefreshQueue.clear();
		this.#childPrompts.clear();
	}

	async closeStreamsForParent(parentSessionId: string): Promise<void> {
		for (const childStream of [...this.#streams.values()]) {
			if (childStream.parentSessionId !== parentSessionId) continue;
			childStream.refs = 0;
			await this.#closeStream(childStream);
		}
	}

	queueMetadataRefresh(rootSessionId: string): void {
		this.#metadataRefreshQueue.request(rootSessionId, () => this.#refreshMetadata(rootSessionId));
	}

	async openStream(
		parentSessionId: string,
		childId: string,
		resume?: RlmChildStreamResume,
	): Promise<RlmChildStream | undefined> {
		const authorized = await this.#findAuthorizedChild(parentSessionId, childId);
		if (!authorized) return undefined;
		const key = `${parentSessionId}:${childId}`;
		const existing = this.#streams.get(key);
		if (existing) {
			existing.refs += 1;
			return this.#publicStream(existing, resume);
		}

		const status = effectiveRlmChildStatus(authorized.child, authorized.summary);
		if (status !== "running" && status !== "recovering") return this.#snapshotOnlyStream(authorized, resume);

		const pending = this.#initializations.get(key);
		if (pending) {
			const stream = await pending;
			if (!stream) return undefined;
			stream.refs += 1;
			return this.#publicStream(stream, resume);
		}

		const initialization = this.#initializeStream(authorized);
		this.#initializations.set(key, initialization);
		try {
			const stream = await initialization;
			if (!stream) return undefined;
			return this.#publicStream(stream, resume);
		} finally {
			if (this.#initializations.get(key) === initialization) {
				this.#initializations.delete(key);
			}
		}
	}

	async loadTranscript(parentSessionId: string, childId: string): Promise<RlmChildTranscript | undefined> {
		const authorized = await this.#findAuthorizedChild(parentSessionId, childId);
		return authorized ? this.#loadAuthorizedTranscript(authorized) : undefined;
	}

	async promptChild(
		parentSessionId: string,
		childId: string,
		text: string,
		streamingBehavior: "steer" | "followUp" = "steer",
	): Promise<{ canonicalSessionId: string; activeSessionId: string }> {
		const authorized = await this.#findAuthorizedChild(parentSessionId, childId);
		if (!authorized) throw new Error(`Unknown subagent thread: ${childId}`);
		const activeSessionId = authorized.summary.activeSessionId ?? authorized.child.activeSessionId;
		if (!activeSessionId) throw new Error(`Subagent thread is not attached: ${childId}`);
		const canonicalSessionId = await this.#persistentSessionId(authorized, activeSessionId);
		if (!canonicalSessionId) throw new Error(`Subagent thread has no persistent session id: ${childId}`);
		const key = `${parentSessionId}:${childId}`;
		const handle = this.#childPromptStarter({
			cwd: authorized.parent.cwd,
			activeSessionId,
			text,
			streamingBehavior,
		});
		const handles = this.#childPrompts.get(key) ?? new Set<DaemonChildPromptHandle>();
		handles.add(handle);
		this.#childPrompts.set(key, handles);
		try {
			await handle.settled;
		} finally {
			handles.delete(handle);
			if (handles.size === 0 && this.#childPrompts.get(key) === handles) this.#childPrompts.delete(key);
		}
		return { canonicalSessionId, activeSessionId };
	}

	async abortChild(parentSessionId: string, childId: string): Promise<boolean> {
		const handle = this.#childPrompts.get(`${parentSessionId}:${childId}`)?.values().next().value;
		if (!handle) return false;
		await handle.abort();
		return true;
	}

	async #findAuthorizedChild(parentSessionId: string, childId: string): Promise<AuthorizedRlmChild | undefined> {
		const parent = this.#getSession(parentSessionId);
		const child = parent?.mapperState.presentation.rlmChildren.find((entry) => entry.id === childId);
		if (!parent || !child) return undefined;

		const sessions = await this.#sessionLister();
		const { sessionsByIdentifier, sessionsByPath, rootIdentifiers, rootPaths } = await resolveRlmLineage(
			sessions,
			parentSessionId,
			parent.sessionPath,
		);
		const summary = sessions.find(
			(candidate) =>
				candidate.rlmChildId === childId &&
				hasSessionLineage(candidate, rootIdentifiers, rootPaths, sessionsByIdentifier, sessionsByPath),
		);
		return summary ? { parent, child, summary } : undefined;
	}

	async #persistentSessionId(
		{ child, summary }: AuthorizedRlmChild,
		...knownRuntimeIds: readonly (string | undefined)[]
	): Promise<string | undefined> {
		const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
		const declaredRuntimeIds = new Set([summary.activeSessionId, child.activeSessionId].filter(nonEmpty));
		if (nonEmpty(summary.sessionId) && !declaredRuntimeIds.has(summary.sessionId)) return summary.sessionId;
		const runtimeIds = new Set([...declaredRuntimeIds, ...knownRuntimeIds.filter(nonEmpty)]);
		const persistent = (value: unknown): value is string => nonEmpty(value) && !runtimeIds.has(value);
		if (summary.sessionFile) {
			const fromFile = await readSessionHeaderId(summary.sessionFile);
			if (persistent(fromFile)) return fromFile;
		}
		if (persistent(summary.id)) return summary.id;
		process.stderr.write(
			`[bridge] RLM child ${child.id}: no persistent session id in the daemon summary; not keying it by the runtime id\n`,
		);
		return undefined;
	}

	async #refreshMetadata(rootSessionId: string): Promise<void> {
		const parent = this.#getSession(rootSessionId);
		if (!parent) return;
		let sessions: SessionSummary[];
		try {
			sessions = await this.#sessionLister();
		} catch {
			for (const child of parent.mapperState.presentation.rlmChildren) {
				parent.mapperState.rlmChildOverrides.delete(child.id);
			}
			for (const frame of applyRlmChildStatusOverrides(parent.mapperState, new Map())) {
				this.#dispatch(rootSessionId, frame);
			}
			return;
		}

		const { sessionsByIdentifier, sessionsByPath, rootIdentifiers, rootPaths } = await resolveRlmLineage(
			sessions,
			rootSessionId,
			parent.sessionPath,
		);

		const overrides = new Map<string, RlmChildStatusOverride>();
		for (const child of parent.mapperState.presentation.rlmChildren) {
			const summary = sessions.find(
				(candidate) =>
					candidate.rlmChildId === child.id &&
					hasSessionLineage(candidate, rootIdentifiers, rootPaths, sessionsByIdentifier, sessionsByPath),
			);
			if (summary) overrides.set(child.id, rlmChildStatusOverride(summary));
			else parent.mapperState.rlmChildOverrides.delete(child.id);
		}
		const frames = applyRlmChildStatusOverrides(parent.mapperState, overrides);
		for (const frame of frames) {
			if (frame.type === "presentation") {
				this.#persistPresentation(rootSessionId, parent.sessionPath, frame.presentation);
			}
			this.#dispatch(rootSessionId, frame);
		}
	}

	#childStreamStatus(
		child: PrimeAgentRlmChild,
		summary?: SessionSummary,
	): Extract<ChatStreamEvent, { type: "session_snapshot" }>["status"] {
		const status = summary ? effectiveRlmChildStatus(child, summary) : child.status;
		if (status === "error" || status === "failed") return "error";
		if (status === "running" || status === "recovering") return "streaming";
		return "ready";
	}

	async #closeStream(stream: ManagedRlmChildStream): Promise<void> {
		if (stream.closed) return;
		stream.closed = true;
		if (this.#streams.get(stream.key) === stream) this.#streams.delete(stream.key);
		stream.buffering = false;
		stream.bufferedEvents.length = 0;
		stream.removeWatcherListener();
		await stream.watcher.close().catch(() => undefined);
		this.#deleteRingBuffer(stream.channelId);
	}

	async #publicStream(stream: ManagedRlmChildStream, resume?: RlmChildStreamResume): Promise<RlmChildStream> {
		const requestedCursor = resume?.lastEventId && resume.lastEventId > 0 ? resume.lastEventId : 0;
		const generationMatches = resume?.streamGeneration === stream.streamGeneration;
		const buffer = this.#ringBufferFor(stream.channelId);
		const latest = buffer.latestSequence();
		const cursorOverflowed =
			generationMatches && requestedCursor > 0 ? buffer.replaySince(requestedCursor).overflowed : false;
		const cursorInRange = requestedCursor === 0 || requestedCursor <= latest;
		const canResume = generationMatches && requestedCursor > 0 && cursorInRange && !cursorOverflowed;

		if (!canResume && !stream.snapshot.terminal && (resume?.streamGeneration !== undefined || requestedCursor > 0)) {
			await this.#refreshSnapshot(stream);
		}

		const refreshedLatest = buffer.latestSequence();
		const includeSnapshot = !canResume || stream.snapshot.terminal === true;
		const cursorReset = (resume?.streamGeneration !== undefined || requestedCursor > 0) && !canResume;
		const replayFrom = canResume ? requestedCursor : stream.snapshot.terminal ? refreshedLatest : stream.replayFrom;

		let released = false;
		return {
			sessionId: stream.canonicalSessionId,
			projectId: stream.projectId,
			snapshot: stream.snapshot,
			channelId: stream.channelId,
			streamGeneration: stream.streamGeneration,
			mode: "live",
			resumeAccepted: canResume,
			cursorReset,
			replayFrom,
			includeSnapshot,
			release: async () => {
				if (released) return;
				released = true;
				stream.refs = Math.max(0, stream.refs - 1);
				if (stream.refs === 0) await this.#closeStream(stream);
			},
		};
	}

	async #refreshSnapshot(stream: ManagedRlmChildStream): Promise<void> {
		if (stream.closed) return;
		stream.buffering = true;
		const previous = stream.refreshTail;
		const next = previous
			.catch(() => undefined)
			.then(async () => {
				if (stream.closed) return;
				const messages = toChatMessagesFromAgentMessages(
					await stream.watcher.getMessages(),
					stream.canonicalSessionId,
				);
				if (stream.closed) return;
				stream.snapshot = {
					...stream.snapshot,
					messages,
					presentation: stream.mapperState.presentation,
				};
				this.#dispatch(stream.channelId, stream.snapshot);
				stream.replayFrom = this.#ringBufferFor(stream.channelId).latestSequence();
			});
		const tracked = next.catch(() => undefined);
		stream.refreshTail = tracked;
		await tracked;
		if (stream.refreshTail === tracked) {
			stream.buffering = false;
			for (const event of stream.bufferedEvents.splice(0)) this.#handleEvent(stream, event);
		}
	}

	#handleEvent(stream: ManagedRlmChildStream, event: FleetConnectionEvent): void {
		if (stream.closed) return;
		if (event.type === "session_event") {
			if (event.event.type === "agent_start" || event.event.type === "turn_start") {
				stream.snapshot = { ...stream.snapshot, status: "streaming", terminal: false };
			}
			if (event.event.type === "agent_end" || event.event.type === "turn_end") {
				stream.snapshot = { ...stream.snapshot, status: "ready" };
			}
		}
		if (event.type === "closed") {
			stream.snapshot = {
				...stream.snapshot,
				status: event.error ? "error" : "ready",
				terminal: true,
			};
		}
		const frames = mapAgentConnectionEvent(stream.mapperState, event);
		for (const frame of frames) {
			if (frame.type === "error") stream.snapshot = { ...stream.snapshot, status: "error" };
			this.#dispatch(stream.channelId, frame);
		}
		if (event.type === "session_event" && event.event.type === "rlm_child_update") {
			this.queueMetadataRefresh(stream.parentSessionId);
		}
		if (
			event.type === "session_replaced" ||
			event.type === "session_resynced" ||
			event.type === "closed" ||
			(event.type === "session_event" && (event.event.type === "agent_end" || event.event.type === "turn_end"))
		) {
			void this.#refreshSnapshot(stream);
		}
	}

	async #loadAuthorizedTranscript(authorized: AuthorizedRlmChild): Promise<RlmChildTranscript | undefined> {
		const { summary: childSummary } = authorized;
		if (!childSummary.sessionFile) return undefined;
		const snapshot = await readLegacySession(childSummary.sessionFile);
		if (!snapshot) return undefined;
		const sessionId = snapshot.sessionId;
		if (sessionId !== childSummary.sessionId && sessionId !== childSummary.id) return undefined;

		const agentMessages = snapshot.messages();
		const messages = toChatMessagesFromAgentMessages(agentMessages, sessionId);
		const persistedPresentation = await loadManagedPrimePresentation({ sessionPath: childSummary.sessionFile });
		const presentation = initialPresentationForSession(
			agentMessages,
			undefined,
			undefined,
			undefined,
			undefined,
			sessionId,
			persistedPresentation,
		);
		const projectId = await getPrimeConfig().projectRegistry.projectIdForSession(sessionId, snapshot.cwd);

		return { sessionId, projectId, messages, presentation };
	}

	async #snapshotOnlyStream(
		authorized: AuthorizedRlmChild,
		resume?: RlmChildStreamResume,
	): Promise<RlmChildStream | undefined> {
		const transcript = await this.#loadAuthorizedTranscript(authorized).catch(() => undefined);
		if (!transcript) return undefined;
		const streamGeneration = crypto.randomUUID();
		const snapshot: Extract<ChatStreamEvent, { type: "session_snapshot" }> = {
			type: "session_snapshot",
			session: { sessionId: transcript.sessionId, projectId: transcript.projectId },
			messages: transcript.messages,
			presentation: transcript.presentation,
			status: this.#childStreamStatus(authorized.child, authorized.summary),
			terminal: true,
		};
		return {
			sessionId: transcript.sessionId,
			projectId: transcript.projectId,
			snapshot,
			channelId: `snapshot:${authorized.parent.sessionId}:${authorized.child.id}:${streamGeneration}`,
			streamGeneration,
			mode: "snapshot-only",
			resumeAccepted: false,
			cursorReset: resume?.streamGeneration !== undefined || (resume?.lastEventId ?? 0) > 0,
			replayFrom: 0,
			includeSnapshot: true,
			release: async () => undefined,
		};
	}

	async #initializeStream(authorized: AuthorizedRlmChild): Promise<ManagedRlmChildStream | undefined> {
		const { child, summary, parent } = authorized;
		const runtimeIds = [
			summary.activeSessionId,
			child.activeSessionId,
			summary.sessionId,
			summary.id,
			child.id,
		].filter((value): value is string => typeof value === "string" && value.length > 0);
		let watcher: AgentConnectionSessionWatcher | undefined;
		let streamSessionId: string | undefined;
		for (const runtimeId of [...new Set(runtimeIds)]) {
			try {
				watcher = await parent.connection.watchSession(runtimeId);
			} catch {
				watcher = undefined;
			}
			if (watcher) {
				streamSessionId = runtimeId;
				break;
			}
		}
		if (!watcher || !streamSessionId) return undefined;

		const pendingEvents: FleetConnectionEvent[] = [];
		let buffering = true;
		let removeWatcherListener: () => void = () => undefined;
		try {
			removeWatcherListener = watcher.subscribe((event) => {
				if (buffering) pendingEvents.push(event);
				else {
					const stream = this.#streams.get(`${parent.sessionId}:${child.id}`);
					if (!stream) return;
					if (stream.buffering) stream.bufferedEvents.push(event);
					else this.#handleEvent(stream, event);
				}
			});

			const canonicalSessionId = await this.#persistentSessionId(authorized, streamSessionId);
			if (!canonicalSessionId) throw new Error("no persistent session id");
			const agentMessages = await watcher.getMessages();
			const persistedPresentation = summary.sessionFile
				? await loadManagedPrimePresentation({ sessionPath: summary.sessionFile })
				: undefined;
			const override = rlmChildStatusOverride(summary);
			const presentation = initialPresentationForSession(
				agentMessages,
				summary.sessionName ?? child.sessionName ?? child.label,
				summary.thinkingLevel as ChatThinkingLevel | undefined,
				undefined,
				child.recap ?? summary.summary,
				canonicalSessionId,
				persistedPresentation,
			);
			const mapperState = createEventMapperState({
				sessionId: canonicalSessionId,
				presentation,
				rlmChildOverrides: new Map([[child.id, override]]),
			});
			const projectId = await getPrimeConfig().projectRegistry.projectIdForSession(canonicalSessionId, summary.cwd);
			const channelId = `child:${parent.sessionId}:${child.id}:${crypto.randomUUID()}`;
			const streamGeneration = this.#ringBufferFor(channelId).streamGeneration;
			const stream: ManagedRlmChildStream = {
				key: `${parent.sessionId}:${child.id}`,
				parentSessionId: parent.sessionId,
				childId: child.id,
				streamSessionId,
				canonicalSessionId,
				channelId,
				streamGeneration,
				projectId,
				child,
				summary,
				watcher,
				mapperState,
				snapshot: {
					type: "session_snapshot",
					session: { sessionId: canonicalSessionId, projectId },
					messages: toChatMessagesFromAgentMessages(agentMessages, canonicalSessionId),
					presentation,
					status: this.#childStreamStatus(child, summary),
				},
				replayFrom: 0,
				refs: 1,
				closed: false,
				buffering: false,
				bufferedEvents: [],
				removeWatcherListener,
				refreshTail: Promise.resolve(),
			};
			this.#streams.set(stream.key, stream);
			this.#ringBufferFor(stream.channelId);
			buffering = false;
			for (const event of pendingEvents.splice(0)) this.#handleEvent(stream, event);
			return stream;
		} catch {
			buffering = false;
			removeWatcherListener();
			await watcher.close().catch(() => undefined);
			return undefined;
		}
	}
}
