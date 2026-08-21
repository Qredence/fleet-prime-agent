import { notify } from "@prime-agent/web-design/lib/notify";
import type {
	ChatMode,
	ChatModelSelection,
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import type { MutableRefObject } from "react";
import { useCallback, useRef } from "react";
import { captureChatSessionStarted, captureConversationSaved } from "@/lib/analytics-stub";
import type { ChatClient } from "./chat-client";
import type { QueueState } from "./chat-fetch";
import { assistantTextFromMessage, createTextMessage, upsertAssistantToolPart } from "./chat-message-helpers";
import { applyChatStreamEvent } from "./chat-stream-state";
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
	setPlanLabelSynced: (label: string | undefined) => void;
	setQueueSynced: (queue: QueueState) => void;
	setSessionMetadataSynced: (metadata: ChatSessionMetadata) => void;
	setStatus: (status: ChatStatus) => void;
};

export type UsePiChatMessagingOptions = PiChatMessagingRefs &
	PiChatMessagingSetters & {
		client: ChatClient;
		model: ChatModelSelection | undefined;
		projectId?: ProjectId;
		recoverFromForbiddenSession: () => Promise<void>;
		refreshSessions: () => Promise<void>;
		status: ChatStatus;
	};

export function usePiChatMessaging({
	activityLabelRef,
	client,
	messagesRef,
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
	const adapterCapabilitiesRef = useRef<FleetAdapterCapabilities | undefined>(undefined);
	const setAdapterCapabilities = useCallback((next: FleetAdapterCapabilities | undefined) => {
		adapterCapabilitiesRef.current = next;
	}, []);
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
		[client, projectId, refreshSessions, sessionMetadataRef, setSessionMetadataSynced],
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
			setSessionMetadataSynced(next.snapshot.sessionMetadata);
			setQueueSynced(next.snapshot.queue);
			setActivityLabelSynced(next.snapshot.activityLabel);
			setPlanLabelSynced(next.snapshot.planLabel);

			if (event.type === "done" && mode === "plan") {
				const initialPlanState = applyPlanModeSelection(createEmptyPlanState(), mode);
				const parsedPlan = updatePlanStateFromAssistantText(
					initialPlanState,
					assistantTextFromMessage(event.message),
				);
				const planState = bindPendingPlanDecisionToolCallId(parsedPlan.state, event.message.id);
				const planPart = parsedPlan.changed ? createPlanToolPart(event.message.id, planState) : undefined;
				if (planPart) {
					setMessagesSynced((current) => upsertAssistantToolPart(current, event.message.id, planPart));
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
			messagesRef,
			planLabelRef,
			queueRef,
			refreshSessions,
			sessionMetadataRef,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			setStatus,
		],
	);

	const enqueueDuringStream = useCallback(
		async (trimmed: string, streamingBehavior: "steer" | "followUp" = "steer", mode?: ChatMode) => {
			await ensureSession();
			const userMessage = createTextMessage("user", trimmed);
			setMessagesSynced((current) => [...current, userMessage]);
			setError(null);

			try {
				await client.streamMessage(
					{
						message: trimmed,
						model,
						mode,
						sessionId: sessionMetadataRef.current.sessionId,
						streamingBehavior,
					},
					(event) => {
						if (event.type === "queue") {
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
			} catch (err) {
				setMessagesSynced((current) => current.filter((message) => message.id !== userMessage.id));
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
		},
		[
			client,
			ensureSession,
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
			planAction,
			mode,
			/** Mirror of the Alt/Option modifier at Enter-press time. */
			altKey,
		}: SendMessageInput) => {
			const trimmed = text.trim();
			if (!trimmed || status === "submitted") return;

			if (status === "streaming") {
				try {
					// Enter during stream = steer into the current turn.
					// Alt+Enter during stream = queue a follow-up after this turn.
					await enqueueDuringStream(trimmed, altKey ? "followUp" : "steer", mode);
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

			const userMessage = createTextMessage("user", trimmed);
			setMessagesSynced((current) => [...current, userMessage]);
			const assistantIdRef = { current: null as string | null };
			const controller = new AbortController();
			pendingSendControllerRef.current = controller;
			let streamSessionId: string | undefined;

			try {
				const ensuredSession = await ensureSession(controller.signal);
				if (controller.signal.aborted) return;
				const ensuredStreamSessionId = ensuredSession.sessionId;
				if (!ensuredStreamSessionId) throw new Error("Unable to start a session stream");
				streamSessionId = ensuredStreamSessionId;
				streamControllersRef.current.set(ensuredStreamSessionId, controller);
				await client.streamMessage(
					{
						message: trimmed,
						attachments,
						openUI,
						model,
						planAction,
						mode,
						sessionId: ensuredStreamSessionId,
					},
					(event) => handleStreamEvent(event, assistantIdRef, ensuredStreamSessionId, mode),
					controller.signal,
				);

				if (sessionMetadataRef.current.sessionId === ensuredStreamSessionId) {
					setStatus("ready");
				}
				captureConversationSaved({
					messageCount: messagesRef.current.length,
					sessionId: ensuredStreamSessionId,
				});
			} catch (err) {
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
			handleStreamEvent,
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

	return { enqueueDuringStream, handleStreamEvent, sendMessage, setAdapterCapabilities };
}
