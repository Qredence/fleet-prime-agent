import type {
	ChatMode,
	ChatModelSelection,
	ChatSessionInfo,
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import { ChatStreamEventCursorSchema, ChatStreamEventDecodeSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { createReconnectingEventSource, createSseCursorStore } from "@/hooks/chat/chat-sse";
import type { SendMessageInput } from "@/hooks/chat/use-pi-chat";
import type { ChatClient } from "@/lib/chat/chat-client";
import { notifyChatError } from "@/lib/chat/chat-error-notify";
import { ChatStreamContractError, chatErrorFromStreamEvent, type QueueState } from "@/lib/chat/chat-fetch";
import {
	createOptimisticUserMessage,
	removeOptimisticUserMessage,
	settleOptimisticUserMessage,
} from "@/lib/chat/chat-helpers";
import { buildChatEventsUrl } from "@/lib/chat/chat-runtime-url";
import { applyChatStreamEvent, EMPTY_QUEUE_STATE, type ChatStreamRecoveryState } from "@/lib/chat/chat-stream-state";
import { tryRecoverForbiddenSession, tryRecoverUnknownSession } from "@/lib/chat/forbidden-session-recovery";
import { hydratePlanPresentationMessages } from "@/lib/chat/plan-presentation";

type SessionEventsOptions = {
	client: ChatClient;
	recoveryRef?: MutableRefObject<ChatStreamRecoveryState>;
	presentationRef: MutableRefObject<PrimeAgentSessionPresentation>;
	sessionId?: string;
	sessionMetadataRef: MutableRefObject<ChatSessionMetadata>;
	setActivityLabelSynced: (label: string | undefined) => void;
	setAdapterCapabilities: (capabilities: FleetAdapterCapabilities | undefined) => void;
	setMessagesSynced: (updater: Array<ChatMessage> | ((current: Array<ChatMessage>) => Array<ChatMessage>)) => void;
	setPresentationSynced: (presentation: PrimeAgentSessionPresentation) => void;
	setQueueSynced: (queue: QueueState) => void;
	setSessionMetadataSynced: (metadata: ChatSessionMetadata) => void;
	statusRef: MutableRefObject<ChatStatus>;
	queueRef?: MutableRefObject<QueueState>;
};

/**
 * Manages the visible chat session's SSE connection, event resume cursor, state synchronization, reconnection, and cleanup.
 *
 * @param options - Session event handling dependencies and state setters.
 */
export function usePiChatSessionEvents({
	client,
	recoveryRef,
	presentationRef,
	sessionId,
	sessionMetadataRef,
	setActivityLabelSynced,
	setAdapterCapabilities,
	setMessagesSynced,
	setPresentationSynced,
	setQueueSynced,
	setSessionMetadataSynced,
	statusRef,
	queueRef: queueRefProp,
}: SessionEventsOptions) {
	const internalRecoveryRef = useRef<ChatStreamRecoveryState>({ active: false, needsSnapshot: false });
	const internalQueueRef = useRef<QueueState>(EMPTY_QUEUE_STATE);
	const queueRef = queueRefProp ?? internalQueueRef;
	const activeRecoveryRef = recoveryRef ?? internalRecoveryRef;
	useEffect(() => {
		if (!sessionId || typeof window === "undefined") return;
		if (!activeRecoveryRef.current.active && activeRecoveryRef.current.sessionId !== sessionId) {
			activeRecoveryRef.current.sessionId = sessionId;
			activeRecoveryRef.current.cursor = undefined;
			activeRecoveryRef.current.needsSnapshot = false;
		}

		const sseCapabilitiesRef = { current: undefined as FleetAdapterCapabilities | undefined };
		const cursorStore = createSseCursorStore({
			key: `pi:sse:last-event-id:${sessionId}`,
			allowLegacyInteger: true,
		});
		const initialCursor = cursorStore.current();
		if (!activeRecoveryRef.current.cursor && initialCursor.generation) {
			activeRecoveryRef.current.cursor = {
				generation: initialCursor.generation,
				sequence: initialCursor.lastEventId,
			};
		}

		let reconnectNoticeShown = false;
		let lastAppliedRlmSeq = 0;
		let closedByEffect = false;
		let activeAssistantId: string | undefined;
		let pendingResync: { sequence?: number; generation?: string } | undefined;
		let resyncTimer: ReturnType<typeof setTimeout> | undefined;
		const retryResync = () => {
			resyncTimer = setTimeout(() => {
				void loadResync();
			}, 2_000);
		};
		const loadResync = async () => {
			const pending = pendingResync;
			if (!pending || closedByEffect) return;
			try {
				const generation = cursorStore.current().generation;
				const result = await client.loadSession({ sessionId });
				if (closedByEffect || sessionMetadataRef.current.sessionId !== sessionId || pendingResync !== pending)
					return;
				if (
					cursorStore.current().generation !== generation ||
					statusRef.current === "streaming" ||
					statusRef.current === "submitted"
				) {
					retryResync();
					return;
				}
				setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
				setPresentationSynced(result.presentation);
				setSessionMetadataSynced(result.session);
				queueRef.current = EMPTY_QUEUE_STATE;
				setQueueSynced(EMPTY_QUEUE_STATE);
				if (pending.sequence !== undefined && cursorStore.current().generation === pending.generation) {
					cursorStore.persist(pending.sequence, pending.generation);
					if (pending.generation)
						activeRecoveryRef.current.cursor = { generation: pending.generation, sequence: pending.sequence };
				}
				pendingResync = undefined;
				// Replay frames received while the canonical snapshot was loading.
				subscription.reconnectNow();
			} catch {
				if (!closedByEffect && pendingResync === pending) retryResync();
			}
		};

		const clearReconnectNotice = () => {
			if (!reconnectNoticeShown) return;
			reconnectNoticeShown = false;
			if (statusRef.current !== "streaming" && statusRef.current !== "submitted") {
				setActivityLabelSynced(undefined);
			}
		};

		const handleEvent = (parsed: unknown, seq: number | undefined) => {
			if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "connected") {
				const connected = parsed as {
					adapterCapabilities?: FleetAdapterCapabilities;
					cursorReset?: boolean;
					streamGeneration?: string;
				};
				sseCapabilitiesRef.current = connected.adapterCapabilities;
				setAdapterCapabilities(connected.adapterCapabilities);
				if (typeof connected.streamGeneration === "string" && connected.streamGeneration.length > 0) {
					if (
						activeRecoveryRef.current.active &&
						activeRecoveryRef.current.cursor &&
						activeRecoveryRef.current.cursor.generation !== connected.streamGeneration
					) {
						activeRecoveryRef.current.needsSnapshot = true;
					} else if (
						!activeRecoveryRef.current.cursor ||
						activeRecoveryRef.current.cursor.generation !== connected.streamGeneration
					) {
						activeRecoveryRef.current.cursor = {
							generation: connected.streamGeneration,
							sequence: connected.cursorReset ? 0 : cursorStore.current().lastEventId,
						};
					}
					cursorStore.setGeneration(connected.streamGeneration);
				}
				if (connected.cursorReset) {
					lastAppliedRlmSeq = 0;
					if (activeRecoveryRef.current.active) activeRecoveryRef.current.needsSnapshot = true;
					else {
						cursorStore.reset();
						const generation = cursorStore.current().generation;
						if (generation) {
							activeRecoveryRef.current.cursor = { generation, sequence: 0 };
						}
					}
				}
				if (activeRecoveryRef.current.active && !activeRecoveryRef.current.needsSnapshot) {
					setActivityLabelSynced(undefined);
				}
				return;
			}
			if (pendingResync) return;
			const validation = ChatStreamEventDecodeSchema.safeParse(parsed);
			if (!validation.success) {
				const recovery = activeRecoveryRef.current;
				if (
					recovery.active &&
					recovery.sessionId === sessionId &&
					!recovery.needsSnapshot &&
					typeof parsed === "object" &&
					parsed !== null &&
					"type" in parsed &&
					(parsed.type === "reasoning" || parsed.type === "reasoning_text")
				) {
					const cursorResult = ChatStreamEventCursorSchema.safeParse(
						"eventCursor" in parsed ? parsed.eventCursor : null,
					);
					const appliedCursor = recovery.cursor;
					const cursor = cursorResult.success ? cursorResult.data : undefined;
					if (
						cursor &&
						appliedCursor?.generation === cursor.generation &&
						cursor.sequence === appliedCursor.sequence + 1
					) {
						// Reasoning has its own transcript channel. Drop this malformed
						// reasoning frame, but keep the replay boundary so valid text and
						// tool events later in the same run remain visible.
						recovery.cursor = cursor;
						cursorStore.persist(cursor.sequence, cursor.generation);
					} else if (
						cursor &&
						appliedCursor?.generation === cursor.generation &&
						cursor.sequence <= appliedCursor.sequence
					) {
						return;
					} else {
						recovery.needsSnapshot = true;
					}
				} else if (recovery.active) {
					recovery.needsSnapshot = true;
				}
				return;
			}
			const frame: ChatStreamEvent = validation.data;
			if (activeRecoveryRef.current.active && activeRecoveryRef.current.sessionId === sessionId) {
				const cursor = frame.eventCursor;
				if (!cursor || !activeRecoveryRef.current.applyEvent || activeRecoveryRef.current.needsSnapshot) {
					activeRecoveryRef.current.needsSnapshot = true;
					return;
				}
				const appliedCursor = activeRecoveryRef.current.cursor;
				if (appliedCursor && appliedCursor.generation !== cursor.generation) {
					activeRecoveryRef.current.needsSnapshot = true;
					return;
				}
				if (appliedCursor && cursor.sequence <= appliedCursor.sequence) return;
				if (appliedCursor && cursor.sequence !== appliedCursor.sequence + 1) {
					activeRecoveryRef.current.needsSnapshot = true;
					return;
				}
				try {
					activeRecoveryRef.current.applyEvent?.(frame);
					activeRecoveryRef.current.cursor = cursor;
					cursorStore.persist(cursor.sequence, cursor.generation);
					if (reconnectNoticeShown) {
						reconnectNoticeShown = false;
						setActivityLabelSynced(undefined);
					}
				} catch {
					activeRecoveryRef.current.needsSnapshot = true;
				}
				return;
			}
			if (frame.type === "start") activeAssistantId = frame.id;
			if (frame.type === "done") activeAssistantId = undefined;
			const ownsTurn = statusRef.current === "streaming" || statusRef.current === "submitted";
			const questionDuringTurn = frame.type === "tool" && frame.part.type === "tool-Question";
			const visibleWhileStreaming = frame.type === "presentation" || frame.type === "rlm" || questionDuringTurn;
			if (ownsTurn && !visibleWhileStreaming) return;
			if (frame.type === "rlm" && seq !== undefined) {
				if (seq <= lastAppliedRlmSeq) return;
				lastAppliedRlmSeq = seq;
			}
			if (frame.type === "state" && frame.state.name === "agent_settled") {
				setActivityLabelSynced(undefined);
				if (ownsTurn && frame.state.message !== "resync-required") return;
				if (!pendingResync) {
					pendingResync = { sequence: seq, generation: cursorStore.current().generation };
					void loadResync();
				}
				return;
			}

			setMessagesSynced((current) => {
				const next = applyChatStreamEvent(
					{
						assistantId: activeAssistantId ?? null,
						snapshot: {
							adapterCapabilities: sseCapabilitiesRef.current,
							messages: current,
							presentation: presentationRef.current,
							queue: queueRef.current,
							sessionMetadata: sessionMetadataRef.current,
						},
					},
					frame,
				);
				activeAssistantId = next.assistantId ?? undefined;
				if (next.snapshot.presentation && next.snapshot.presentation !== presentationRef.current) {
					presentationRef.current = next.snapshot.presentation;
					setPresentationSynced(next.snapshot.presentation);
				}
				if (next.snapshot.adapterCapabilities && next.snapshot.adapterCapabilities !== sseCapabilitiesRef.current) {
					sseCapabilitiesRef.current = next.snapshot.adapterCapabilities;
					setAdapterCapabilities(next.snapshot.adapterCapabilities);
				}
				if (next.snapshot.queue !== queueRef.current) {
					queueRef.current = next.snapshot.queue;
					setQueueSynced(next.snapshot.queue);
				}
				if (next.snapshot.activityLabel !== undefined || frame.type === "done" || frame.type === "state") {
					setActivityLabelSynced(next.snapshot.activityLabel);
				}
				return next.snapshot.messages;
			});
		};

		const subscription = createReconnectingEventSource({
			getUrl: () => {
				const recoveryCursor = activeRecoveryRef.current.active ? activeRecoveryRef.current.cursor : undefined;
				const stored = cursorStore.current();
				const resume = {
					streamGeneration: recoveryCursor?.generation ?? stored.generation,
					lastEventId: recoveryCursor?.sequence ?? stored.lastEventId,
				};
				return client.openSessionEvents?.(sessionId, resume) ?? buildChatEventsUrl({ sessionId, ...resume });
			},
			onOpen: clearReconnectNotice,
			onMalformedJson: () => {
				if (activeRecoveryRef.current.active) activeRecoveryRef.current.needsSnapshot = true;
			},
			onMessage: (parsed, seq) => {
				clearReconnectNotice();
				handleEvent(parsed, seq);
				if (
					!pendingResync &&
					!activeRecoveryRef.current.active &&
					statusRef.current !== "streaming" &&
					statusRef.current !== "submitted" &&
					seq !== undefined
				) {
					cursorStore.persist(seq);
					const generation = cursorStore.current().generation;
					if (generation) {
						activeRecoveryRef.current.cursor = { generation, sequence: seq };
					}
				}
			},
			onError: ({ attempt, scheduleReconnect }) => {
				// The first failure reconnects silently; persistent failures escalate
				// the activity label so a dead stream stays visible. Retries never stop.
				if (attempt > 1 && statusRef.current !== "streaming" && statusRef.current !== "submitted") {
					reconnectNoticeShown = true;
					setActivityLabelSynced(attempt > 2 ? `Reconnecting… (attempt ${attempt})` : "Reconnecting…");
				}
				scheduleReconnect();
			},
		});

		const requestReconnect = () => {
			if (!closedByEffect) subscription.reconnectNow();
		};
		const activeRecovery = activeRecoveryRef.current;
		activeRecovery.requestReconnect = requestReconnect;
		subscription.connect();

		return () => {
			closedByEffect = true;
			clearTimeout(resyncTimer);
			if (activeRecovery.requestReconnect === requestReconnect) {
				activeRecovery.requestReconnect = undefined;
			}
			subscription.close();
		};
	}, [
		client,
		activeRecoveryRef,
		presentationRef,
		sessionId,
		sessionMetadataRef,
		setActivityLabelSynced,
		setAdapterCapabilities,
		setMessagesSynced,
		setPresentationSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		statusRef,
		queueRef,
	]);
}

// --- messaging (send/stream) ---

type PiChatMessagingRefs = {
	sessionMetadataRef: MutableRefObject<ChatSessionMetadata>;
	pendingSendControllerRef: MutableRefObject<AbortController | null>;
	streamControllersRef: MutableRefObject<Map<string, AbortController>>;
};

type PiChatMessagingSetters = {
	setActivityLabelSynced: (label: string | undefined) => void;
	setError: (error: Error | null) => void;
	setMessagesSynced: (updater: Array<ChatMessage> | ((current: Array<ChatMessage>) => Array<ChatMessage>)) => void;
	setPresentationSynced: (presentation: PrimeAgentSessionPresentation) => void;
	setPlanLabelSynced: (label: string | undefined) => void;
	setQueueSynced: (queue: QueueState) => void;
	setSessionMetadataSynced: (metadata: ChatSessionMetadata) => void;
	setStatus: (status: ChatStatus) => void;
};

type StreamAdmission = {
	sessionId?: string;
	promise: Promise<void>;
	resolve: () => void;
	reject: (reason?: unknown) => void;
};

function createStreamAdmission(): StreamAdmission {
	let resolvePromise!: () => void;
	let rejectPromise!: (reason?: unknown) => void;
	let settled = false;
	const promise = new Promise<void>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	// A stream can fail before any queued submission starts waiting on it.
	promise.catch(() => undefined);
	return {
		promise,
		resolve: () => {
			if (settled) return;
			settled = true;
			resolvePromise();
		},
		reject: (reason) => {
			if (settled) return;
			settled = true;
			rejectPromise(reason);
		},
	};
}

function waitForRecovery(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		const timer = setTimeout(finish, 2_000);
		signal.addEventListener("abort", finish, { once: true });
	});
}

