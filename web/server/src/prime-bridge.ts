/**
 * PrimeBridge — central server-side session coordinator.
 *
 * Owns:
 * - daemon-backed `AgentConnection` instances (one per session) keyed by
 *   persisted `sessionId`
 * - the web dialog registry and event forwarder (SSE replay source)
 * - Fleet-only presentation sidecars
 *
 * The daemon is the sole active session writer. The bridge is only a headless
 * client of the public `AgentConnection` seam; the in-process adapter is
 * available only through an explicit test factory.
 *
 * No HTTP, no React — pure TypeScript. The route layer calls into this only.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ProjectId } from "@prime-agent/web-protocol";
import {
	buildOpenUIPrompt,
	type ChatMessage,
	type ChatMode,
	type ChatPendingDialog,
	type ChatPlanAction,
	type ChatQuestionAnswer,
	type ChatStreamEvent,
	type ChatThinkingLevel,
	type OpenUIDashboardPrompt,
	type OpenUIPromptMode,
	type PrimeAgentArtifact,
	type PrimeAgentSessionPresentation,
	type SessionTreeSnapshot,
} from "@prime-agent/web-protocol";
import type { AgentSession, ExtensionUIContext } from "prime-agent";
import type { FleetAgentConnection } from "./agent-connection-port";
import {
	type BridgeSessionCache,
	confineSessionExportPath,
	createOpenUIPromptSessionState,
	createWebUIContext,
	emptyCache,
	fallbackSessionPath,
	findSessionTreeEntry,
	initialPresentationForSession,
	isSessionNotInActiveProjectError,
	isSessionNotResumableError,
	isUnresolvedPlaceholderModel,
	type OpenUIPromptSessionState,
	presentationArtifactsEqual,
	refreshCache,
	resolveOpenUIPromptMode,
	SessionExportPathError,
	selectedTextFromSessionEntry,
} from "./bridge-helpers";
import {
	createDaemonWebAgentConnection,
	deleteDaemonSavedSession,
	listDaemonSessions,
	readDaemonModelCatalog,
	sessionDirectoryForCwd,
	startDaemonChildPrompt,
	type WebAgentConnection,
	type WebAgentConnectionFactory,
} from "./daemon-runtime";
import { dashboardPromptContext } from "./dashboards/prompt-context";
import {
	createEventMapperState,
	mapAgentConnectionEvent,
	resyncAfterSequenceGap,
	toChatMessagesFromAgentMessages,
} from "./event-mapper";
import { readLegacySession } from "./legacy/prime-agent-sdk";
import { deleteManagedAttachmentsForSession } from "./managed-attachments";
import {
	copyManagedPlanPresentationsForFork,
	deleteManagedPlanPresentationsForSession,
} from "./managed-plan-presentations";
import { catalogHasModel, firstAvailableModelId, providerAvailability } from "./model-catalog";
import { PendingDialogRegistry } from "./pending-dialogs";
import {
	createEmptyPrimeAgentSessionPresentation,
	deleteManagedPrimePresentationForSession,
	loadManagedPrimePresentation,
	PresentationPersistenceQueue,
	upsertArtifact,
	writeManagedPrimePresentation,
} from "./prime-agent-presentation";
import { getPrimeConfig } from "./prime-config";
import { RingBuffer } from "./ring-buffer";
import {
	RlmChildStreamManager,
	type RlmChildStream,
	type RlmChildStreamResume,
	type RlmChildTranscript,
} from "./rlm-child-stream-manager";
import { parseBackendSessionCommand } from "./session-commands";
import { SessionTreeCancelledError, SessionTreeConcurrencyError } from "./session-tree-errors";
import { mapSessionTreeSnapshot } from "./session-tree-mapper";
import { textFromChatParts } from "./transcript-hydrator";

export { type OpenUIPromptSessionState, type RlmChildStream, type RlmChildTranscript, SessionExportPathError };

// ---------------------------------------------------------------------------
// Bridge types
// ---------------------------------------------------------------------------

export interface BridgeSession {
	readonly sessionId: string;
	readonly projectId: ProjectId | null;
	readonly cwd: string;
	readonly sessionPath: string;
	/**
	 * The only runtime entry point the bridge itself routes through.
	 * Owned by the bridge; do not store references outside the bridge.
	 */
	readonly connection: FleetAgentConnection;
	/** Only populated by the explicit in-process test adapter. */
	readonly session?: AgentSession;
	readonly setOpenUIPrompt?: WebAgentConnection["setOpenUIPrompt"];
	readonly terminate?: WebAgentConnection["terminate"];
	readonly deleteSessionFile?: WebAgentConnection["deleteSessionFile"];
	/** Daemon-backed fork (the daemon `fork` command); absent on the in-process test adapter. */
	readonly forkToNewSession?: WebAgentConnection["forkToNewSession"];
	/** Cached connection state used by synchronous HTTP admission helpers. */
	isStreaming: boolean;
	readonly openUIPrompt: OpenUIPromptSessionState;
	readonly mapperState: ReturnType<typeof createEventMapperState>;
	readonly uiContext: ExtensionUIContext;
	readonly unsubscribe: () => void;
}

export interface CreateSessionOptions {
	readonly cwd: string;
	readonly projectId?: ProjectId | null;
	readonly thinkingLevel?: ThinkingLevel;
	readonly mode?: ChatMode;
	readonly openUI?: boolean;
}

export type BridgeEventListener = (sessionId: string, frame: ChatStreamEvent) => void;

export interface ForkSessionResult {
	cancelled: boolean;
	selectedText?: string;
	newSessionId: string;
}

export interface PrimeBridgeOptions {
	readonly ringBufferCapacity?: number;
	readonly dialogTimeoutMs?: number;
	readonly writePresentation?: typeof writeManagedPrimePresentation;
	/** Test seam; production always uses the shared Prime daemon. */
	readonly connectionFactory?: WebAgentConnectionFactory;
	/** Test seam for session discovery; production always uses the shared daemon. */
	readonly sessionLister?: typeof listDaemonSessions;
	/** Test seam for catalog deletion; production always uses the shared daemon. */
	readonly sessionFileDeleter?: typeof deleteDaemonSavedSession;
	/** Test seam for direct child turns; production attaches to the child session. */
	readonly childPromptStarter?: typeof startDaemonChildPrompt;
}

