import { notify } from "@prime-agent/web-design/lib/notify";
import type {
	ChatMode,
	ChatModelSelection,
	ChatSessionInfo,
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import type { MutableRefObject } from "react";
import { useCallback, useRef } from "react";
import { captureChatSessionStarted, captureConversationSaved } from "@/lib/analytics-stub";
import type { ChatClient } from "./chat-client";
import type { QueueState } from "./chat-fetch";
import {
	assistantTextFromMessage,
	createOptimisticUserMessage,
	removeOptimisticUserMessage,
	settleOptimisticUserMessage,
	upsertAssistantToolPart,
} from "./chat-message-helpers";
import { applyChatStreamEvent } from "./chat-stream-state";
import { hydratePlanPresentationMessages } from "./plan-presentation";
import {
	applyPlanModeSelection,
	bindPendingPlanDecisionToolCallId,
	createEmptyPlanState,
	createPlanToolPart,
	toChatPlanState,
	updatePlanStateFromAssistantText,
} from "./plan-state";
import type { SendMessageInput } from "./use-pi-chat";
import { tryRecoverForbiddenSession } from "./use-pi-chat-forbidden-session";

type PiChatMessagingRefs = {
	activityLabelRef: MutableRefObject<string | undefined>;
	messagesRef: MutableRefObject<Array<ChatMessage>>;
	presentationRef: MutableRefObject<PrimeAgentSessionPresentation>;
	planLabelRef: MutableRefObject<string | undefined>;
	queueRef: MutableRefObject<QueueState>;
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

export type UsePiChatMessagingOptions = PiChatMessagingRefs &
	PiChatMessagingSetters & {
		client: ChatClient;
		model: ChatModelSelection | undefined;
		projectId?: ProjectId;
		recoverFromForbiddenSession: () => Promise<void>;
		refreshSessions: () => Promise<Array<ChatSessionInfo>>;
		status: ChatStatus;
	};

export const RESOLVED_PROMISE: Promise<void> = Promise.resolve();

export function usePiChatMessaging({
	activityLabelRef,
	client,
	messagesRef,
	presentationRef,
	model,
	pendingSendControllerRef,
	projectId,
	planLabelRef,
	queueRef,
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
	const adapterCapabilitiesRef = useRef<FleetAdapterCapabilities | undefined>(undefined);
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
	const setAdapterCapabilities = useCallback((next: FleetAdapterCapabilities | undefined) => {
		adapterCapabilitiesRef.current = next;
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
	const ensureSession = useCallback(
		async (signal?: AbortSignal): Promise<ChatSessionMetadata> => {
			if (signal?.aborted) throw new Error("Session creation was aborted");
			const existing = sessionMetadataRef.current;
			if (existing.sessionId) return existing;
			const inFlight = sessionCreatePromiseRef.current;
			if (inFlight) return inFlight;
			const promise = client
				.createSession(projectId, signal)
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
		[client, projectId, refreshSessions, sessionMetadataRef, setPresentationSynced, setSessionMetadataSynced],
	);
	const handleStreamEvent = useCallback(
		(
			event: ChatStreamEvent,
			assistantIdRef: { current: string | null },
			streamSessionId: string,
			mode?: ChatMode,
		) => {
			if (event.type === "error") {
				throw new Error(event.message);
			}
			if (event.type === "done" && event.sessionReset) {
				// A reconnect/reset is not completion of the active POST stream.
				// Keep status and assistantId intact so subsequent frames continue
				// the visible answer instead of replacing it with an empty message.
				if (streamSessionId !== sessionMetadataRef.current.sessionId) void refreshSessions();
				return;
			}
			let planPart: ReturnType<typeof createPlanToolPart>;
			if (event.type === "done" && mode === "plan") {
				const initialPlanState = applyPlanModeSelection(createEmptyPlanState(), mode);
				const parsedPlan = updatePlanStateFromAssistantText(
					initialPlanState,
					assistantTextFromMessage(event.message),
				);
				const planState = bindPendingPlanDecisionToolCallId(parsedPlan.state, event.message.id);
				planPart = parsedPlan.changed ? createPlanToolPart(event.message.id, planState) : undefined;
				if (planPart) {
					// Persistence must run even when this session is not the visible one:
					// the sidecar belongs to the streaming session, not the active view.
					void client
						.upsertPlanPresentation({
							sessionId: streamSessionId,
							presentation: {
								assistantMessageId: event.message.id,
								state: toChatPlanState(planState),
							},
						})
						.catch(() => undefined);
				}
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

			const next = applyChatStreamEvent(
				{
					assistantId: assistantIdRef.current,
					snapshot: {
						adapterCapabilities: adapterCapabilitiesRef.current,
						activityLabel: activityLabelRef.current,
						messages: messagesRef.current,
						presentation: presentationRef.current,
						planLabel: planLabelRef.current,
						queue: queueRef.current,
						sessionMetadata: sessionMetadataRef.current,
					},
				},
				event,
			);

			assistantIdRef.current = next.assistantId;
			adapterCapabilitiesRef.current = next.snapshot.adapterCapabilities;
			setMessagesSynced(next.snapshot.messages);
			if (next.snapshot.presentation) setPresentationSynced(next.snapshot.presentation);
			setSessionMetadataSynced(next.snapshot.sessionMetadata);
			setQueueSynced(next.snapshot.queue);
			setActivityLabelSynced(next.snapshot.activityLabel);
			setPlanLabelSynced(next.snapshot.planLabel);

			// Insert after the done merge: applyChatStreamEvent replaces the in-flight
			// message with event.message, so inserting earlier would drop the card.
			if (planPart && event.type === "done") {
				setMessagesSynced((current) => upsertAssistantToolPart(current, event.message.id, planPart));
			}

			if (event.type === "start") {
				setStatus("streaming");
			}

			if (event.type === "done") {
				setStatus("ready");
				void refreshSessions();
			}
		},
		[
			activityLabelRef,
			client,
			findStreamAdmission,
			messagesRef,
			presentationRef,
			planLabelRef,
			queueRef,
			refreshSessions,
			sessionMetadataRef,
			setActivityLabelSynced,
			setMessagesSynced,
			setPresentationSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			setStatus,
		],
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
									throw new Error(event.message);
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
			if (!trimmed) return;

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
				} catch (err) {
					const nextError = err instanceof Error ? err : new Error(String(err));
					setError(nextError);
					notify.error(nextError.message);
				}
				return;
			}

			setError(null);
			setActivityLabelSynced(undefined);
			setStatus("submitted");

			if (messagesRef.current.length === 0) {
				captureChatSessionStarted({
					promptLength: trimmed.length,
					sessionId: sessionMetadataRef.current.sessionId,
				});
			}

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

			try {
				const ensuredSession = await ensureSession(controller.signal);
				if (controller.signal.aborted) return;
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
				captureConversationSaved({
					messageCount: messagesRef.current.length,
					sessionId: ensuredStreamSessionId,
				});
			} catch (err) {
				if (streamAdmissionsRef.current.delete(streamAdmission)) {
					streamAdmission.reject(err);
				}
				setMessagesSynced((current) => removeOptimisticUserMessage(current, userMessage.id));
				if (controller.signal.aborted) return;
				if (streamSessionId && sessionMetadataRef.current.sessionId !== streamSessionId) {
					void refreshSessions();
					return;
				}
				if (
					await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, {
						setError,
						setStatus,
					})
				) {
					return;
				}
				const nextError = err instanceof Error ? err : new Error(String(err));
				setError(nextError);
				setStatus("error");
				notify.error(nextError.message);
			} finally {
				if (streamAdmissionsRef.current.delete(streamAdmission)) {
					streamAdmission.reject(new Error("Chat stream ended before admission"));
				}
				if (controller.signal.aborted) {
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
			reconcileSession,
			messagesRef,
			model,
			pendingSendControllerRef,
			refreshSessions,
			recoverFromForbiddenSession,
			sessionMetadataRef,
			setActivityLabelSynced,
			setError,
			setMessagesSynced,
			setStatus,
			streamControllersRef,
			status,
		],
	);

	return { enqueueDuringStream, handleStreamEvent, resetStreamAdmission, sendMessage, setAdapterCapabilities };
}
