import type {
	ChatModelSelection,
	ChatSessionInfo,
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
} from "@prime-agent/web-protocol/chat-protocol";
import { ChatStreamEventCursorSchema, ChatStreamEventDecodeSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { createReconnectingEventSource, createSseCursorStore } from "@/hooks/chat/chat-sse";
import type { ChatStore } from "@/hooks/chat/chat-store";
import type { SendMessageInput } from "@/hooks/chat/use-pi-chat";
import type { ChatClient } from "@/lib/chat/chat-client";
import { notifyChatError } from "@/lib/chat/chat-error-notify";
import { ChatStreamContractError, chatErrorFromStreamEvent } from "@/lib/chat/chat-fetch";
import {
	createOptimisticUserMessage,
	removeOptimisticUserMessage,
	settleOptimisticUserMessage,
} from "@/lib/chat/chat-helpers";
import { buildChatEventsUrl } from "@/lib/chat/chat-runtime-url";
import { EMPTY_QUEUE_STATE, type ChatStreamRecoveryState } from "@/lib/chat/chat-stream-state";
import { tryRecoverForbiddenSession, tryRecoverUnknownSession } from "@/lib/chat/forbidden-session-recovery";
import { hydratePlanPresentationMessages } from "@/lib/chat/plan-presentation";

type SessionEventsOptions = {
	client: ChatClient;
	recoveryRef?: MutableRefObject<ChatStreamRecoveryState>;
	sessionId?: string;
	store: ChatStore;
};

/** True while this browser owns the turn, so out-of-turn frames must not be applied. */
function ownsTurn(store: ChatStore) {
	const { status } = store.read();
	return status === "streaming" || status === "submitted";
}

/**
 * Manages the visible chat session's SSE connection, event resume cursor, state synchronization, reconnection, and cleanup.
 *
 * @param options - Session event handling dependencies and the chat store.
 */
export function usePiChatSessionEvents({ client, recoveryRef, sessionId, store }: SessionEventsOptions) {
	const internalRecoveryRef = useRef<ChatStreamRecoveryState>({ active: false, needsSnapshot: false });
	const activeRecoveryRef = recoveryRef ?? internalRecoveryRef;
	useEffect(() => {
		if (!sessionId || typeof window === "undefined") return;
		if (!activeRecoveryRef.current.active && activeRecoveryRef.current.sessionId !== sessionId) {
			activeRecoveryRef.current.sessionId = sessionId;
			activeRecoveryRef.current.cursor = undefined;
			activeRecoveryRef.current.needsSnapshot = false;
		}

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
		let activeAssistantId: string | null = null;
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
				if (closedByEffect || store.read().sessionMetadata.sessionId !== sessionId || pendingResync !== pending)
					return;
				if (cursorStore.current().generation !== generation || ownsTurn(store)) {
					retryResync();
					return;
				}
				store.patch({
					messages: hydratePlanPresentationMessages(result.messages, result.planPresentations),
					presentation: result.presentation,
					queue: EMPTY_QUEUE_STATE,
					sessionMetadata: result.session,
				});
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
			if (!ownsTurn(store)) store.patch({ activityLabel: undefined });
		};

		const handleEvent = (parsed: unknown, seq: number | undefined) => {
			if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "connected") {
				const connected = parsed as {
					adapterCapabilities?: FleetAdapterCapabilities;
					cursorReset?: boolean;
					streamGeneration?: string;
				};
				store.patch({ adapterCapabilities: connected.adapterCapabilities });
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
					store.patch({ activityLabel: undefined });
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
						store.patch({ activityLabel: undefined });
					}
				} catch {
					activeRecoveryRef.current.needsSnapshot = true;
				}
				return;
			}
			if (frame.type === "start") activeAssistantId = frame.id;
			if (frame.type === "done" && !frame.sessionReset) activeAssistantId = null;
			const turnIsOurs = ownsTurn(store);
			const questionDuringTurn = frame.type === "tool" && frame.part.type === "tool-Question";
			const visibleWhileStreaming = frame.type === "presentation" || frame.type === "rlm" || questionDuringTurn;
			if (turnIsOurs && !visibleWhileStreaming) return;
			if (frame.type === "rlm" && seq !== undefined) {
				if (seq <= lastAppliedRlmSeq) return;
				lastAppliedRlmSeq = seq;
			}
			if (frame.type === "state" && frame.state.name === "agent_settled") {
				store.patch({ activityLabel: undefined });
				if (turnIsOurs && frame.state.message !== "resync-required") return;
				if (!pendingResync) {
					pendingResync = { sequence: seq, generation: cursorStore.current().generation };
					void loadResync();
				}
				return;
			}

			activeAssistantId = store.applyEvent(activeAssistantId, frame);
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
				if (!pendingResync && !activeRecoveryRef.current.active && !ownsTurn(store) && seq !== undefined) {
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
				if (attempt > 1 && !ownsTurn(store)) {
					reconnectNoticeShown = true;
					store.patch({ activityLabel: attempt > 2 ? `Reconnecting… (attempt ${attempt})` : "Reconnecting…" });
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
	}, [client, activeRecoveryRef, sessionId, store]);
}