export interface MainSessionStream {
	readonly sessionId: string;
	readonly streamGeneration: string;
	readonly resumeAccepted: boolean;
	readonly cursorReset: boolean;
	readonly replayFrom: number;
}

// ---------------------------------------------------------------------------
// PrimeBridge
// ---------------------------------------------------------------------------

/**
 * A sequence-gap resync replaces the live `done` with an empty reset frame.
 * The snapshot still holds the assistant message that finished during the gap,
 * so dashboard settlement sees that message here and nowhere else.
 */
function settleRecoveredDashboardMessages(
	listener: ((sessionId: string, messageId: string, content: string) => void) | undefined,
	sessionId: string,
	messages: readonly AgentMessage[],
): void {
	if (!listener) return;
	for (const message of toChatMessagesFromAgentMessages(messages, sessionId)) {
		if (message.role !== "assistant") continue;
		const content = textFromChatParts(message.parts);
		if (!content.includes("openui-dashboard")) continue;
		listener(sessionId, message.id, content);
	}
}

export class PrimeBridge {
	readonly #sessions = new Map<string, BridgeSession>();
	readonly #listeners = new Set<BridgeEventListener>();
	#assistantDoneListener?: (sessionId: string, messageId: string, content: string) => void;
	readonly #ringBuffers = new Map<string, RingBuffer>();
	readonly #rlmChildManager: RlmChildStreamManager;
	readonly #dialogs: PendingDialogRegistry;
	readonly #ringBufferCapacity: number;
	readonly #presentationQueue: PresentationPersistenceQueue;
	readonly #connectionFactory: WebAgentConnectionFactory;
	readonly #sessionLister: typeof listDaemonSessions;
	readonly #sessionFileDeleter: typeof deleteDaemonSavedSession;
	readonly #caches = new Map<string, BridgeSessionCache>();
	readonly #sessionTreeNavigationQueues = new Map<string, Promise<void>>();
	readonly #openUIPromptTransitions = new Map<string, Promise<void>>();

