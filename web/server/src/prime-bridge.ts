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
	type OpenUIPromptMode,
	type PrimeAgentArtifact,
	type PrimeAgentRlmChild,
	type PrimeAgentSessionPresentation,
	type SessionTreeSnapshot,
} from "@prime-agent/web-protocol";
import type {
	AgentConnection,
	AgentConnectionEvent,
	AgentConnectionExtensionUiRequest,
	AgentSession,
	ExtensionUIContext,
} from "prime-agent";
import { SessionManager } from "prime-agent";
import {
	type BridgeSessionCache,
	confineSessionExportPath,
	createOpenUIPromptSessionState,
	createWebUIContext,
	effectiveRlmChildStatus,
	emptyCache,
	fallbackSessionPath,
	findSessionTreeEntry,
	hasSessionLineage,
	initialPresentationForSession,
	isSessionNotResumableError,
	isUnresolvedPlaceholderModel,
	type OpenUIPromptSessionState,
	presentationArtifactsEqual,
	refreshCache,
	resolveOpenUIPromptMode,
	resolveRlmLineage,
	rlmChildStatusOverride,
	SessionExportPathError,
	selectedTextFromSessionEntry,
} from "./bridge-helpers";
import { CoalescingRefreshQueue } from "./coalescing-refresh-queue";
import type { DaemonSessionSummary as SessionSummary } from "./daemon-protocol";
import {
	createDaemonWebAgentConnection,
	type DaemonChildPromptHandle,
	deleteDaemonSavedSession,
	listDaemonSessions,
	sessionDirectoryForCwd,
	startDaemonChildPrompt,
	type WebAgentConnection,
	type WebAgentConnectionFactory,
} from "./daemon-runtime";
import {
	applyRlmChildStatusOverrides,
	createEventMapperState,
	mapAgentConnectionEvent,
	normalizeDaemonQuestions,
	normalizedQuestionsToClarification,
	normalizedQuestionsToWire,
	type RlmChildStatusOverride,
	resyncAfterSequenceGap,
	toChatMessagesFromAgentMessages,
} from "./event-mapper";
import { readLegacySession } from "./legacy/prime-agent-sdk";
import { deleteManagedAttachmentsForSession } from "./managed-attachments";
import {
	copyManagedPlanPresentationsForFork,
	deleteManagedPlanPresentationsForSession,
} from "./managed-plan-presentations";
import { PendingDialogRegistry } from "./pending-dialogs";
import {
	createEmptyPrimeAgentSessionPresentation,
	deleteManagedPrimePresentationForSession,
	loadManagedPrimePresentation,
	upsertArtifact,
	writeManagedPrimePresentation,
} from "./prime-agent-presentation";
import { getPrimeConfig } from "./prime-config";
import { RingBuffer } from "./ring-buffer";
import { parseBackendSessionCommand } from "./session-commands";
import { readSessionHeaderId } from "./session-header";
import { SessionTreeCancelledError, SessionTreeConcurrencyError } from "./session-tree-errors";
import { mapSessionTreeSnapshot } from "./session-tree-mapper";

export { type OpenUIPromptSessionState, SessionExportPathError };

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
	readonly connection: AgentConnection;
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

type AuthorizedRlmChild = {
	parent: BridgeSession;
	child: PrimeAgentRlmChild;
	summary: SessionSummary;
};

type AgentConnectionSessionWatcher = NonNullable<Awaited<ReturnType<AgentConnection["watchSession"]>>>;

type RlmChildStreamResume = {
	streamGeneration?: string;
	lastEventId?: number;
};

export interface MainSessionStream {
	readonly sessionId: string;
	readonly streamGeneration: string;
	readonly resumeAccepted: boolean;
	readonly cursorReset: boolean;
	readonly replayFrom: number;
}

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
	bufferedEvents: AgentConnectionEvent[];
	removeWatcherListener: () => void;
	refreshTail: Promise<void>;
};

// ---------------------------------------------------------------------------
// PrimeBridge
// ---------------------------------------------------------------------------