// --- messaging (send/stream) ---

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

export type UsePiChatMessagingOptions = {
	client: ChatClient;
	model: ChatModelSelection | undefined;
	pendingSendControllerRef: MutableRefObject<AbortController | null>;
	projectId?: ProjectId;
	recoverFromForbiddenSession: () => Promise<void>;
	refreshSessions: () => Promise<Array<ChatSessionInfo>>;
	store: ChatStore;
	streamControllersRef: MutableRefObject<Map<string, AbortController>>;
};

const RESOLVED_PROMISE: Promise<void> = Promise.resolve();

export function usePiChatMessaging({
	client,
	model,
	pendingSendControllerRef,
	projectId,
	recoverFromForbiddenSession,
	refreshSessions,
	store,
	streamControllersRef,
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
			if (store.read().sessionMetadata.sessionId !== sessionId) return false;

			const sessionStillRunning = sessions.find((session) => session.sessionId === sessionId)?.status === "running";
			store.patch({
				// A runtime reset can briefly return an empty transcript while the
				// completed stream already contains the visible answer. Never replace
				// that live answer with an empty snapshot; the next non-empty snapshot
				// will still reconcile the full canonical transcript.
				...(result.messages.length > 0
					? { messages: hydratePlanPresentationMessages(result.messages, result.planPresentations) }
					: {}),
				...(sessionStillRunning
					? {}
					: { activityLabel: result.sessionReset ? "Started a fresh Pi session" : undefined }),
				planLabel: undefined,
				presentation: result.presentation,
				queue: EMPTY_QUEUE_STATE,
				sessionMetadata: result.session,
			});
			return sessionStillRunning;
		},
		[client, refreshSessions, store],
	);
	const handleStreamEvent = useCallback(
		(event: ChatStreamEvent, assistantIdRef: { current: string | null }, streamSessionId: string) => {
			if (event.type === "error") {
				throw chatErrorFromStreamEvent(event);
			}
			if (event.type === "done" && event.sessionReset) {
				// A reconnect/reset is not completion of the active POST stream.
				// Keep status and assistantId intact so subsequent frames continue
				// the visible answer instead of replacing it with an empty message.
				if (streamSessionId !== store.read().sessionMetadata.sessionId) void refreshSessions();
				return;
			}

			if (event.type === "start") {
				const admission = findStreamAdmission(streamSessionId);
				if (admission) {
					streamAdmissionsRef.current.delete(admission);
					admission.resolve();
				}
			}

			const streamIsVisible = streamSessionId === store.read().sessionMetadata.sessionId;
			if (!streamIsVisible) {
				if (event.type === "done") {
					void refreshSessions();
				}
				return;
			}

			assistantIdRef.current = store.applyEvent(assistantIdRef.current, event);

			if (event.type === "start") store.patch({ status: "streaming" });
			if (event.type === "done") {
				store.patch({ status: "ready" });
				void refreshSessions();
			}
			if (event.eventCursor) streamRecoveryRef.current.cursor = event.eventCursor;
		},
		[findStreamAdmission, refreshSessions, store],
	);
	const recoverInvalidStream = useCallback(
		async (sessionId: string, error: ChatStreamContractError): Promise<boolean> => {
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
				handleStreamEvent(replayedEvent, assistantIdRef, sessionId);
				if (replayedEvent.type === "done") {
					store.patch({ activityLabel: "Reconnecting…", status: "streaming" });
				}
			};
			streamRecoveryRef.current.requestReconnect?.();

			store.patch({ error: null });
			let consecutiveFailures = 0;
			const isCurrent = () =>
				recoveryGenerationRef.current === generation &&
				recoveryContextRef.current === controller &&
				store.read().sessionMetadata.sessionId === sessionId &&
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
						// A runtime reset can briefly return an empty transcript while the
						// recovered stream still holds the visible answer.
						const recoveredMessages =
							snapshot.messages.length > 0
								? { messages: hydratePlanPresentationMessages(snapshot.messages, snapshot.planPresentations) }
								: {};
						store.patch({ presentation: snapshot.presentation, sessionMetadata: snapshot.session });

						if (runtimeStatus === "running") {
							store.patch({ activityLabel: "Reconnecting…", status: "streaming" });
						} else if (runtimeStatus === "idle") {
							store.patch({
								...recoveredMessages,
								activityLabel: snapshot.sessionReset ? "Started a fresh Pi session" : undefined,
								error: null,
								planLabel: undefined,
								queue: EMPTY_QUEUE_STATE,
								status: "ready",
							});
							return true;
						} else {
							store.patch({ ...recoveredMessages, activityLabel: undefined, error, status: "error" });
							return false;
						}
						await waitForRecovery(signal);
					} catch {
						if (!isCurrent()) return false;
						consecutiveFailures += 1;
						if (consecutiveFailures >= 3) break;
						store.patch({ activityLabel: "Refreshing conversation…" });
						await waitForRecovery(signal);
					}
				}
				if (!isCurrent()) return false;
				store.patch({ activityLabel: undefined, error, status: "error" });
				return false;
			} finally {
				// Only tear down state this attempt still owns. A newer attempt
				// (steering restarted recovery) has already replaced the context.
				if (recoveryGenerationRef.current === generation) {
					releaseRecovery();
				}
			}
		},
		[client, handleStreamEvent, refreshSessions, releaseRecovery, store],
	);
	const ensureSession = useCallback(
		async (signal?: AbortSignal): Promise<ChatSessionMetadata> => {
			if (signal?.aborted) throw new Error("Session creation was aborted");
			const existing = store.read().sessionMetadata;
			if (existing.sessionId) return existing;
			const inFlight = sessionCreatePromiseRef.current;
			if (inFlight) return inFlight;
			const promise = client
				.createSession(projectIdRef.current, signal)
				.then((created) => {
					if (signal?.aborted) throw new Error("Session creation was aborted");
					store.patch({ presentation: created.presentation, sessionMetadata: created.session });
					void refreshSessions();
					return store.read().sessionMetadata;
				})
				.finally(() => {
					if (sessionCreatePromiseRef.current === promise) {
						sessionCreatePromiseRef.current = null;
					}
				});
			sessionCreatePromiseRef.current = promise;
			return promise;
		},
		[client, refreshSessions, store],
	);
	const enqueueDuringStream = useCallback(
		async (
			trimmed: string,
			streamingBehavior: "steer" | "followUp" = "steer",
			options?: Pick<SendMessageInput, "attachments" | "mode" | "openUI" | "openUIArtifact" | "planAction">,
		) => {
			const originatingSessionId = store.read().sessionMetadata.sessionId ?? (await ensureSession()).sessionId;
			if (!originatingSessionId) throw new Error("Unable to queue a message without a session");

			const userMessage = createOptimisticUserMessage(trimmed);
			store.patch((current) => ({ error: null, messages: [...current.messages, userMessage] }));

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
									if (store.read().sessionMetadata.sessionId !== originatingSessionId) return;
									// The command POST owns this local completion. Do not feed it
									// through the active turn reducer, which would settle or replace
									// the assistant message belonging to the main stream.
									store.patch((current) => ({
										messages: settleOptimisticUserMessage(
											current.messages.some((message) => message.id === event.message.id)
												? current.messages
												: [...current.messages, event.message],
											userMessage.id,
										),
									}));
									return;
								}
								if (event.type === "queue") {
									acceptance.resolve();
									store.patch({
										activityLabel: streamingBehavior === "steer" ? "Steered" : "Follow-up queued",
										queue: { steering: event.steering, followUp: event.followUp },
									});
								}
								if (event.type === "error") {
									throw chatErrorFromStreamEvent(event);
								}
							},
						);
						acceptance.resolve();
					} catch (err) {
						acceptance.reject(err);
						store.patch((current) => ({
							messages: removeOptimisticUserMessage(current.messages, userMessage.id),
						}));
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
		[client, ensureSession, findStreamAdmission, model, refreshSessions, store],
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

			const { sessionMetadata, status } = store.read();
			if (
				status === "submitted" ||
				status === "streaming" ||
				findStreamAdmission(sessionMetadata.sessionId) !== undefined
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
					store.patch({ error: nextError });
					notifyChatError(nextError);
					return false;
				}
			}

			const userMessage = createOptimisticUserMessage(trimmed);
			store.patch((current) => ({
				activityLabel: undefined,
				error: null,
				messages: [...current.messages, userMessage],
				status: "submitted",
			}));
			const assistantIdRef = { current: null as string | null };
			const streamAdmission = createStreamAdmission();
			streamAdmission.sessionId = sessionMetadata.sessionId;
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
						handleStreamEvent(event, assistantIdRef, ensuredStreamSessionId);
						if (
							event.type === "done" &&
							event.requestKind === "session-command" &&
							store.read().sessionMetadata.sessionId === ensuredStreamSessionId
						) {
							store.patch((current) => ({
								messages: settleOptimisticUserMessage(current.messages, userMessage.id),
							}));
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
					store.read().sessionMetadata.sessionId === ensuredStreamSessionId &&
					(terminalDoneSeen || !sessionStillRunning)
				) {
					store.patch({ status: "ready" });
				}
				return true;
			} catch (err) {
				if (streamAdmissionsRef.current.delete(streamAdmission)) {
					streamAdmission.reject(err);
				}
				if (err instanceof ChatStreamContractError) {
					streamContractFailed = true;
				} else {
					store.patch((current) => ({
						messages: removeOptimisticUserMessage(current.messages, userMessage.id),
					}));
				}
				if (controller.signal.aborted) return false;
				if (streamSessionId && store.read().sessionMetadata.sessionId !== streamSessionId) {
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
					return await recoverInvalidStream(streamSessionId, err);
				}
				const context = { store };
				const recovered =
					(await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, context)) ||
					(await tryRecoverUnknownSession(err, recoverFromForbiddenSession, context));
				if (recovered) {
					return false;
				}
				const nextError = err instanceof Error ? err : new Error(String(err));
				store.patch({ error: nextError, status: "error" });
				notifyChatError(nextError);
				return false;
			} finally {
				if (streamAdmissionsRef.current.delete(streamAdmission)) {
					streamAdmission.reject(new Error("Chat stream ended before admission"));
				}
				if (controller.signal.aborted && !streamContractFailed) {
					store.patch((current) => ({
						messages: removeOptimisticUserMessage(current.messages, userMessage.id),
					}));
				}
				if (pendingSendControllerRef.current === controller) {
					pendingSendControllerRef.current = null;
				}
				if (streamSessionId && streamControllersRef.current.get(streamSessionId) === controller) {
					streamControllersRef.current.delete(streamSessionId);
				}
			}
		},
		[
			client,
			enqueueDuringStream,
			ensureSession,
			findStreamAdmission,
			handleStreamEvent,
			model,
			pendingSendControllerRef,
			recoverFromForbiddenSession,
			recoverInvalidStream,
			reconcileSession,
			refreshSessions,
			store,
			streamControllersRef,
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