export type UsePiChatMessagingOptions = PiChatMessagingRefs &
	PiChatMessagingSetters & {
		applyConversationEvent: (assistantId: string | null, event: ChatStreamEvent) => string | null;
		client: ChatClient;
		model: ChatModelSelection | undefined;
		projectId?: ProjectId;
		recoverFromForbiddenSession: () => Promise<void>;
		refreshSessions: () => Promise<Array<ChatSessionInfo>>;
		status: ChatStatus;
	};

const RESOLVED_PROMISE: Promise<void> = Promise.resolve();

export function usePiChatMessaging({
	applyConversationEvent,
	client,
	model,
	pendingSendControllerRef,
	projectId,
	recoverFromForbiddenSession,
	refreshSessions,
	sessionMetadataRef,
	streamControllersRef,
	setActivityLabelSynced,
	setError,
	setMessagesSynced,
	setPresentationSynced,
	setPlanLabelSynced,
	setQueueSynced,
	setSessionMetadataSynced,
	setStatus,
	status,
}: UsePiChatMessagingOptions) {
	// Lazily materialize a prime-agent session the first time the user sends a
	// message without one — previously the composer POSTed with `sessionId:
	// undefined` and the route 400'd. Also used by follow-ups queued mid-turn.
	// In-flight memo prevents two concurrent sends from both calling createSession
	// and clobbering one another (race documented in review finding M2).
	const sessionCreatePromiseRef = useRef<Promise<ChatSessionMetadata> | null>(null);
	const streamAdmissionsRef = useRef(new Set<StreamAdmission>());
	const queuedSubmissionTailRef = useRef(RESOLVED_PROMISE);
	const projectIdRef = useRef(projectId);
	const recoveryGenerationRef = useRef(0);
	// Recovery owns its abort handle. The POST that failed is already aborted, so
	// reusing its signal would leave `stop()` unable to cancel the recovery loop.
	const recoveryContextRef = useRef<AbortController | null>(null);
	const streamRecoveryRef = useRef<ChatStreamRecoveryState>({ active: false, needsSnapshot: false });
	/**
	 * Release everything a recovery owns: the abort handle, the context that
	 * steering restarts from, and the replay handoff the SSE channel reads.
	 * `applyEvent`/`cursor` are cleared because a stale replay must never be
	 * applied to a session this hook is no longer recovering.
	 */
	const releaseRecovery = useCallback(() => {
		recoveryGenerationRef.current += 1;
		const controller = recoveryContextRef.current;
		recoveryContextRef.current = null;
		controller?.abort();
		streamRecoveryRef.current.active = false;
		streamRecoveryRef.current.applyEvent = undefined;
	}, []);
	const cancelStreamRecovery = useCallback(() => {
		releaseRecovery();
		streamRecoveryRef.current.cursor = undefined;
	}, [releaseRecovery]);
	useEffect(() => () => cancelStreamRecovery(), [cancelStreamRecovery]);
	useEffect(() => {
		projectIdRef.current = projectId;
	}, [projectId]);
	const findStreamAdmission = useCallback((sessionId?: string) => {
		for (const admission of streamAdmissionsRef.current) {
			if (admission.sessionId === sessionId) return admission;
		}
		return undefined;
	}, []);
	const resetStreamAdmission = useCallback((sessionId?: string) => {
		for (const admission of [...streamAdmissionsRef.current]) {
			if (admission.sessionId !== sessionId) continue;
			streamAdmissionsRef.current.delete(admission);
			admission.reject(new Error("Chat stream stopped before admission"));
		}
	}, []);
	const reconcileSession = useCallback(
		async (sessionId: string): Promise<boolean> => {
			const [result, sessions] = await Promise.all([client.loadSession({ sessionId }), refreshSessions()]);
			if (sessionMetadataRef.current.sessionId !== sessionId) return false;

			// A runtime reset can briefly return an empty transcript while the
			// completed stream already contains the visible answer. Never replace
			// that live answer with an empty snapshot; the next non-empty snapshot
			// will still reconcile the full canonical transcript.
			if (result.messages.length > 0) {
				setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
			}
			setPresentationSynced(result.presentation);
			setSessionMetadataSynced(result.session);
			setQueueSynced({ steering: [], followUp: [] });
			setPlanLabelSynced(undefined);
			const sessionStillRunning = sessions.find((session) => session.sessionId === sessionId)?.status === "running";
			if (!sessionStillRunning) {
				setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
			}
			return sessionStillRunning;
		},
		[
			client,
			refreshSessions,
			sessionMetadataRef,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setPresentationSynced,
			setQueueSynced,
			setSessionMetadataSynced,
		],
	);
	const handleStreamEvent = useCallback(
		(
			event: ChatStreamEvent,
			assistantIdRef: { current: string | null },
			streamSessionId: string,
			_mode?: ChatMode,
		) => {
			if (event.type === "error") {
				throw chatErrorFromStreamEvent(event);
			}
			if (event.type === "done" && event.sessionReset) {
				// A reconnect/reset is not completion of the active POST stream.
				// Keep status and assistantId intact so subsequent frames continue
				// the visible answer instead of replacing it with an empty message.
				if (streamSessionId !== sessionMetadataRef.current.sessionId) void refreshSessions();
				return;
			}

			if (event.type === "start") {
				const admission = findStreamAdmission(streamSessionId);
				if (admission) {
					streamAdmissionsRef.current.delete(admission);
					admission.resolve();
				}
			}

			const streamIsVisible = streamSessionId === sessionMetadataRef.current.sessionId;
			if (!streamIsVisible) {
				if (event.type === "done") {
					void refreshSessions();
				}
				return;
			}

			assistantIdRef.current = applyConversationEvent(assistantIdRef.current, event);

			if (event.type === "start") {
				setStatus("streaming");
			}

			if (event.type === "done") {
				setStatus("ready");
				void refreshSessions();
			}
			if (event.eventCursor) streamRecoveryRef.current.cursor = event.eventCursor;
		},
		[applyConversationEvent, findStreamAdmission, refreshSessions, sessionMetadataRef, setStatus],
	);
	const recoverInvalidStream = useCallback(
		async (sessionId: string, error: ChatStreamContractError, mode?: ChatMode): Promise<boolean> => {
			releaseRecovery();
			const generation = recoveryGenerationRef.current;
			const controller = new AbortController();
			const signal = controller.signal;
			const assistantIdRef = { current: null as string | null };
			recoveryContextRef.current = controller;

			// This is the only writer that arms the replay handoff. Arm it here
			// rather than at the failure site so every recovery attempt, including
			// a restart, owns a live `applyEvent`; the SSE channel drops replayed
			// frames whenever `active` or `applyEvent` is missing.
			streamRecoveryRef.current.sessionId = sessionId;
			streamRecoveryRef.current.active = true;
			streamRecoveryRef.current.needsSnapshot = streamRecoveryRef.current.cursor === undefined;
			streamRecoveryRef.current.applyEvent = (replayedEvent) => {
				if (streamRecoveryRef.current.sessionId !== sessionId) return;
				handleStreamEvent(replayedEvent, assistantIdRef, sessionId, mode);
				if (replayedEvent.type === "done") {
					setStatus("streaming");
					setActivityLabelSynced("Reconnecting…");
				}
			};
			streamRecoveryRef.current.requestReconnect?.();

			setError(null);
			let consecutiveFailures = 0;
			const isCurrent = () =>
				recoveryGenerationRef.current === generation &&
				recoveryContextRef.current === controller &&
				sessionMetadataRef.current.sessionId === sessionId &&
				!signal.aborted;

			try {
				while (isCurrent()) {
					try {
						const [snapshot, sessions] = await Promise.all([
							client.loadSession({ sessionId }),
							refreshSessions(),
						]);
						if (!isCurrent()) return false;
						consecutiveFailures = 0;
						const runtimeStatus = sessions.find((session) => session.sessionId === sessionId)?.status;
						setPresentationSynced(snapshot.presentation);
						setSessionMetadataSynced(snapshot.session);

						if (runtimeStatus === "running") {
							setStatus("streaming");
							setActivityLabelSynced("Reconnecting…");
						} else if (runtimeStatus === "idle") {
							if (snapshot.messages.length > 0) {
								setMessagesSynced(
									hydratePlanPresentationMessages(snapshot.messages, snapshot.planPresentations),
								);
							}
							setQueueSynced({ steering: [], followUp: [] });
							setPlanLabelSynced(undefined);
							setActivityLabelSynced(snapshot.sessionReset ? "Started a fresh Pi session" : undefined);
							setError(null);
							setStatus("ready");
							return true;
						} else {
							if (snapshot.messages.length > 0) {
								setMessagesSynced(
									hydratePlanPresentationMessages(snapshot.messages, snapshot.planPresentations),
								);
							}
							setActivityLabelSynced(undefined);
							setError(error);
							setStatus("error");
							return false;
						}
						await waitForRecovery(signal);
					} catch {
						if (!isCurrent()) return false;
						consecutiveFailures += 1;
						if (consecutiveFailures >= 3) break;
						setActivityLabelSynced("Refreshing conversation…");
						await waitForRecovery(signal);
					}
				}
				if (!isCurrent()) return false;
				setActivityLabelSynced(undefined);
				setError(error);
				setStatus("error");
				return false;
			} finally {
				// Only tear down state this attempt still owns. A newer attempt
				// (steering restarted recovery) has already replaced the context.
				if (recoveryGenerationRef.current === generation) {
					releaseRecovery();
				}
			}
		},
		[
			client,
			handleStreamEvent,
			refreshSessions,
			releaseRecovery,
			sessionMetadataRef,
			setActivityLabelSynced,
			setError,
			setMessagesSynced,
			setPlanLabelSynced,
			setPresentationSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			setStatus,
		],
	);
	const ensureSession = useCallback(
		async (signal?: AbortSignal): Promise<ChatSessionMetadata> => {
			if (signal?.aborted) throw new Error("Session creation was aborted");
			const existing = sessionMetadataRef.current;
			if (existing.sessionId) return existing;
			const inFlight = sessionCreatePromiseRef.current;
			if (inFlight) return inFlight;
			const promise = client
				.createSession(projectIdRef.current, signal)
				.then((created) => {
					if (signal?.aborted) throw new Error("Session creation was aborted");
					setSessionMetadataSynced(created.session);
					setPresentationSynced(created.presentation);
					sessionMetadataRef.current = created.session;
					void refreshSessions();
					return created.session;
				})
				.finally(() => {
					if (sessionCreatePromiseRef.current === promise) {
						sessionCreatePromiseRef.current = null;
					}
				});
			sessionCreatePromiseRef.current = promise;
			return promise;
		},
		[client, refreshSessions, sessionMetadataRef, setPresentationSynced, setSessionMetadataSynced],
	);
	const enqueueDuringStream = useCallback(
		async (
			trimmed: string,
			streamingBehavior: "steer" | "followUp" = "steer",
			options?: Pick<SendMessageInput, "attachments" | "mode" | "openUI" | "openUIArtifact" | "planAction">,
		) => {
			const originatingSessionId = sessionMetadataRef.current.sessionId ?? (await ensureSession()).sessionId;
			if (!originatingSessionId) throw new Error("Unable to queue a message without a session");

			const userMessage = createOptimisticUserMessage(trimmed);
			setMessagesSynced((current) => [...current, userMessage]);
			setError(null);

			const previousAcceptance = queuedSubmissionTailRef.current;
			const acceptance = createStreamAdmission();
			const submission = previousAcceptance
				.catch(() => undefined)
				.then(async () => {
					try {
						const admission = findStreamAdmission(originatingSessionId);
						await admission?.promise;
						await client.streamMessage(
							{
								message: trimmed,
								attachments: options?.attachments,
								openUI: options?.openUI,
								openUIArtifact: options?.openUIArtifact,
								model,
								planAction: options?.planAction,
								mode: options?.mode,
								sessionId: originatingSessionId,
								streamingBehavior,
							},
							(event) => {
								if (event.type === "start" && event.requestKind === "session-command") {
									acceptance.resolve();
								}
								if (event.type === "done" && event.requestKind === "session-command") {
									if (sessionMetadataRef.current.sessionId !== originatingSessionId) return;
									// The command POST owns this local completion. Do not feed it
									// through the active turn reducer, which would settle or replace
									// the assistant message belonging to the main stream.
									setMessagesSynced((current) =>
										settleOptimisticUserMessage(
											current.some((message) => message.id === event.message.id)
												? current
												: [...current, event.message],
											userMessage.id,
										),
									);
									return;
								}
								if (event.type === "queue") {
									acceptance.resolve();
									setQueueSynced({
										steering: event.steering,
										followUp: event.followUp,
									});
									setActivityLabelSynced(streamingBehavior === "steer" ? "Steered" : "Follow-up queued");
								}
								if (event.type === "error") {
									throw chatErrorFromStreamEvent(event);
								}
							},
						);
						acceptance.resolve();
					} catch (err) {
						acceptance.reject(err);
						setMessagesSynced((current) => removeOptimisticUserMessage(current, userMessage.id));
						throw err;
					}

					// The steered message is queued server-side, but the `queue` event only
					// ever lands on the *main* turn's NDJSON stream (which this POST didn't
					// open). Refresh the sessions list so the queue badge in the shell
					// reflects the just-steered item instead of waiting for the current
					// turn to end. Best-effort: a refresh failure must not roll back the
					// optimistic message after streamMessage already succeeded.
					try {
						await refreshSessions();
					} catch {
						// Ignore — the queue submission already landed server-side.
					}
				});
			queuedSubmissionTailRef.current = acceptance.promise.catch(() => undefined);
			await submission;
		},
		[
			client,
			ensureSession,
			findStreamAdmission,
			model,
			refreshSessions,
			sessionMetadataRef,
			setActivityLabelSynced,
			setError,
			setMessagesSynced,
			setQueueSynced,
		],
	);

	const sendMessage = useCallback(
		async ({
			text,
			attachments,
			openUI,
			openUIArtifact,
			planAction,
			mode,
			/** Mirror of the Alt/Option modifier at Enter-press time. */
			altKey,
		}: SendMessageInput) => {
			const trimmed = text.trim();
			if (!trimmed) return false;
			// Steering deliberately leaves recovery running. Cancelling it here used
			// to clear `active`/`applyEvent` while the loop restarted, so the SSE
			// replay channel stayed dead and replayed frames were dropped; the two
			// are independent, and the recovery loop's own controller is what
			// `stop()` aborts.

			if (
				status === "submitted" ||
				status === "streaming" ||
				findStreamAdmission(sessionMetadataRef.current.sessionId) !== undefined
			) {
				try {
					// Enter during stream = steer into the current turn.
					// Alt+Enter during stream = queue a follow-up after this turn.
					await enqueueDuringStream(trimmed, altKey ? "followUp" : "steer", {
						attachments,
						mode,
						openUI,
						openUIArtifact,
						planAction,
					});
					return true;
				} catch (err) {
					const nextError = err instanceof Error ? err : new Error(String(err));
					setError(nextError);
					notifyChatError(nextError);
					return false;
				}
			}

			setError(null);
			setActivityLabelSynced(undefined);
			setStatus("submitted");

			const userMessage = createOptimisticUserMessage(trimmed);
			setMessagesSynced((current) => [...current, userMessage]);
			const assistantIdRef = { current: null as string | null };
			const streamAdmission = createStreamAdmission();
			streamAdmission.sessionId = sessionMetadataRef.current.sessionId;
			streamAdmissionsRef.current.add(streamAdmission);
			const controller = new AbortController();
			pendingSendControllerRef.current = controller;
			let streamSessionId: string | undefined;
			let terminalDoneSeen = false;
			let streamContractFailed = false;

			try {
				const ensuredSession = await ensureSession(controller.signal);
				if (controller.signal.aborted) return false;
				const ensuredStreamSessionId = ensuredSession.sessionId;
				if (!ensuredStreamSessionId) throw new Error("Unable to start a session stream");
				streamSessionId = ensuredStreamSessionId;
				streamAdmission.sessionId = ensuredStreamSessionId;
				streamControllersRef.current.set(ensuredStreamSessionId, controller);
				await client.streamMessage(
					{
						message: trimmed,
						attachments,
						openUI,
						openUIArtifact,
						model,
						planAction,
						mode,
						sessionId: ensuredStreamSessionId,
						streamingBehavior: altKey ? "followUp" : "steer",
					},
					(event) => {
						if (event.type === "done" && !event.sessionReset) terminalDoneSeen = true;
						handleStreamEvent(event, assistantIdRef, ensuredStreamSessionId, mode);
						if (
							event.type === "done" &&
							event.requestKind === "session-command" &&
							sessionMetadataRef.current.sessionId === ensuredStreamSessionId
						) {
							setMessagesSynced((current) => settleOptimisticUserMessage(current, userMessage.id));
						}
					},
					controller.signal,
				);

				let sessionStillRunning = false;
				try {
					// Reconcile even after a terminal frame. The live stream can contain
					// transient tool updates that are not present in its final message;
					// the canonical session transcript is the source of truth for the
					// completed conversation.
					sessionStillRunning = await reconcileSession(ensuredStreamSessionId);
				} catch {
					// Keep the existing streamed state when a best-effort transcript
					// refresh fails; the next session refresh can recover it.
				}
				if (
					sessionMetadataRef.current.sessionId === ensuredStreamSessionId &&
					(terminalDoneSeen || !sessionStillRunning)
				) {
					setStatus("ready");
				}
				return true;
			} catch (err) {
				if (streamAdmissionsRef.current.delete(streamAdmission)) {
					streamAdmission.reject(err);
				}
				if (!(err instanceof ChatStreamContractError)) {
					setMessagesSynced((current) => removeOptimisticUserMessage(current, userMessage.id));
				} else {
					streamContractFailed = true;
				}
				if (controller.signal.aborted) return false;
				if (streamSessionId && sessionMetadataRef.current.sessionId !== streamSessionId) {
					void refreshSessions();
					return false;
				}
				if (err instanceof ChatStreamContractError && streamSessionId) {
					// Replaying the resumed SSE frames reconciles the interrupted turn
					// with what the runtime already emitted. `recoverInvalidStream` owns
					// the handoff, so a stale cursor from a different session is the only
					// state this site needs to reset.
					if (streamRecoveryRef.current.sessionId !== streamSessionId) {
						streamRecoveryRef.current.cursor = undefined;
					}
					return await recoverInvalidStream(streamSessionId, err, mode);
				}
				const recoveryDeps = { setError, setStatus };
				const recovered =
					(await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, recoveryDeps)) ||
					(await tryRecoverUnknownSession(err, recoverFromForbiddenSession, recoveryDeps));
				if (recovered) {
					return false;
				}
				const nextError = err instanceof Error ? err : new Error(String(err));
				setError(nextError);
				setStatus("error");
				notifyChatError(nextError);
				return false;
			} finally {
				if (streamAdmissionsRef.current.delete(streamAdmission)) {
					streamAdmission.reject(new Error("Chat stream ended before admission"));
				}
				if (controller.signal.aborted && !streamContractFailed) {
					setMessagesSynced((current) => removeOptimisticUserMessage(current, userMessage.id));
				}
				if (pendingSendControllerRef.current === controller) {
					pendingSendControllerRef.current = null;
				}
				if (streamSessionId && controller && streamControllersRef.current.get(streamSessionId) === controller) {
					streamControllersRef.current.delete(streamSessionId);
				}
			}
		},
		[
			client,
			ensureSession,
			enqueueDuringStream,
			findStreamAdmission,
			handleStreamEvent,
			model,
			pendingSendControllerRef,
			recoverFromForbiddenSession,
			recoverInvalidStream,
			reconcileSession,
			refreshSessions,
			sessionMetadataRef,
			setActivityLabelSynced,
			setError,
			setMessagesSynced,
			setStatus,
			streamControllersRef,
			status,
		],
	);

	return {
		cancelStreamRecovery,
		enqueueDuringStream,
		handleStreamEvent,
		resetStreamAdmission,
		sendMessage,

		streamRecoveryRef,
	};
}
