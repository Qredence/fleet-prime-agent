import { notify } from "@prime-agent/web-design/lib/notify";
import type { ChatModelSelection, ChatSessionMetadata, ChatStreamEvent } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { MutableRefObject } from "react";
import { useCallback, useRef } from "react";
import { captureChatSessionStarted, captureConversationSaved } from "@/lib/analytics-stub";
import type { ChatClient } from "./chat-client";
import type { QueueState } from "./chat-fetch";
import { createTextMessage } from "./chat-message-helpers";
import { applyChatStreamEvent } from "./chat-stream-state";
import type { SendMessageInput } from "./use-pi-chat";
import { tryRecoverForbiddenSession } from "./use-pi-chat-forbidden-session";

type PiChatMessagingRefs = {
	abortRef: MutableRefObject<AbortController | null>;
	activityLabelRef: MutableRefObject<string | undefined>;
	messagesRef: MutableRefObject<Array<ChatMessage>>;
	planLabelRef: MutableRefObject<string | undefined>;
	queueRef: MutableRefObject<QueueState>;
	sessionMetadataRef: MutableRefObject<ChatSessionMetadata>;
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
		recoverFromForbiddenSession: () => Promise<void>;
		refreshSessions: () => Promise<void>;
		status: ChatStatus;
	};

export function usePiChatMessaging({
	abortRef,
	activityLabelRef,
	client,
	messagesRef,
	model,
	planLabelRef,
	queueRef,
	recoverFromForbiddenSession,
	refreshSessions,
	sessionMetadataRef,
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
	const ensureSession = useCallback(async (): Promise<ChatSessionMetadata> => {
		const existing = sessionMetadataRef.current;
		if (existing.sessionId || existing.sessionFile) return existing;
		const inFlight = sessionCreatePromiseRef.current;
		if (inFlight) return inFlight;
		const promise = client
			.createSession()
			.then((created) => {
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
	}, [client, refreshSessions, sessionMetadataRef, setSessionMetadataSynced]);
	const handleStreamEvent = useCallback(
		(event: ChatStreamEvent, assistantIdRef: { current: string | null }) => {
			if (event.type === "error") {
				throw new Error(event.message);
			}

			const next = applyChatStreamEvent(
				{
					assistantId: assistantIdRef.current,
					snapshot: {
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
			setMessagesSynced(next.snapshot.messages);
			setSessionMetadataSynced(next.snapshot.sessionMetadata);
			setQueueSynced(next.snapshot.queue);
			setActivityLabelSynced(next.snapshot.activityLabel);
			setPlanLabelSynced(next.snapshot.planLabel);

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
		async (trimmed: string, streamingBehavior: "steer" | "followUp" = "steer") => {
			await ensureSession();
			const userMessage = createTextMessage("user", trimmed);
			setMessagesSynced((current) => [...current, userMessage]);
			setError(null);

			try {
				await client.streamMessage(
					{
						message: trimmed,
						model,
						sessionFile: sessionMetadataRef.current.sessionFile,
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
			planAction,
			/** Mirror of the Alt/Option modifier at Enter-press time. */
			altKey,
		}: SendMessageInput) => {
			const trimmed = text.trim();
			if (!trimmed || status === "submitted") return;

			if (status === "streaming") {
				try {
					// Enter during stream = steer into the current turn.
					// Alt+Enter during stream = queue a follow-up after this turn.
					await enqueueDuringStream(trimmed, altKey ? "followUp" : "steer");
				} catch (err) {
					const nextError = err instanceof Error ? err : new Error(String(err));
					setError(nextError);
					notify.error(nextError.message);
				}
				return;
			}

			const controller = new AbortController();
			abortRef.current?.abort();
			abortRef.current = controller;
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

			try {
				await ensureSession();
				await client.streamMessage(
					{
						message: trimmed,
						model,
						planAction,
						sessionFile: sessionMetadataRef.current.sessionFile,
						sessionId: sessionMetadataRef.current.sessionId,
					},
					(event) => handleStreamEvent(event, assistantIdRef),
					controller.signal,
				);

				setStatus("ready");
				captureConversationSaved({
					messageCount: messagesRef.current.length,
					sessionId: sessionMetadataRef.current.sessionId,
				});
			} catch (err) {
				if (controller.signal.aborted) return;
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
				if (abortRef.current === controller) {
					abortRef.current = null;
				}
			}
		},
		[
			abortRef,
			client,
			ensureSession,
			enqueueDuringStream,
			handleStreamEvent,
			messagesRef,
			model,
			recoverFromForbiddenSession,
			sessionMetadataRef,
			setActivityLabelSynced,
			setError,
			setMessagesSynced,
			setStatus,
			status,
		],
	);

	return { enqueueDuringStream, handleStreamEvent, sendMessage };
}