	constructor(options: PrimeBridgeOptions = {}) {
		this.#ringBufferCapacity = options.ringBufferCapacity ?? 500;
		this.#connectionFactory = options.connectionFactory ?? createDaemonWebAgentConnection;
		this.#sessionLister = options.sessionLister ?? listDaemonSessions;
		this.#sessionFileDeleter = options.sessionFileDeleter ?? deleteDaemonSavedSession;
		this.#presentationQueue = new PresentationPersistenceQueue({
			writePresentation: options.writePresentation,
			isCurrentSessionPath: (sessionId, sessionPath) => this.#sessions.get(sessionId)?.sessionPath === sessionPath,
			onWriteWarning: (sessionId) => {
				this.#dispatch(sessionId, {
					type: "state",
					state: {
						name: "agent_start",
						message:
							"Some Fleet session details could not be saved. Your transcript is safe; they will be retried later.",
					},
				});
			},
		});
		this.#rlmChildManager = new RlmChildStreamManager({
			getSession: (sessionId) => this.#sessions.get(sessionId),
			sessionLister: this.#sessionLister,
			childPromptStarter: options.childPromptStarter ?? startDaemonChildPrompt,
			ringBufferFor: (channelId) => this.#ringBufferFor(channelId),
			deleteRingBuffer: (channelId) => {
				this.#ringBuffers.delete(channelId);
			},
			dispatch: (channelId, frame) => this.#dispatch(channelId, frame),
			persistPresentation: (sessionId, sessionPath, presentation) => {
				void this.#presentationQueue.persist(sessionId, sessionPath, presentation);
			},
		});
		this.#dialogs = new PendingDialogRegistry({
			defaultTimeoutMs: options.dialogTimeoutMs ?? 60_000,
			emitFrame: (sessionId, frame) => this.#dispatch(sessionId, frame),
		});
	}

	addEventListener(listener: BridgeEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Called when a finished assistant message contains an `openui-dashboard` fence.
	 * Dashboard settlement registers this. The bridge does not import that module.
	 */
	setAssistantDoneListener(listener: (sessionId: string, messageId: string, content: string) => void): void {
		this.#assistantDoneListener = listener;
	}

	/** Emit a frame to ring buffer (SSE replay) and all live listeners. */
	#dispatch(sessionId: string, frame: ChatStreamEvent): void {
		const next = frame.type === "done" && !(frame.sessionId ?? "").trim() ? { ...frame, sessionId } : frame;
		const buffer = this.#ringBufferFor(sessionId);
		const entry = buffer.push(next, (sequence, generation) => ({
			...next,
			eventCursor: { generation, sequence },
		}));
		const sequenced = entry.event as ChatStreamEvent;
		for (const listener of this.#listeners) {
			listener(sessionId, sequenced);
		}
	}

	#ringBufferFor(sessionId: string): RingBuffer {
		let existing = this.#ringBuffers.get(sessionId);
		if (!existing) {
			existing = new RingBuffer(this.#ringBufferCapacity);
			this.#ringBuffers.set(sessionId, existing);
		}
		return existing;
	}

	/** Replay buffered frames since `lastEventId`. */
	replaySince(
		sessionId: string,
		lastEventId: number,
	): { replayed: readonly { seq: number; event: unknown }[]; overflowed: boolean } {
		const buffer = this.#ringBufferFor(sessionId);
		return buffer.replaySince(lastEventId);
	}

	/**
	 * Resolves stream generation and cursor state for a main-session SSE attach.
	 */
	openSessionStream(sessionId: string, resume?: RlmChildStreamResume): MainSessionStream {
		const buffer = this.#ringBufferFor(sessionId);
		const requestedCursor = resume?.lastEventId && resume.lastEventId > 0 ? resume.lastEventId : 0;
		const generationProvided = resume?.streamGeneration !== undefined;
		const generationMatches = !generationProvided || resume.streamGeneration === buffer.streamGeneration;
		const latest = buffer.latestSequence();
		const cursorOverflowed =
			generationMatches && requestedCursor > 0 ? buffer.replaySince(requestedCursor).overflowed : false;
		const cursorInRange = requestedCursor === 0 || requestedCursor <= latest;
		const canResume = generationMatches && requestedCursor > 0 && cursorInRange && !cursorOverflowed;
		const cursorReset = (generationProvided || requestedCursor > 0) && !canResume;
		const replayFrom = canResume ? requestedCursor : cursorReset ? latest : 0;
		return {
			sessionId,
			streamGeneration: buffer.streamGeneration,
			resumeAccepted: canResume,
			cursorReset,
			replayFrom,
		};
	}

	/** Test-only: reset state. */
	resetForTests(): void {
		this.#rlmChildManager.resetForTests();
		for (const session of this.#sessions.values()) {
			session.unsubscribe();
			void session.connection.dispose().catch(() => undefined);
		}
		this.#sessions.clear();
		this.#listeners.clear();
		this.#assistantDoneListener = undefined;
		this.#ringBuffers.clear();
		this.#presentationQueue.clear();
		this.#caches.clear();
		this.#sessionTreeNavigationQueues.clear();
		this.#openUIPromptTransitions.clear();
	}

	// -----------------------------------------------------------------------
	// Session lifecycle
	// -----------------------------------------------------------------------

	async createSession(options: CreateSessionOptions): Promise<BridgeSession> {
		const webAgent = await this.#connectionFactory({
			cwd: options.cwd,
			openUIPrompt: createOpenUIPromptSessionState(resolveOpenUIPromptMode(options.mode), options.openUI === true),
			...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
		});
		return this.#registerConnection(
			webAgent,
			options.cwd,
			undefined,
			options.projectId ?? (await getPrimeConfig().projectRegistry.projectIdForCwd(options.cwd)),
		);
	}

	/**
	 * Shared registration path for every session the bridge owns (create, resume,
	 * fork). Binds the web UI context, subscribes to `AgentConnectionEvent`,
	 * forwards frames into the ring buffer, and tracks the session in
	 * `#sessions`.
	 */
	async #registerConnection(
		webAgent: WebAgentConnection,
		cwd: string,
		sessionPathHint?: string,
		projectId?: ProjectId | null,
	): Promise<BridgeSession> {
		const { connection, openUIPrompt } = webAgent;
		const state = await connection.getState();
		const sessionId = state.sessionId;
		const sessionCwd = state.cwd || cwd;
		const sessionPath = resolve(state.sessionFile ?? sessionPathHint ?? fallbackSessionPath(state, sessionCwd));
		const resolvedProjectId =
			projectId ?? (await getPrimeConfig().projectRegistry.projectIdForSession(sessionId, sessionCwd));
		await getPrimeConfig().projectRegistry.assignSession(sessionId, resolvedProjectId);
		const uiContext = createWebUIContext({
			sessionId,
			emitFrame: (frame) => this.#dispatch(sessionId, frame),
			dialogs: this.#dialogs,
		});
		await webAgent.bindUiContext?.(uiContext);

		const initialMessages = await connection.getMessages();
		// getMessages() is the committed transcript; a mid-turn attach also has
		// the in-flight assistant message (with its toolCall blocks) only on the
		// snapshot. Seed the mapper's tool cache from both.
		const initialStreamingMessage = await connection
			.getInitialSnapshot()
			.then((snapshot) => snapshot.streamingMessage)
			.catch(() => undefined);
		const seedMessages =
			initialStreamingMessage && !initialMessages.includes(initialStreamingMessage)
				? [...initialMessages, initialStreamingMessage]
				: initialMessages;
		const cache = await refreshCache(connection);
		this.#caches.set(sessionId, cache);
		const persistedPresentation = await loadManagedPrimePresentation({ sessionPath });
		const mapperState = createEventMapperState({
			sessionId,
			presentation: initialPresentationForSession(
				initialMessages,
				cache.sessionName,
				(cache.thinkingLevel ?? "off") as ChatThinkingLevel,
				cache.serviceTier,
				undefined,
				sessionId,
				persistedPresentation,
			),
			initialMessages: seedMessages,
		});

		const emitFrames = (frames: readonly ChatStreamEvent[]): void => {
			for (const frame of frames) {
				if (frame.type === "presentation") {
					void this.#presentationQueue.persist(sessionId, sessionPath, frame.presentation);
				}
				this.#dispatch(sessionId, frame);
			}
		};
		const refreshCacheAfterRebuild = (): void => {
			void refreshCache(connection)
				.then((next) => {
					this.#caches.set(sessionId, next);
					const current = this.#sessions.get(sessionId);
					if (current) current.isStreaming = next.isStreaming;
				})
				.catch(() => undefined);
		};

		const unsubscribeEvents = connection.subscribe((event) => {
			// `extension_ui_request` is absent here by construction: the Rust daemon
			// does not advertise `extension_ui`, and the in-process test adapter
			// binds its UI context directly rather than round-tripping requests.
			if (event.type === "session_event" && event.event.type === "compaction_end") {
				// Compaction rewrites the transcript prefix, shifting the positional
				// `${sessionId}-mN` ids the plan sidecar keys on. Invalidate records
				// rather than let them rebind to unrelated messages.
				void deleteManagedPlanPresentationsForSession(sessionId, sessionPath).catch(() => undefined);
			}
			if (event.type === "session_replaced" || event.type === "session_resynced") {
				// The runtime rebuilt; refresh the cache from the new session state.
				refreshCacheAfterRebuild();
			}
			if (event.type === "session_event") {
				const current = this.#sessions.get(sessionId);
				if (current && (event.event.type === "agent_start" || event.event.type === "turn_start")) {
					current.isStreaming = true;
				} else if (current && (event.event.type === "agent_end" || event.event.type === "turn_end")) {
					current.isStreaming = false;
				}
			}
			if (process.env.PRIME_BRIDGE_DEBUG === "1") {
				try {
					const eventSummary = {
						type: event.type,
						...(event.type === "session_event" ? { sessionEventType: event.event.type } : {}),
					};
					process.stderr.write(`[bridge:${sessionId.slice(0, 8)}] conn-event ${JSON.stringify(eventSummary)}\n`);
				} catch {
					/* ignore */
				}
			}
			if (event.type === "session_resynced") {
				const messages = event.snapshot.messages;
				if (Array.isArray(messages)) {
					settleRecoveredDashboardMessages(this.#assistantDoneListener, sessionId, messages);
				}
			}
			const frames = mapAgentConnectionEvent(mapperState, event);
			emitFrames(frames);
			const done = frames.find((frame) => frame.type === "done" && frame.sessionReset !== true);
			if (done?.type === "done") {
				const content = textFromChatParts(done.message.parts);
				if (content.includes("openui-dashboard")) {
					this.#assistantDoneListener?.(sessionId, done.message.id, content);
				}
			}
			if (
				event.type === "session_resynced" ||
				(event.type === "session_event" && event.event.type === "rlm_child_update")
			) {
				this.#rlmChildManager.queueMetadataRefresh(sessionId);
			}
		});

		// Lost daemon events (meta.sequence gap): fetch a fresh snapshot and
		// resync through the existing session_resynced path (`done` with
		// sessionReset: true). Gaps that arrive while a resync is in flight
		// coalesce into one follow-up resync.
		let gapSubscriptionClosed = false;
		let resyncInFlight = false;
		let resyncPending = false;
		const resyncAfterGap = async (): Promise<void> => {
			if (resyncInFlight) {
				resyncPending = true;
				return;
			}
			resyncInFlight = true;
			try {
				do {
					resyncPending = false;
					let snapshot: Awaited<ReturnType<FleetAgentConnection["getInitialSnapshot"]>>;
					try {
						snapshot = await connection.getInitialSnapshot();
					} catch {
						return;
					}
					if (gapSubscriptionClosed) return;
					emitFrames(resyncAfterSequenceGap(mapperState, snapshot));
					refreshCacheAfterRebuild();
					this.#rlmChildManager.queueMetadataRefresh(sessionId);
				} while (resyncPending && !gapSubscriptionClosed);
			} finally {
				resyncInFlight = false;
			}
		};
		const unsubscribeGaps =
			webAgent.onSequenceGap?.(() => {
				if (gapSubscriptionClosed) return;
				void resyncAfterGap();
			}) ?? (() => undefined);
		const unsubscribe = (): void => {
			gapSubscriptionClosed = true;
			unsubscribeGaps();
			unsubscribeEvents();
		};
		const bridgeSession: BridgeSession = {
			sessionId,
			projectId: resolvedProjectId,
			cwd: sessionCwd,
			sessionPath,
			connection,
			session: webAgent.session,
			setOpenUIPrompt: webAgent.setOpenUIPrompt,
			terminate: webAgent.terminate,
			deleteSessionFile: webAgent.deleteSessionFile,
			...(webAgent.forkToNewSession ? { forkToNewSession: webAgent.forkToNewSession } : {}),
			isStreaming: cache.isStreaming,
			openUIPrompt,
			mapperState,
			uiContext,
			unsubscribe,
		};

		this.#sessions.set(sessionId, bridgeSession);
		this.#ringBufferFor(sessionId); // Pre-create so SSE attaches safely.
		void this.#presentationQueue.persist(sessionId, sessionPath, mapperState.presentation);
		return bridgeSession;
	}

	/** Hot-lookup by id; reuse the live session if we already have one loaded. */
	getSession(sessionId: string): BridgeSession | undefined {
		return this.#sessions.get(sessionId);
	}

	/** Resume a persisted prime-agent session from its JSONL transcript. */
	async resumeSessionByPath(
		sessionPath: string,
		options?: { readonly openUI?: boolean; readonly requestedProjectId?: ProjectId | null },
	): Promise<BridgeSession> {
		const resolvedSessionPath = resolve(sessionPath);
		// If a live session already owns this path, reuse it.
		for (const [sessionId, session] of this.#sessions) {
			if (resolve(session.sessionPath) === resolvedSessionPath) {
				const live = this.#sessions.get(sessionId)!;
				if (options?.requestedProjectId && live.projectId !== options.requestedProjectId) {
					throw new Error("The requested session is not in an active project");
				}
				return live;
			}
		}
		if (!existsSync(resolvedSessionPath)) throw new Error("The requested session transcript is unavailable");
		const transcript = await readLegacySession(resolvedSessionPath);
		if (!transcript) throw new Error("The requested session transcript is unavailable");
		const sessionCwd = transcript.cwd;
		const expectedSessionDir = resolve(sessionDirectoryForCwd(sessionCwd));
		if (dirname(resolvedSessionPath) !== expectedSessionDir) {
			throw new Error("The requested session is outside the configured Prime session store");
		}
		const projectId = await getPrimeConfig().projectRegistry.activeProjectIdForSession(
			transcript.sessionId,
			sessionCwd,
		);
		if (!projectId || (options?.requestedProjectId && projectId !== options.requestedProjectId)) {
			throw new Error("The requested session is not in an active project");
		}
		const webAgent = await this.#connectionFactory({
			cwd: sessionCwd,
			sessionPath: resolvedSessionPath,
			openUIPrompt: createOpenUIPromptSessionState("agent", options?.openUI === true),
		});
		return this.#registerConnection(
			webAgent,
			sessionCwd,
			resolvedSessionPath,
			await getPrimeConfig().projectRegistry.projectIdForSession(transcript.sessionId, sessionCwd),
		);
	}

	async resumeSessionById(
		sessionId: string,
		requestedProjectId?: ProjectId | null,
		options?: { readonly openUI?: boolean },
	): Promise<BridgeSession | undefined> {
		const live = this.#sessions.get(sessionId);
		if (live) {
			// Project-scoped callers only see sessions linked to their project.
			// A linked-but-foreign session is unknown to the caller: reads must
			// never fork or expose its transcript (copies go through the
			// explicit fork action instead).
			if (requestedProjectId && live.projectId !== requestedProjectId) return undefined;
			return live;
		}
		const all = await this.#sessionLister();
		const match = all.find((info) => info.sessionId === sessionId || info.id === sessionId);
		if (!match) return undefined;
		if (!match.sessionFile) return undefined;
		let resumed: BridgeSession;
		try {
			resumed = await this.resumeSessionByPath(match.sessionFile, { ...options, requestedProjectId });
		} catch (error) {
			// A listed transcript the runtime cannot resume is an unknown session
			// for the caller, not a server failure.
			if (isSessionNotInActiveProjectError(error) || isSessionNotResumableError(error)) return undefined;
			throw error;
		}
		if (requestedProjectId && resumed.projectId !== requestedProjectId) return undefined;
		return resumed;
	}

	async listSessions(cwd?: string) {
		return this.#sessionLister(cwd);
	}

	/**
	 * Open a read-only stream for an authorized RLM child. Completed and cold
	 * children use a one-shot snapshot and never resume a runtime session.
	 */
	async openRlmChildStream(
		parentSessionId: string,
		childId: string,
		resume?: RlmChildStreamResume,
	): Promise<RlmChildStream | undefined> {
		return this.#rlmChildManager.openStream(parentSessionId, childId, resume);
	}

	/**
	 * Load a completed RLM child without resuming it as a live session.
	 *
	 * Child transcripts can be stored outside the parent's configured session
	 * directory. Authorization is therefore based on both the live parent's
	 * presentation and the daemon's lineage metadata, never on a browser-
	 * supplied filesystem path.
	 */
	async loadRlmChildTranscript(parentSessionId: string, childId: string): Promise<RlmChildTranscript | undefined> {
		return this.#rlmChildManager.loadTranscript(parentSessionId, childId);
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		let existing = this.#sessions.get(sessionId);
		if (!existing) {
			const sessions = await this.#sessionLister();
			const listed = sessions.find((session) => session.sessionId === sessionId || session.id === sessionId);
			const sessionPath = listed?.sessionFile;
			if (!sessionPath) return false;
			try {
				existing = await this.resumeSessionByPath(sessionPath);
			} catch (error) {
				if (!isSessionNotResumableError(error)) throw error;
				// The transcript is listed but cannot be resumed. Delete it through
				// the daemon catalog so a broken entry never becomes undeletable.
				const result = await this.#sessionFileDeleter(getPrimeConfig().defaultCwd, sessionPath);
				if (!result.ok) throw new Error(result.error);
				// Mirror the managed-session cleanup from the live path below.
				const listedSessionId = listed?.sessionId ?? sessionId;
				await deleteManagedAttachmentsForSession(listedSessionId, sessionPath);
				await deleteManagedPlanPresentationsForSession(listedSessionId, sessionPath);
				await deleteManagedPrimePresentationForSession(sessionPath);
				await getPrimeConfig().projectRegistry.assignSession(listedSessionId, null);
				return true;
			}
		}
		const sessionPath = existing.sessionPath;
		await this.#presentationQueue.cancelAndDrain(existing.sessionId);
		this.#dialogs.cancelAll(existing.sessionId, "server-shutdown");
		await this.#rlmChildManager.closeStreamsForParent(existing.sessionId);
		existing.unsubscribe();
		await existing.connection.abort().catch(() => undefined);
		await this.#openUIPromptTransitions.get(existing.sessionId)?.catch(() => undefined);
		try {
			await existing.terminate?.();
			const result = await (existing.deleteSessionFile?.(sessionPath) ??
				existing.connection.deleteSavedSession(sessionPath));
			if (!result.ok) throw new Error(result.error);
		} finally {
			await existing.connection.dispose().catch(() => undefined);
			this.#sessions.delete(existing.sessionId);
			this.#ringBuffers.delete(existing.sessionId);
			this.#caches.delete(existing.sessionId);
			this.#openUIPromptTransitions.delete(existing.sessionId);
		}
		await deleteManagedAttachmentsForSession(existing.sessionId, sessionPath);
		await deleteManagedPlanPresentationsForSession(existing.sessionId, sessionPath);
		await deleteManagedPrimePresentationForSession(sessionPath);
		await getPrimeConfig().projectRegistry.assignSession(existing.sessionId, null);
		return true;
	}

	// -----------------------------------------------------------------------
	// Session actions
	// -----------------------------------------------------------------------

	async prompt(
		sessionId: string,
		text: string,
		options?: {
			images?: ImageContent[];
			streamingBehavior?: "steer" | "followUp";
			mode?: ChatMode;
			openUI?: boolean;
			openUIArtifact?: boolean;
			planAction?: ChatPlanAction;
		},
	): Promise<void> {
		const session = this.#requireSession(sessionId);
		const backendSessionCommand = parseBackendSessionCommand(text);
		const openUIEnabled = options?.openUI === true;
		const openUIMode = resolveOpenUIPromptMode(options?.mode, options?.planAction);
		const openUIArtifact = options?.openUIArtifact === true;
		const dashboards = await dashboardPromptContext(this.getPresentation(session.sessionId));
		const openUIPromptOptions = {
			artifact: openUIArtifact,
			dashboards,
		};
		const openUIStateChanged =
			session.openUIPrompt.enabled !== openUIEnabled ||
			session.openUIPrompt.mode !== openUIMode ||
			(session.openUIPrompt.artifact ?? false) !== openUIArtifact ||
			// A changed prompt body (new components, functions, or tools) must reach
			// an existing session, not only newly created ones.
			session.openUIPrompt.prompt !== buildOpenUIPrompt(openUIMode, openUIPromptOptions);
		const hasPendingOpenUITransition = this.#openUIPromptTransitions.has(sessionId);
		const wasStreaming = session.isStreaming;
		const promptOptions = {
			images: options?.images,
			streamingBehavior: options?.streamingBehavior,
			queueIfBusy: true,
		};

		if (!wasStreaming && (openUIStateChanged || hasPendingOpenUITransition)) {
			// Preserve the idle ordering: commit the prompt state before admitting
			// the next prompt. The transition queue also waits for an earlier active
			// prompt's safe-boundary reconfiguration.
			await this.#scheduleOpenUIPromptState(session, openUIEnabled, openUIMode, openUIArtifact, dashboards);
		}
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			void (async () => {
				const state = await session.connection.getState().catch(() => undefined);
				process.stderr.write(
					`[bridge:${sessionId.slice(0, 8)}] prompt model=${state?.model?.provider ?? "?"}/${state?.model?.id ?? "?"} thinkingLevel=${state?.thinkingLevel ?? "?"}\n`,
				);
			})();
		}
		// `promptAndWait` mirrors the legacy `session.prompt(...)` semantics:
		// resolves when the turn settles (including any queued session commands).
		// The `queueIfBusy` flag keeps steer/followUp admission behavior
		// identical to the previous bridge. When a prompt is already streaming,
		// admit it before waiting for the OpenUI transition; the transition then
		// runs at the next safe idle boundary.
		let promptError: unknown;
		let promptFailed = false;
		try {
			await session.connection.promptAndWait(text, promptOptions);
			// For a session command (e.g. /refine) queued behind an active turn, wait
			// until input is idle so the HTTP stream can emit its terminal frame
			// after the command has actually run.
			if (backendSessionCommand) await session.connection.waitForIdle();
		} catch (error) {
			promptFailed = true;
			promptError = error;
		}
		if (wasStreaming && (openUIStateChanged || hasPendingOpenUITransition)) {
			await this.#scheduleOpenUIPromptState(session, openUIEnabled, openUIMode, openUIArtifact, dashboards);
		}
		if (promptFailed) throw promptError;
	}

	#scheduleOpenUIPromptState(
		session: BridgeSession,
		enabled: boolean,
		mode: OpenUIPromptMode,
		artifact: boolean,
		dashboards?: OpenUIDashboardPrompt,
	): Promise<void> {
		const previous = this.#openUIPromptTransitions.get(session.sessionId) ?? Promise.resolve();
		const transition = previous
			.catch(() => undefined)
			.then(() => this.#setOpenUIPromptState(session, enabled, mode, artifact, dashboards));
		this.#openUIPromptTransitions.set(session.sessionId, transition);
		void transition
			.finally(() => {
				if (this.#openUIPromptTransitions.get(session.sessionId) === transition) {
					this.#openUIPromptTransitions.delete(session.sessionId);
				}
			})
			.catch(() => undefined);
		return transition;
	}

	async #setOpenUIPromptState(
		session: BridgeSession,
		enabled: boolean,
		mode: OpenUIPromptMode,
		artifact = false,
		dashboards?: OpenUIDashboardPrompt,
	): Promise<void> {
		const previousPrompt = session.openUIPrompt.prompt;
		const nextPrompt = buildOpenUIPrompt(mode, { artifact, dashboards });
		// The prompt text is compared as well as the flags: `buildOpenUIPrompt`
		// changes whenever the component catalog or tool surface changes, and a
		// session must pick that up instead of keeping the prompt it was born with.
		if (
			session.openUIPrompt.enabled === enabled &&
			session.openUIPrompt.mode === mode &&
			(session.openUIPrompt.artifact ?? false) === artifact &&
			previousPrompt === nextPrompt
		)
			return;
		const nextState: OpenUIPromptSessionState = { enabled, mode, artifact, prompt: nextPrompt };
		if (session.setOpenUIPrompt) {
			await session.setOpenUIPrompt(nextState);
			const cache = this.#caches.get(session.sessionId) ?? emptyCache();
			const withoutPreviousPrompt = cache.systemPrompt.replace(previousPrompt, "").trim();
			cache.systemPrompt = enabled
				? `${withoutPreviousPrompt}${withoutPreviousPrompt ? "\n\n" : ""}${nextPrompt}`
				: withoutPreviousPrompt;
			this.#caches.set(session.sessionId, cache);
		} else if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			process.stderr.write(
				`[bridge:${session.sessionId.slice(0, 8)}] OpenUI prompt state changed but this connection cannot update prompts after creation; recreate the session to apply it\n`,
			);
		}
		session.openUIPrompt.enabled = enabled;
		session.openUIPrompt.mode = mode;
		session.openUIPrompt.artifact = artifact;
		session.openUIPrompt.prompt = nextPrompt;
	}

	async mutateQueuedMessage(
		sessionId: string,
		lane: "steering" | "followUp",
		index: number,
		expectedText: string,
		mutation: { type: "delete" } | { type: "replace"; text: string; lane?: "steering" | "followUp" },
	): Promise<{
		status: "applied" | "rejected" | "invalid" | "unsupported";
		queue: { steering: string[]; followUp: string[] };
	}> {
		const session = this.#requireSession(sessionId);
		const upstreamMutation =
			mutation.type === "delete"
				? { type: "delete" as const }
				: {
						type: "replace" as const,
						text: mutation.text,
						lane: mutation.lane ?? lane,
					};
		const status = await session.connection.mutateQueuedMessage(lane, index, expectedText, upstreamMutation);
		const queue = await session.connection.getQueue();
		return {
			status,
			queue: {
				steering: [...queue.steering],
				followUp: [...queue.followUp],
			},
		};
	}

	async abort(sessionId: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		this.#dialogs.cancelAll(sessionId, "user-abort");
		await session.connection.abort();
	}

	/**
	 * Prompt an RLM child session directly, mirroring how the upstream agents
	 * view attaches to any agent row for an interactive turn. The borrowed
	 * connection is disposed when the turn settles; live frames reach open
	 * tabs through the child's managed watcher stream, which observes the
	 * same session. Throws when the child is unknown to this parent.
	 */
	async promptRlmChild(
		parentSessionId: string,
		childId: string,
		text: string,
		streamingBehavior: "steer" | "followUp" = "steer",
	): Promise<{ canonicalSessionId: string; activeSessionId: string }> {
		return this.#rlmChildManager.promptChild(parentSessionId, childId, text, streamingBehavior);
	}

	/**
	 * Abort the in-flight direct turn for an RLM child, if any.
	 * Returns false when no child turn is active (parent-driven turns are
	 * owned by the parent tab, not the child tab).
	 */
	async abortRlmChild(parentSessionId: string, childId: string): Promise<boolean> {
		return this.#rlmChildManager.abortChild(parentSessionId, childId);
	}

	async setModel(
		sessionId: string,
		model: { provider: string; id: string },
	): Promise<{ provider: string; id: string }> {
		const session = this.#requireSession(sessionId);
		// Resolution is catalog-sourced and therefore async: the daemon owns the
		// model list, and Fleet reads it through its cached snapshot.
		//
		// A failure here is logged, not swallowed silently: it covers both an
		// unreachable daemon and a `get_model_catalog` response that fails the
		// protocol guard, and the second case would otherwise disable the stale-id
		// fallback below forever with no trace — while `/api/chat/models` returns a
		// 500 for the very same cause. Behaviour is unchanged; only observability.
		const catalog = await readDaemonModelCatalog(session.cwd).catch((error: unknown) => {
			process.stderr.write(
				`[bridge:${sessionId.slice(0, 8)}] model catalog unavailable, passing ${model.provider}/${model.id} through: ${
					error instanceof Error ? error.message : String(error)
				}\n`,
			);
			return undefined;
		});
		if (!catalog) {
			// The catalog could not be read. Today's failure mode for this case is
			// the connection's own error, not `Unknown model`, so hand the request
			// to the connection unchanged rather than reporting a missing model.
			await session.connection.setModel(model.provider, model.id);
			return { provider: model.provider, id: model.id };
		}
		if (catalogHasModel(catalog, model.provider, model.id)) {
			await session.connection.setModel(model.provider, model.id);
			return { provider: model.provider, id: model.id };
		}
		// Stale persisted default (e.g. a catalog id removed upstream): when the
		// provider itself still resolves available models, fall back to its first
		// available model instead of failing the turn. Unknown providers still
		// throw: that signals missing credentials, not a stale id.
		const isProviderAvailable = await providerAvailability(getPrimeConfig().agentDir);
		const fallback = firstAvailableModelId(catalog, isProviderAvailable, model.provider);
		if (!fallback) throw new Error(`Unknown model: ${model.provider}/${model.id}`);
		process.stderr.write(
			`[bridge:${sessionId.slice(0, 8)}] model fallback ${model.provider}/${model.id} -> ${model.provider}/${fallback}\n`,
		);
		await session.connection.setModel(model.provider, fallback);
		return { provider: model.provider, id: fallback };
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await Promise.all([...this.#sessions.values()].map((session) => session.connection.setThinkingLevel(level)));
	}

	// -----------------------------------------------------------------------
	// Dialog answering
	// -----------------------------------------------------------------------

	/**
	 * Resolve a pending `ExtensionUIContext` dialog. Returns true iff the
	 * `toolCallId` was registered and answered.
	 */
	answerDialog(sessionId: string, toolCallId: string, answer: ChatQuestionAnswer): boolean {
		if (answer.kind === "skip") {
			return this.#dialogs.cancel(sessionId, toolCallId, "user-abort");
		}
		if (answer.kind === "questions" && answer.answers) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				answers: answer.answers,
			});
		}
		if (answer.kind === "single" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choice: answer.selectedIds[0],
			});
		}
		if (answer.kind === "multi" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choices: answer.selectedIds,
				choice: answer.selectedIds[0],
			});
		}
		if (answer.kind === "text" && typeof answer.text === "string") {
			return this.#dialogs.answer(sessionId, toolCallId, { text: answer.text });
		}
		// Unknown shape → reject so the agent loop sees a cancelled dialog.
		return this.#dialogs.cancel(sessionId, toolCallId, "user-abort");
	}

	pendingDialogsFor(sessionId: string): readonly ChatPendingDialog[] {
		return this.#dialogs.snapshot(sessionId);
	}

	// -----------------------------------------------------------------------
	// Slash-command surface (TUI parity)
	// -----------------------------------------------------------------------

	/** /context — context-window usage for the session's current branch. */
	getContextUsage(sessionId: string): unknown {
		this.#requireSession(sessionId);
		return this.#caches.get(sessionId)?.contextUsage;
	}

	/** /system-prompt — the exact system prompt sent to the model for the active turn. */
	getSystemPrompt(sessionId: string): string {
		this.#requireSession(sessionId);
		const cached = this.#caches.get(sessionId)?.systemPrompt;
		return cached ?? "";
	}

	/** /name — set or show the session display name. */
	setSessionName(sessionId: string, name: string | undefined): void {
		const session = this.#requireSession(sessionId);
		if (!name) return;
		const cache = this.#caches.get(sessionId) ?? emptyCache();
		cache.sessionName = name;
		this.#caches.set(sessionId, cache);
		void session.connection.setSessionName(name).catch(() => undefined);
	}

	getSessionName(sessionId: string): string | undefined {
		this.#requireSession(sessionId);
		return this.#caches.get(sessionId)?.sessionName;
	}

	/** /export — write the session to HTML (default) or JSONL (path ends with .jsonl). */
	async exportSession(sessionId: string, outputPath?: string): Promise<{ path: string; format: "html" | "jsonl" }> {
		const session = this.#requireSession(sessionId);
		const confinedPath = await confineSessionExportPath(session.connection, outputPath);
		if (outputPath?.endsWith(".jsonl")) {
			const path = await session.connection.exportToJsonl(confinedPath);
			return { path, format: "jsonl" };
		}
		const path = await session.connection.exportToHtml(confinedPath);
		return { path, format: "html" };
	}

	/** /reload — re-scan keybindings, extensions, skills, prompts, themes. */
	async reloadResources(_sessionId?: string): Promise<void> {
		await Promise.all([...this.#sessions.values()].map((session) => session.connection.reload?.()));
	}

	/** /tree — session-tree navigation via navigateTree (requires entry id). */
	async navigateTree(sessionId: string, targetId: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await this.#withSessionTreeNavigationLock(sessionId, async () => {
			await session.connection.waitForIdle();
			await session.connection.navigateTree(targetId, {});
			await this.#refreshSessionTreeCache(sessionId, session.connection);
			// Hydrated message ids are positional (${sessionId}-mN): branch navigation
			// rewrites the transcript branch, so any existing plan records now point at
			// unrelated messages. Invalidate instead of rendering the wrong card.
			await deleteManagedPlanPresentationsForSession(sessionId, session.sessionPath);
		});
	}

	/** /tree — the session's entry tree plus the current leaf, for pickers. */
	getSessionTree(sessionId: string): { tree: unknown[]; leafId: string | null } {
		this.#requireSession(sessionId);
		const cached = this.#caches.get(sessionId)?.tree;
		if (cached) return cached;
		return { tree: [], leafId: null };
	}

	async #refreshSessionTreeCache(sessionId: string, connection: FleetAgentConnection): Promise<void> {
		const tree = await connection.getSessionTree();
		const cache = this.#caches.get(sessionId) ?? emptyCache();
		cache.tree = { tree: tree.tree as unknown[], leafId: tree.leafId };
		this.#caches.set(sessionId, cache);
	}

	async #withSessionTreeNavigationLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.#sessionTreeNavigationQueues.get(sessionId) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(operation);
		const tail = current.then(
			() => undefined,
			() => undefined,
		);
		this.#sessionTreeNavigationQueues.set(sessionId, tail);
		void tail.then(() => {
			if (this.#sessionTreeNavigationQueues.get(sessionId) === tail) {
				this.#sessionTreeNavigationQueues.delete(sessionId);
			}
		});
		return current;
	}

	/** Reads a browser-safe session tree snapshot from the live connection. */
	async readSessionTreeSnapshot(sessionId: string): Promise<SessionTreeSnapshot> {
		const session = this.#requireSession(sessionId);
		await this.#refreshSessionTreeCache(sessionId, session.connection);
		const cached = this.getSessionTree(sessionId);
		return mapSessionTreeSnapshot(sessionId, cached.tree, cached.leafId);
	}

	/** Navigates the live session tree and returns the authoritative browser-safe snapshot. */
	async navigateSessionTree(
		sessionId: string,
		targetEntryId: string,
		expectedLeafId?: string,
	): Promise<SessionTreeSnapshot> {
		const session = this.#requireSession(sessionId);
		return this.#withSessionTreeNavigationLock(sessionId, async () => {
			await session.connection.waitForIdle();
			const before = await session.connection.getSessionTree();
			if (expectedLeafId && before.leafId !== expectedLeafId) {
				throw new SessionTreeConcurrencyError();
			}
			const navigation = await session.connection.navigateTree(targetEntryId, {});
			if (navigation.cancelled) {
				throw new SessionTreeCancelledError();
			}
			await deleteManagedPlanPresentationsForSession(sessionId, session.sessionPath);
			return this.readSessionTreeSnapshot(sessionId);
		});
	}

	/**
	 * /fork and /clone — branch the session at `entryId` into a NEW live session.
	 *
	 * Mirrors `AgentSessionRuntime.fork` (agent-session-runtime.ts) minus the
	 * runtime-specific teardown: the TUI replaces its session in-slot, while the
	 * bridge keeps the SOURCE session running in `#sessions` and registers the
	 * fork alongside it under its fresh id.
	 *
	 * The fork flow:
	 *   1. Resolve the source entry (parent for `before`, target for `at`) and
	 *      pre-compute the user-message text for `position: "before"`.
	 *   2. The daemon writes the branched transcript using `forkToNewSession`.
	 *   3. Open a new connection on the fork and carry the source's
	 *      model/thinking/service-tier.
	 */
	async forkSession(
		sessionId: string,
		entryId: string,
		position: "before" | "at" = "before",
	): Promise<ForkSessionResult> {
		const bridge = this.#requireSession(sessionId);
		await bridge.connection.waitForIdle();
		const sourceState = await bridge.connection.getState();
		const selectedEntry = findSessionTreeEntry((await bridge.connection.getSessionTree()).tree, entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}
		let selectedText: string | undefined;
		if (position === "before") {
			selectedText = selectedTextFromSessionEntry(selectedEntry);
			if (selectedText === undefined) {
				throw new Error("Invalid entry ID for forking");
			}
		}

		const currentFile = sourceState.sessionFile;
		if (!currentFile) {
			throw new Error("Cannot fork an unpersisted session");
		}

		if (!bridge.forkToNewSession) throw new Error("Forking is unavailable without a Prime Agent daemon connection");
		const forked = await bridge.forkToNewSession(entryId, position);
		if (forked.cancelled) throw new Error("The Prime Agent daemon cancelled the fork");
		const forkedPath = forked.sessionPath;
		selectedText = forked.selectedText ?? selectedText;
		if (!forkedPath) throw new Error("Failed to create forked session");

		const webAgent = await this.#connectionFactory({
			cwd: bridge.cwd,
			sessionPath: forkedPath,
			thinkingLevel: sourceState.thinkingLevel,
			openUIPrompt: createOpenUIPromptSessionState(
				bridge.openUIPrompt.mode,
				bridge.openUIPrompt.enabled,
				bridge.openUIPrompt.artifact ?? false,
			),
		});
		// Carry the source session's model/thinking/service-tier over so the fork
		// doesn't silently fall back to defaults (provider/settings may differ).
		if (sourceState.model && !isUnresolvedPlaceholderModel(sourceState.model)) {
			await webAgent.connection.setModel(sourceState.model.provider, sourceState.model.id);
		}
		await webAgent.connection.setThinkingLevel(sourceState.thinkingLevel);
		await webAgent.connection.setServiceTier(sourceState.serviceTier ?? "default");

		const forkedBridge = await this.#registerConnection(webAgent, bridge.cwd, forkedPath, bridge.projectId);
		const forkedMessages = await this.getMessages(forkedBridge.sessionId);
		await copyManagedPlanPresentationsForFork(bridge, forkedBridge, forkedMessages.length);
		return {
			cancelled: false,
			selectedText,
			newSessionId: forkedBridge.sessionId,
		};
	}

	/** The stock daemon cannot safely fork a transcript into another project. */
	async forkSessionIntoProject(_sessionId: string, _targetProjectId: ProjectId): Promise<string> {
		const error = new Error(
			"Forking into another project is unavailable with this Prime Agent runtime. The original session is unchanged.",
		);
		throw Object.assign(error, { status: 501 });
	}

	// -----------------------------------------------------------------------
	// Message hydration (for /session eager-load on the client)
	// -----------------------------------------------------------------------

	/** Reads message history from a live session, or from the JSONL transcript for a cold session. */
	async getMessages(sessionId: string): Promise<readonly ChatMessage[]> {
		const live = this.#sessions.get(sessionId);
		const messages: readonly AgentMessage[] = live
			? await live.connection.getMessages()
			: await this.#loadColdMessages(sessionId);
		return toChatMessagesFromAgentMessages(messages, sessionId);
	}

	getPresentation(sessionId: string): PrimeAgentSessionPresentation {
		return this.#sessions.get(sessionId)?.mapperState.presentation ?? createEmptyPrimeAgentSessionPresentation();
	}

	/**
	 * Add or replace one durable presentation artifact. The deterministic id is
	 * supplied by the handler, so retries of the same artifact are idempotent.
	 */
	async upsertPresentationArtifact(
		sessionId: string,
		artifact: PrimeAgentArtifact,
	): Promise<PrimeAgentSessionPresentation> {
		const session = this.#requireSession(sessionId);
		const current = session.mapperState.presentation;
		const existing = current.artifactRuns
			.flatMap((run) => run.artifacts)
			.find((candidate) => candidate.id === artifact.id);
		if (existing && presentationArtifactsEqual(existing, artifact)) return current;

		const next = {
			...upsertArtifact(current, artifact),
			revision: current.revision + 1,
		};
		session.mapperState.presentation = next;
		await this.#presentationQueue.persist(sessionId, session.sessionPath, next);
		this.#dispatch(sessionId, { type: "presentation", sessionId, presentation: next });
		return next;
	}

	async #loadColdMessages(sessionId: string): Promise<readonly AgentMessage[]> {
		const all = await this.#sessionLister();
		const match = all.find((info) => info.sessionId === sessionId || info.id === sessionId);
		if (!match?.sessionFile) return [];
		return (await readLegacySession(match.sessionFile))?.messages() ?? [];
	}

	#requireSession(sessionId: string): BridgeSession {
		const session = this.#sessions.get(sessionId);
		if (!session) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		return session;
	}
}