export class PrimeBridge {
	readonly #sessions = new Map<string, BridgeSession>();
	readonly #listeners = new Set<BridgeEventListener>();
	readonly #ringBuffers = new Map<string, RingBuffer>();
	readonly #rlmChildStreams = new Map<string, ManagedRlmChildStream>();
	readonly #rlmChildStreamInitializations = new Map<string, Promise<ManagedRlmChildStream | undefined>>();
	readonly #rlmChildMetadataRefreshQueue = new CoalescingRefreshQueue();
	readonly #dialogs: PendingDialogRegistry;
	readonly #ringBufferCapacity: number;
	readonly #presentationWrites = new Map<string, Promise<void>>();
	readonly #presentationGenerations = new Map<string, number>();
	readonly #writePresentation: typeof writeManagedPrimePresentation;
	readonly #connectionFactory: WebAgentConnectionFactory;
	readonly #sessionLister: typeof listDaemonSessions;
	readonly #sessionFileDeleter: typeof deleteDaemonSavedSession;
	readonly #childPromptStarter: typeof startDaemonChildPrompt;
	readonly #childPrompts = new Map<string, Set<DaemonChildPromptHandle>>();
	readonly #caches = new Map<string, BridgeSessionCache>();
	readonly #sessionTreeNavigationQueues = new Map<string, Promise<void>>();
	readonly #openUIPromptTransitions = new Map<string, Promise<void>>();
	readonly #daemonDialogs = new Map<string, { connection: AgentConnection; method: string }>();
	readonly #auxiliaryWarnings = new Set<string>();

	constructor(options: PrimeBridgeOptions = {}) {
		this.#ringBufferCapacity = options.ringBufferCapacity ?? 500;
		this.#writePresentation = options.writePresentation ?? writeManagedPrimePresentation;
		this.#connectionFactory = options.connectionFactory ?? createDaemonWebAgentConnection;
		this.#sessionLister = options.sessionLister ?? listDaemonSessions;
		this.#sessionFileDeleter = options.sessionFileDeleter ?? deleteDaemonSavedSession;
		this.#childPromptStarter = options.childPromptStarter ?? startDaemonChildPrompt;
		this.#dialogs = new PendingDialogRegistry({
			defaultTimeoutMs: options.dialogTimeoutMs ?? 60_000,
			emitFrame: (sessionId, frame) => this.#dispatch(sessionId, frame),
		});
	}

	addEventListener(listener: BridgeEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
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
		for (const stream of this.#rlmChildStreams.values()) {
			stream.closed = true;
			stream.removeWatcherListener();
			void stream.watcher.close().catch(() => undefined);
		}
		this.#rlmChildStreams.clear();
		this.#rlmChildStreamInitializations.clear();
		this.#rlmChildMetadataRefreshQueue.clear();
		for (const session of this.#sessions.values()) {
			session.unsubscribe();
			void session.connection.dispose().catch(() => undefined);
		}
		this.#sessions.clear();
		this.#listeners.clear();
		this.#ringBuffers.clear();
		this.#presentationWrites.clear();
		this.#presentationGenerations.clear();
		this.#caches.clear();
		this.#sessionTreeNavigationQueues.clear();
		this.#openUIPromptTransitions.clear();
		this.#daemonDialogs.clear();
		this.#auxiliaryWarnings.clear();
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

	#handleDaemonExtensionUiRequest(
		sessionId: string,
		connection: AgentConnection,
		request: AgentConnectionExtensionUiRequest,
	): boolean {
		const title = typeof request.payload.title === "string" ? request.payload.title : "Prime Agent asks";
		const timeoutMs = typeof request.payload.timeout === "number" ? request.payload.timeout : undefined;
		const options = Array.isArray(request.payload.options)
			? request.payload.options.filter((option): option is string => typeof option === "string")
			: undefined;
		const message = typeof request.payload.message === "string" ? request.payload.message : "";
		const placeholder =
			typeof request.payload.placeholder === "string"
				? request.payload.placeholder
				: typeof request.payload.prefill === "string"
					? request.payload.prefill
					: undefined;

		if (request.method === "notify") {
			this.#dispatch(sessionId, {
				type: "state",
				state: {
					name: "agent_start",
					message: message || title,
				},
			});
			return true;
		}
		if (request.method === "setStatus") {
			this.#dispatch(sessionId, {
				type: "state",
				state: {
					name: "agent_start",
					message: `[${typeof request.payload.statusKey === "string" ? request.payload.statusKey : "status"}] ${typeof request.payload.statusText === "string" ? request.payload.statusText : ""}`,
				},
			});
			return true;
		}

		const normalizedQuestions = normalizeDaemonQuestions(request.payload.questions);
		const registryQuestions = normalizedQuestionsToClarification(normalizedQuestions);
		const wireQuestions = normalizedQuestionsToWire(normalizedQuestions);

		const hasQuestions =
			request.method === "questions" ||
			request.method === "ask_question" ||
			Boolean(registryQuestions && registryQuestions.length > 0);

		if (
			!hasQuestions &&
			request.method !== "select" &&
			request.method !== "confirm" &&
			request.method !== "input" &&
			request.method !== "editor"
		) {
			return false;
		}

		const kind = hasQuestions
			? "questions"
			: request.method === "select"
				? "select"
				: request.method === "confirm"
					? "confirm"
					: "input";
		this.#daemonDialogs.set(request.id, { connection, method: request.method });
		const pending = this.#dialogs.open<unknown>({
			sessionId,
			toolCallId: request.id,
			kind,
			title,
			message,
			...(options ? { options } : {}),
			...(registryQuestions ? { questions: registryQuestions } : {}),
			...(placeholder ? { placeholder } : {}),
			...(timeoutMs !== undefined ? { timeoutMs } : {}),
			signalFrame: {
				type: "tool-Question",
				toolCallId: request.id,
				state: "input-streaming",
				input: {
					kind: hasQuestions
						? "questions"
						: request.method === "select"
							? "select"
							: request.method === "confirm"
								? "confirm"
								: "text",
					title,
					...(message ? { message } : {}),
					...(options ? { options } : {}),
					...(wireQuestions ? { questions: wireQuestions } : {}),
					...(placeholder ? { placeholder } : {}),
					method: request.method,
				},
			},
		});
		void pending
			.then((value) => {
				if (request.method === "confirm") {
					return connection.respondToExtensionUiRequest(request.id, { confirmed: Boolean(value) });
				}
				if (hasQuestions) {
					if (value && typeof value === "object") {
						return connection.respondToExtensionUiRequest(request.id, {
							value: JSON.stringify(value),
						});
					}
					return connection.respondToExtensionUiRequest(request.id, {
						value: typeof value === "string" ? value : "",
					});
				}
				const text =
					value && typeof value === "object" && "choice" in value
						? (value as { choice?: unknown }).choice
						: value && typeof value === "object" && "choices" in value
							? (value as { choices?: unknown }).choices
							: value && typeof value === "object" && "text" in value
								? (value as { text?: unknown }).text
								: undefined;
				return connection.respondToExtensionUiRequest(request.id, {
					value: typeof text === "string" ? text : Array.isArray(text) ? text.join(",") : "",
				});
			})
			.catch(() => connection.respondToExtensionUiRequest(request.id, { cancelled: true }).catch(() => undefined))
			.finally(() => this.#daemonDialogs.delete(request.id));
		return true;
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
				if (frame.type === "presentation") this.#persistPresentation(sessionId, sessionPath, frame.presentation);
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
			if (event.type === "extension_ui_request" && !webAgent.bindUiContext) {
				if (this.#handleDaemonExtensionUiRequest(sessionId, connection, event.request)) return;
			}
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
			emitFrames(mapAgentConnectionEvent(mapperState, event));
			if (
				event.type === "session_resynced" ||
				(event.type === "session_event" && event.event.type === "rlm_child_update")
			) {
				this.#queueRlmChildMetadataRefresh(sessionId);
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
					let snapshot: Awaited<ReturnType<AgentConnection["getInitialSnapshot"]>>;
					try {
						snapshot = await connection.getInitialSnapshot();
					} catch {
						return;
					}
					if (gapSubscriptionClosed) return;
					emitFrames(resyncAfterSequenceGap(mapperState, snapshot));
					refreshCacheAfterRebuild();
					this.#queueRlmChildMetadataRefresh(sessionId);
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
		this.#persistPresentation(sessionId, sessionPath, mapperState.presentation);
		return bridgeSession;
	}

	#persistPresentation(
		sessionId: string,
		sessionPath: string,
		presentation: PrimeAgentSessionPresentation,
	): Promise<void> {
		const generation = this.#presentationGenerations.get(sessionId) ?? 0;
		const previous = this.#presentationWrites.get(sessionId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(() => {
				const live = this.#sessions.get(sessionId);
				if (
					live?.sessionPath !== sessionPath ||
					(this.#presentationGenerations.get(sessionId) ?? 0) !== generation
				) {
					return;
				}
				return this.#writePresentation({ sessionPath }, presentation);
			})
			.catch(() => {
				if (this.#auxiliaryWarnings.has(sessionId)) return;
				this.#auxiliaryWarnings.add(sessionId);
				this.#dispatch(sessionId, {
					type: "state",
					state: {
						name: "agent_start",
						message:
							"Some Fleet session details could not be saved. Your transcript is safe; they will be retried later.",
					},
				});
			});
		this.#presentationWrites.set(sessionId, next);
		void next.finally(() => {
			if (this.#presentationWrites.get(sessionId) === next) this.#presentationWrites.delete(sessionId);
		});
		return next;
	}

	/** Hot-lookup by id; reuse the live session if we already have one loaded. */
	getSession(sessionId: string): BridgeSession | undefined {
		return this.#sessions.get(sessionId);
	}

	/** Resume a persisted prime-agent session from its JSONL transcript. */
	async resumeSessionByPath(sessionPath: string, options?: { readonly openUI?: boolean }): Promise<BridgeSession> {
		const resolvedSessionPath = resolve(sessionPath);
		// If a live session already owns this path, reuse it.
		for (const [sessionId, session] of this.#sessions) {
			if (resolve(session.sessionPath) === resolvedSessionPath) {
				return this.#sessions.get(sessionId)!;
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
			resumed = await this.resumeSessionByPath(match.sessionFile, options);
		} catch (error) {
			// A listed transcript the runtime cannot resume is an unknown session
			// for the caller, not a server failure.
			if (isSessionNotResumableError(error)) return undefined;
			throw error;
		}
		if (requestedProjectId && resumed.projectId !== requestedProjectId) return undefined;
		return resumed;
	}

	async listSessions(cwd?: string) {
		return this.#sessionLister(cwd);
	}

	async #findAuthorizedRlmChild(parentSessionId: string, childId: string): Promise<AuthorizedRlmChild | undefined> {
		const parent = this.#sessions.get(parentSessionId);
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

	/**
	 * Fleet's persistent session id for an RLM child: the stable key across
	 * daemon `session_binding` re-points (which only change `activeSessionId`).
	 * Daemon runtime ids are never returned: the summary's `id` *is* the
	 * runtime id for active sessions (v0.9.8 summaryForActiveSession and the
	 * Rust list), so it only counts when it differs from every known runtime id.
	 * Order: summary.sessionId, the session file header, then summary.id.
	 * Returns undefined (caller skips the stream / rejects the prompt and logs)
	 * when nothing persistent is resolvable.
	 */
	async #persistentRlmChildSessionId(
		{ child, summary }: AuthorizedRlmChild,
		...knownRuntimeIds: readonly (string | undefined)[]
	): Promise<string | undefined> {
		const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;
		const declaredRuntimeIds = new Set([summary.activeSessionId, child.activeSessionId].filter(nonEmpty));
		// The daemon's own sessionId field is authoritative unless it is a declared
		// runtime id. The id we happened to watch through (which may be the
		// persistent id on runtimes that accept it) is only excluded below.
		if (nonEmpty(summary.sessionId) && !declaredRuntimeIds.has(summary.sessionId)) return summary.sessionId;
		const runtimeIds = new Set([...declaredRuntimeIds, ...knownRuntimeIds.filter(nonEmpty)]);
		const persistent = (value: unknown): value is string => nonEmpty(value) && !runtimeIds.has(value);
		if (summary.sessionFile) {
			// Read-only header read: SessionManager.openAsync may repair or rewrite the file.
			const fromFile = await readSessionHeaderId(summary.sessionFile);
			if (persistent(fromFile)) return fromFile;
		}
		if (persistent(summary.id)) return summary.id;
		process.stderr.write(
			`[bridge] RLM child ${child.id}: no persistent session id in the daemon summary; not keying it by the runtime id\n`,
		);
		return undefined;
	}

	#queueRlmChildMetadataRefresh(rootSessionId: string): void {
		this.#rlmChildMetadataRefreshQueue.request(rootSessionId, () => this.#refreshRlmChildMetadata(rootSessionId));
	}

	async #refreshRlmChildMetadata(rootSessionId: string): Promise<void> {
		const parent = this.#sessions.get(rootSessionId);
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

	async #closeRlmChildStream(stream: ManagedRlmChildStream): Promise<void> {
		if (stream.closed) return;
		stream.closed = true;
		if (this.#rlmChildStreams.get(stream.key) === stream) this.#rlmChildStreams.delete(stream.key);
		stream.buffering = false;
		stream.bufferedEvents.length = 0;
		stream.removeWatcherListener();
		await stream.watcher.close().catch(() => undefined);
		this.#ringBuffers.delete(stream.channelId);
	}

	async #publicRlmChildStream(stream: ManagedRlmChildStream, resume?: RlmChildStreamResume): Promise<RlmChildStream> {
		const requestedCursor = resume?.lastEventId && resume.lastEventId > 0 ? resume.lastEventId : 0;
		const generationMatches = resume?.streamGeneration === stream.streamGeneration;
		const buffer = this.#ringBufferFor(stream.channelId);
		const latest = buffer.latestSequence();
		const cursorOverflowed =
			generationMatches && requestedCursor > 0 ? buffer.replaySince(requestedCursor).overflowed : false;
		const cursorInRange = requestedCursor === 0 || requestedCursor <= latest;
		const canResume = generationMatches && requestedCursor > 0 && cursorInRange && !cursorOverflowed;

		if (!canResume && !stream.snapshot.terminal && (resume?.streamGeneration !== undefined || requestedCursor > 0)) {
			await this.#refreshRlmChildSnapshot(stream);
		}

		const refreshedLatest = buffer.latestSequence();
		const includeSnapshot = !canResume || stream.snapshot.terminal === true;
		const cursorReset = (resume?.streamGeneration !== undefined || requestedCursor > 0) && !canResume;
		const replayFrom = canResume ? requestedCursor : stream.snapshot.terminal ? refreshedLatest : stream.replayFrom;

		let released = false;
		return {
			// Fleet's persistent id, never the daemon runtime id (streamSessionId).
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
				if (stream.refs === 0) await this.#closeRlmChildStream(stream);
			},
		};
	}

	async #refreshRlmChildSnapshot(stream: ManagedRlmChildStream): Promise<void> {
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
			for (const event of stream.bufferedEvents.splice(0)) this.#handleRlmChildEvent(stream, event);
		}
	}

	#queueRlmChildSnapshot(stream: ManagedRlmChildStream): void {
		void this.#refreshRlmChildSnapshot(stream);
	}

	#handleRlmChildEvent(stream: ManagedRlmChildStream, event: AgentConnectionEvent): void {
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
			this.#queueRlmChildMetadataRefresh(stream.parentSessionId);
		}
		if (
			event.type === "session_replaced" ||
			event.type === "session_resynced" ||
			event.type === "closed" ||
			(event.type === "session_event" && (event.event.type === "agent_end" || event.event.type === "turn_end"))
		) {
			this.#queueRlmChildSnapshot(stream);
		}
	}

	async #loadAuthorizedRlmChildTranscript(authorized: AuthorizedRlmChild): Promise<RlmChildTranscript | undefined> {
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

	async #snapshotOnlyRlmChildStream(
		authorized: AuthorizedRlmChild,
		resume?: RlmChildStreamResume,
	): Promise<RlmChildStream | undefined> {
		const transcript = await this.#loadAuthorizedRlmChildTranscript(authorized).catch(() => undefined);
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

	async #initializeRlmChildStream(authorized: AuthorizedRlmChild): Promise<ManagedRlmChildStream | undefined> {
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

		const pendingEvents: AgentConnectionEvent[] = [];
		let buffering = true;
		let removeWatcherListener: () => void = () => undefined;
		try {
			removeWatcherListener = watcher.subscribe((event) => {
				if (buffering) pendingEvents.push(event);
				else {
					const stream = this.#rlmChildStreams.get(`${parent.sessionId}:${child.id}`);
					if (!stream) return;
					if (stream.buffering) stream.bufferedEvents.push(event);
					else this.#handleRlmChildEvent(stream, event);
				}
			});

			const canonicalSessionId = await this.#persistentRlmChildSessionId(authorized, streamSessionId);
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
			this.#rlmChildStreams.set(stream.key, stream);
			this.#ringBufferFor(stream.channelId);
			buffering = false;
			for (const event of pendingEvents.splice(0)) this.#handleRlmChildEvent(stream, event);
			return stream;
		} catch {
			buffering = false;
			removeWatcherListener();
			await watcher.close().catch(() => undefined);
			return undefined;
		}
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
		const authorized = await this.#findAuthorizedRlmChild(parentSessionId, childId);
		if (!authorized) return undefined;
		const key = `${parentSessionId}:${childId}`;
		const existing = this.#rlmChildStreams.get(key);
		if (existing) {
			existing.refs += 1;
			return this.#publicRlmChildStream(existing, resume);
		}

		const status = effectiveRlmChildStatus(authorized.child, authorized.summary);
		if (status !== "running" && status !== "recovering") return this.#snapshotOnlyRlmChildStream(authorized, resume);

		const pending = this.#rlmChildStreamInitializations.get(key);
		if (pending) {
			const stream = await pending;
			if (!stream) return undefined;
			stream.refs += 1;
			return this.#publicRlmChildStream(stream, resume);
		}

		const initialization = this.#initializeRlmChildStream(authorized);
		this.#rlmChildStreamInitializations.set(key, initialization);
		try {
			const stream = await initialization;
			if (!stream) return undefined;
			return this.#publicRlmChildStream(stream, resume);
		} finally {
			if (this.#rlmChildStreamInitializations.get(key) === initialization) {
				this.#rlmChildStreamInitializations.delete(key);
			}
		}
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
		const authorized = await this.#findAuthorizedRlmChild(parentSessionId, childId);
		return authorized ? this.#loadAuthorizedRlmChildTranscript(authorized) : undefined;
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
		this.#presentationGenerations.set(
			existing.sessionId,
			(this.#presentationGenerations.get(existing.sessionId) ?? 0) + 1,
		);
		const pendingPresentationWrite = this.#presentationWrites.get(existing.sessionId);
		await pendingPresentationWrite?.catch(() => undefined);
		if (this.#presentationWrites.get(existing.sessionId) === pendingPresentationWrite) {
			this.#presentationWrites.delete(existing.sessionId);
		}
		this.#dialogs.cancelAll(existing.sessionId, "server-shutdown");
		for (const childStream of [...this.#rlmChildStreams.values()]) {
			if (childStream.parentSessionId !== existing.sessionId) continue;
			childStream.refs = 0;
			await this.#closeRlmChildStream(childStream);
		}
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
			this.#presentationGenerations.delete(existing.sessionId);
			this.#auxiliaryWarnings.delete(existing.sessionId);
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
		const openUIStateChanged =
			session.openUIPrompt.enabled !== openUIEnabled ||
			session.openUIPrompt.mode !== openUIMode ||
			(session.openUIPrompt.artifact ?? false) !== openUIArtifact;
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
			await this.#scheduleOpenUIPromptState(session, openUIEnabled, openUIMode, openUIArtifact);
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
			await this.#scheduleOpenUIPromptState(session, openUIEnabled, openUIMode, openUIArtifact);
		}
		if (promptFailed) throw promptError;
	}

	#scheduleOpenUIPromptState(
		session: BridgeSession,
		enabled: boolean,
		mode: OpenUIPromptMode,
		artifact: boolean,
	): Promise<void> {
		const previous = this.#openUIPromptTransitions.get(session.sessionId) ?? Promise.resolve();
		const transition = previous
			.catch(() => undefined)
			.then(() => this.#setOpenUIPromptState(session, enabled, mode, artifact));
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
	): Promise<void> {
		if (
			session.openUIPrompt.enabled === enabled &&
			session.openUIPrompt.mode === mode &&
			(session.openUIPrompt.artifact ?? false) === artifact
		)
			return;
		const previousPrompt = session.openUIPrompt.prompt;
		const nextPrompt = buildOpenUIPrompt(mode, { artifact });
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
		const authorized = await this.#findAuthorizedRlmChild(parentSessionId, childId);
		if (!authorized) throw new Error(`Unknown subagent thread: ${childId}`);
		const activeSessionId = authorized.summary.activeSessionId ?? authorized.child.activeSessionId;
		if (!activeSessionId) throw new Error(`Subagent thread is not attached: ${childId}`);
		const canonicalSessionId = await this.#persistentRlmChildSessionId(authorized, activeSessionId);
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

	/**
	 * Abort the in-flight direct turn for an RLM child, if any.
	 * Returns false when no child turn is active (parent-driven turns are
	 * owned by the parent tab, not the child tab).
	 */
	async abortRlmChild(parentSessionId: string, childId: string): Promise<boolean> {
		const handle = this.#childPrompts.get(`${parentSessionId}:${childId}`)?.values().next().value;
		if (!handle) return false;
		await handle.abort();
		return true;
	}

	async setModel(
		sessionId: string,
		model: { provider: string; id: string },
	): Promise<{ provider: string; id: string }> {
		const session = this.#requireSession(sessionId);
		const resolved = getPrimeConfig().modelRegistry.find(model.provider, model.id);
		if (resolved) {
			await session.connection.setModel(model.provider, model.id);
			return { provider: model.provider, id: model.id };
		}
		// Stale persisted default (e.g. a catalog id removed upstream): when the
		// provider itself still resolves available models, fall back to its first
		// available model instead of failing the turn. Unknown providers still
		// throw: that signals missing credentials, not a stale id.
		const fallback = getPrimeConfig()
			.modelRegistry.getAvailable()
			.find((candidate) => candidate.provider === model.provider);
		if (!fallback) throw new Error(`Unknown model: ${model.provider}/${model.id}`);
		process.stderr.write(
			`[bridge:${sessionId.slice(0, 8)}] model fallback ${model.provider}/${model.id} -> ${fallback.provider}/${fallback.id}\n`,
		);
		await session.connection.setModel(fallback.provider, fallback.id);
		return { provider: fallback.provider, id: fallback.id };
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

	async #refreshSessionTreeCache(sessionId: string, connection: AgentConnection): Promise<void> {
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
	 *   2. Daemon-backed sessions run the daemon `fork` command, which writes the
	 *      branched transcript; the source reopens in its own worker
	 *      (`forkToNewSession`). The in-process test adapter instead writes the
	 *      branch with a side `SessionManager`.
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
		let targetLeafId: string | null;
		let selectedText: string | undefined;
		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			selectedText = selectedTextFromSessionEntry(selectedEntry);
			if (selectedText === undefined) {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
		}

		const currentFile = sourceState.sessionFile;
		if (!currentFile) {
			throw new Error("Cannot fork an unpersisted session");
		}

		let forkedPath: string | undefined;
		if (bridge.forkToNewSession) {
			// Daemon-backed sessions fork through the daemon `fork` command; the
			// daemon writes the fork transcript and Fleet only opens it.
			const forked = await bridge.forkToNewSession(entryId, position);
			if (forked.cancelled) throw new Error("The Prime Agent daemon cancelled the fork");
			forkedPath = forked.sessionPath;
			selectedText = forked.selectedText ?? selectedText;
		} else {
			forkedPath = await this.#forkWithSideSessionManager(bridge, currentFile, sourceState.sessionDir, targetLeafId);
		}
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

	/**
	 * Legacy fork for the in-process test adapter (no daemon): a side
	 * `SessionManager` writes the branched transcript before the new
	 * connection opens it. Daemon-backed sessions use `forkToNewSession`.
	 */
	async #forkWithSideSessionManager(
		bridge: BridgeSession,
		currentFile: string,
		sourceSessionDir: string | undefined,
		targetLeafId: string | null,
	): Promise<string> {
		const sessionDir = sourceSessionDir ?? dirname(currentFile);
		let side: SessionManager;
		let forkedPath: string | undefined;
		if (targetLeafId) {
			// The side manager only creates the new transcript; the source remains
			// exclusively owned by its runtime.
			side = SessionManager.open(currentFile, sessionDir);
			forkedPath = side.createBranchedSession(targetLeafId) ?? undefined;
			if (!forkedPath) {
				throw new Error("Failed to create forked session");
			}
		} else {
			side = SessionManager.create(bridge.cwd, sessionDir);
			const sourceHeader = await bridge.connection.getSessionHeader();
			side.newSession({
				parentSession: currentFile,
				...(sourceHeader?.rlmDepth !== undefined ? { rlmDepth: sourceHeader.rlmDepth } : {}),
			});
			forkedPath = side.getSessionFile();
		}
		if (!forkedPath) throw new Error("Failed to create forked session");
		// The runtime becomes the sole writer once it opens the target. This initial
		// materialization makes a user-only fork durable before that handoff.
		side.flushNow();
		return forkedPath;
	}

	/** Fork the complete persisted history into another registered project. */
	async forkSessionIntoProject(sessionId: string, targetProjectId: ProjectId): Promise<string> {
		// Verify the caller's target project is still registered before touching
		// the source session, so an unknown target fails without resuming or
		// re-assigning anything as a side effect.
		const targetCwd = await getPrimeConfig().projectRegistry.cwdForProject(targetProjectId);
		const source = this.#sessions.get(sessionId) ?? (await this.resumeSessionById(sessionId));
		if (!source) throw new Error(`Unknown session: ${sessionId}`);
		await source.connection.waitForIdle();
		const sourceState = await source.connection.getState();
		const sourcePath = sourceState.sessionFile;
		if (!sourcePath) throw new Error("Cannot fork an unpersisted session");
		const targetSessionDir = sessionDirectoryForCwd(targetCwd);
		const manager = SessionManager.forkFrom(sourcePath, targetCwd, targetSessionDir);
		const forkedPath = manager.getSessionFile();
		if (!forkedPath) throw new Error("Failed to create project fork");
		const webAgent = await this.#connectionFactory({
			cwd: targetCwd,
			sessionPath: forkedPath,
			thinkingLevel: sourceState.thinkingLevel,
			openUIPrompt: createOpenUIPromptSessionState(
				source.openUIPrompt.mode,
				source.openUIPrompt.enabled,
				source.openUIPrompt.artifact ?? false,
			),
		});
		if (sourceState.model && !isUnresolvedPlaceholderModel(sourceState.model)) {
			await webAgent.connection.setModel(sourceState.model.provider, sourceState.model.id);
		}
		await webAgent.connection.setThinkingLevel(sourceState.thinkingLevel);
		await webAgent.connection.setServiceTier(sourceState.serviceTier ?? "default");
		const forked = await this.#registerConnection(webAgent, targetCwd, forkedPath, targetProjectId);
		const forkedMessages = await this.getMessages(forked.sessionId);
		await copyManagedPlanPresentationsForFork(source, forked, forkedMessages.length);
		forked.mapperState.presentation = source.mapperState.presentation;
		this.#persistPresentation(forked.sessionId, forked.sessionPath, forked.mapperState.presentation);
		// Postcondition: the forked session record must be linked to the
		// caller's target project.
		return this.#requireProjectSession(forked.sessionId, targetProjectId).sessionId;
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
		await this.#persistPresentation(sessionId, session.sessionPath, next);
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

	/**
	 * Project-membership gate over the bridge's session records. Returns the
	 * live session only when its project linkage matches the caller-asserted
	 * project, and throws `Unknown session` otherwise so foreign sessions are
	 * indistinguishable from missing ones.
	 */
	#requireProjectSession(sessionId: string, projectId: ProjectId): BridgeSession {
		const session = this.#requireSession(sessionId);
		if (session.projectId !== projectId) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		return session;
	}
}
