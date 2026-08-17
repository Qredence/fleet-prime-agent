import { notify } from "@prime-agent/web-design/lib/notify";
import type {
	ChatMode,
	ChatModelSelection,
	ChatPlanAction,
	ChatQuestionAnswer,
	ChatSessionInfo,
	ChatSessionMetadata,
	ChatStreamEvent,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ChatAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatClient } from "./chat-client";
import { chatClient } from "./chat-client";
import type { QueueState } from "./chat-fetch";
import { resolveChatApiUrl } from "./chat-runtime-url";
import { EMPTY_QUEUE_STATE, normalizeSessionMetadata } from "./chat-stream-state";
import { isPlanDecisionToolCall } from "./plan-state";
import { runForbiddenSessionRecovery, tryRecoverForbiddenSession } from "./use-pi-chat-forbidden-session";
import { usePiChatMessaging } from "./use-pi-chat-messaging";
import { enhancePlanDecisionMessages, resolvePlanDecisionMessages } from "./use-pi-chat-plan-decisions";

export type SendMessageInput = {
	text: string;
	attachments?: Array<ChatAttachment>;
	openUI?: boolean;
	planAction?: ChatPlanAction;
	mode?: ChatMode;
	/** Mirror of the Alt/Option modifier at Enter-press time. */
	altKey?: boolean;
};

export type UsePiChatOptions = {
	client?: ChatClient;
	initialSessionMetadata: ChatSessionMetadata;
	projectId?: string;
	persistSession: (metadata: ChatSessionMetadata) => void;
};

export function usePiChat(model: ChatModelSelection | undefined, options: UsePiChatOptions) {
	const { client = chatClient, initialSessionMetadata, persistSession, projectId } = options;
	const [messages, setMessages] = useState<Array<ChatMessage>>([]);
	const [status, setStatus] = useState<ChatStatus>("ready");
	const [error, setError] = useState<Error | null>(null);
	const [sessionMetadata, setSessionMetadata] = useState<ChatSessionMetadata>(() => initialSessionMetadata);
	const [sessions, setSessions] = useState<Array<ChatSessionInfo>>([]);
	const [activityLabel, setActivityLabel] = useState<string | undefined>();
	const [planLabel, setPlanLabel] = useState<string | undefined>();
	const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE_STATE);
	const initialSessionMetadataRef = useRef(initialSessionMetadata);
	const messagesRef = useRef(messages);
	const sessionMetadataRef = useRef(sessionMetadata);
	const activityLabelRef = useRef(activityLabel);
	const planLabelRef = useRef(planLabel);
	const queueRef = useRef(queue);
	const pendingSendControllerRef = useRef<AbortController | null>(null);
	const streamControllersRef = useRef(new Map<string, AbortController>());
	const statusRef = useRef(status);
	const initializedRef = useRef(false);
	const sendMessageRef = useRef<(input: SendMessageInput) => Promise<void>>(() => Promise.resolve());
	const setMessagesSynced = useCallback(
		(updater: Array<ChatMessage> | ((current: Array<ChatMessage>) => Array<ChatMessage>)) => {
			const next = typeof updater === "function" ? updater(messagesRef.current) : updater;
			messagesRef.current = next;
			setMessages(next);
		},
		[],
	);

	// Append an assistant-role message from the web UI itself (never sent to
	// prime-agent). Used by slash-command handlers (/session /context /logs
	// /export /reload /fast …) to echo the result into the conversation the
	// way the TUI's `showStatus`/`showError` does. Not persisted to disk —
	// these are modal echoes for the user, not transcript entries the agent
	// should reason over.
	const appendLocalMessage = useCallback(
		(text: string) => {
			setMessagesSynced((current) => [
				...current,
				{
					id: crypto.randomUUID(),
					role: "assistant" as const,
					source: "local",
					createdAt: Date.now(),
					parts: [{ type: "text" as const, text }],
				},
			]);
		},
		[setMessagesSynced],
	);

	const setSessionMetadataSynced = useCallback(
		(metadata: ChatSessionMetadata) => {
			const current = sessionMetadataRef.current;
			const next = normalizeSessionMetadata(metadata);
			if (current.sessionId === next.sessionId && current.projectId === next.projectId) {
				return;
			}

			sessionMetadataRef.current = next;
			setSessionMetadata(next);
			persistSession(next);
		},
		[persistSession],
	);

	const setActivityLabelSynced = useCallback((nextLabel: string | undefined) => {
		activityLabelRef.current = nextLabel;
		setActivityLabel(nextLabel);
	}, []);

	const setPlanLabelSynced = useCallback((nextLabel: string | undefined) => {
		planLabelRef.current = nextLabel;
		setPlanLabel(nextLabel);
	}, []);

	const setQueueSynced = useCallback((nextQueue: QueueState) => {
		queueRef.current = nextQueue;
		setQueue(nextQueue);
	}, []);

	const refreshSessions = useCallback(async () => {
		const nextSessions = await client.listSessions();
		setSessions(nextSessions);
	}, [client]);

	const recoverFromForbiddenSession = useCallback(
		() =>
			runForbiddenSessionRecovery({
				client,
				projectId,
				refreshSessions,
				setActivityLabelSynced,
				setError,
				setMessagesSynced,
				setPlanLabelSynced,
				setQueueSynced,
				setSessionMetadataSynced,
				setStatus,
			}),
		[
			client,
			projectId,
			refreshSessions,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
		],
	);

	const submitQuestionAnswer = useCallback(
		async ({ toolCallId, answer }: { toolCallId?: string; answer: ChatQuestionAnswer }) => {
			const result = await client.answerQuestion({
				sessionId: sessionMetadataRef.current.sessionId,
				toolCallId,
				answer,
			});

			if (result.ok && isPlanDecisionToolCall(toolCallId)) {
				setMessagesSynced((current) => resolvePlanDecisionMessages(current, toolCallId, answer));
			}
			if (result.message) {
				await sendMessageRef.current({
					text: result.message,
					planAction: result.planAction,
				});
			}

			return result;
		},
		[client, setMessagesSynced],
	);

	const enhanceMessages = useCallback(
		(currentMessages: Array<ChatMessage>) => enhancePlanDecisionMessages(currentMessages, submitQuestionAnswer),
		[submitQuestionAnswer],
	);

	useEffect(() => {
		sessionMetadataRef.current = sessionMetadata;
	}, [sessionMetadata]);

	useEffect(() => {
		statusRef.current = status;
	}, [status]);

	useEffect(() => {
		initialSessionMetadataRef.current = initialSessionMetadata;
	}, [initialSessionMetadata]);

	useEffect(() => {
		const controllers = streamControllersRef.current;
		return () => {
			pendingSendControllerRef.current?.abort();
			pendingSendControllerRef.current = null;
			for (const controller of controllers.values()) controller.abort();
			controllers.clear();
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		void refreshSessions().catch((err) => {
			if (cancelled) return;
			const nextError = err instanceof Error ? err : new Error(String(err));
			setError(nextError);
			notify.error(nextError.message);
		});
		return () => {
			cancelled = true;
		};
	}, [refreshSessions]);

	useEffect(() => {
		if (initializedRef.current) return;
		initializedRef.current = true;
		const controller = new AbortController();
		setStatus("ready");
		setError(null);
		setQueueSynced(EMPTY_QUEUE_STATE);
		setActivityLabelSynced(undefined);
		setPlanLabelSynced(undefined);
		setMessagesSynced([]);

		const storedSession = initialSessionMetadataRef.current;
		const hasStoredSession = storedSession.sessionId;
		if (!hasStoredSession) {
			setSessionMetadataSynced({});
			return () => controller.abort();
		}

		void client
			.loadSession(storedSession)
			.then((result) => {
				if (controller.signal.aborted) return;
				setSessionMetadataSynced(result.session);
				setMessagesSynced(result.messages);
				setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				return tryRecoverForbiddenSession(err, recoverFromForbiddenSession, {
					setError,
					setStatus,
				}).then((recovered) => {
					if (recovered || controller.signal.aborted) return;
					const nextError = err instanceof Error ? err : new Error(String(err));
					setError(nextError);
					setStatus("error");
					notify.error(nextError.message);
				});
			});

		return () => {
			controller.abort();
		};
	}, [
		client,
		setActivityLabelSynced,
		setMessagesSynced,
		setPlanLabelSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		recoverFromForbiddenSession,
	]);

	const { sendMessage } = usePiChatMessaging({
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
		setActivityLabelSynced,
		setError,
		setMessagesSynced,
		setPlanLabelSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		setStatus,
		streamControllersRef,
		status,
	});

	const stop = useCallback(() => {
		pendingSendControllerRef.current?.abort();
		pendingSendControllerRef.current = null;
		const metadata = sessionMetadataRef.current;
		if (metadata.sessionId) {
			void client.abortSession(metadata).catch(() => undefined);
		}
		if (metadata.sessionId) {
			streamControllersRef.current.get(metadata.sessionId)?.abort();
			streamControllersRef.current.delete(metadata.sessionId);
		}
		setStatus("ready");
		setQueueSynced(EMPTY_QUEUE_STATE);
		setActivityLabelSynced(undefined);
	}, [client, setActivityLabelSynced, setQueueSynced]);

	const startNewSession = useCallback(
		async (options?: { projectId?: string; preserveRunning?: boolean }) => {
			if (options?.preserveRunning === false) stop();
			else setStatus("ready");
			const result = await client.createSession(options?.projectId ?? projectId);
			setSessionMetadataSynced(result.session);
			setMessagesSynced([]);
			setQueueSynced(EMPTY_QUEUE_STATE);
			setActivityLabelSynced(undefined);
			setPlanLabelSynced(undefined);
			notify.success("New session started");
			await refreshSessions();
		},
		[
			client,
			refreshSessions,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			stop,
			projectId,
		],
	);

	const resumeSession = useCallback(
		async (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => {
			try {
				if (options?.preserveRunning === false) stop();
				const result = await client.resumeSession(metadata);
				setSessionMetadataSynced(result.session);
				setMessagesSynced(result.messages);
				setQueueSynced(EMPTY_QUEUE_STATE);
				setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
				setPlanLabelSynced(undefined);
				setStatus(streamControllersRef.current.has(result.session.sessionId ?? "") ? "streaming" : "ready");
				notify.success("Session resumed");
				await refreshSessions();
				return true;
			} catch (err) {
				if (
					await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, {
						setError,
						setStatus,
					})
				) {
					return false;
				}
				const nextError = err instanceof Error ? err : new Error(String(err));
				setError(nextError);
				setStatus("error");
				notify.error(nextError.message);
				return false;
			}
		},
		[
			client,
			recoverFromForbiddenSession,
			refreshSessions,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
			stop,
		],
	);

	const switchProject = useCallback(
		async (nextProjectId: string, nextSessionId?: string) => {
			if (nextSessionId) {
				return resumeSession({ sessionId: nextSessionId, projectId: nextProjectId }, { preserveRunning: true });
			}
			setSessionMetadataSynced({ projectId: nextProjectId });
			setMessagesSynced([]);
			setQueueSynced(EMPTY_QUEUE_STATE);
			setActivityLabelSynced(undefined);
			setPlanLabelSynced(undefined);
			setStatus("ready");
			return true;
		},
		[
			resumeSession,
			setActivityLabelSynced,
			setMessagesSynced,
			setPlanLabelSynced,
			setQueueSynced,
			setSessionMetadataSynced,
		],
	);

	useEffect(() => {
		sendMessageRef.current = sendMessage;
	}, [sendMessage]);

	// Per-visible-session EventSource with Last-Event-ID resumption. The
	// NDJSON stream in `use-pi-chat-messaging` is authoritative for in-flight
	// turns; this source carries server-side pushes (dialog requests, notify)
	// that arrive outside a turn.
	useEffect(() => {
		const sessionId = sessionMetadata.sessionId;
		if (!sessionId || typeof window === "undefined") return;

		const lastEventIdKey = `pi:sse:last-event-id:${sessionId}`;
		let lastEventId = Number.parseInt(window.sessionStorage.getItem(lastEventIdKey) ?? "0", 10);
		if (Number.isNaN(lastEventId)) lastEventId = 0;

		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let closedByEffect = false;

		const handleEvent = (raw: MessageEvent<string>) => {
			let frame: ChatStreamEvent;
			try {
				frame = JSON.parse(raw.data) as ChatStreamEvent;
			} catch {
				return;
			}
			// In-flight NDJSON stream is authoritative; only act on out-of-turn pushes.
			const currentStatus = statusRef.current;
			if (currentStatus === "streaming" || currentStatus === "submitted") return;
			if (frame.type === "tool" && frame.part?.type === "tool-Question") {
				setMessagesSynced((current) => {
					const toolCallId = frame.part.toolCallId ?? "";
					const existingToolCallIndex = current.findIndex((message) =>
						message.parts.some(
							(p) => p.type !== "text" && p.type !== "error" && "toolCallId" in p && p.toolCallId === toolCallId,
						),
					);
					if (existingToolCallIndex !== -1) return current;
					const questionPart: ChatMessage["parts"][number] = {
						...frame.part,
						type: "tool-Question",
					};
					return [
						...current,
						{
							id: crypto.randomUUID(),
							role: "assistant",
							parts: [questionPart],
							createdAt: new Date().toISOString(),
						},
					];
				});
				return;
			}
			if (frame.type === "state") {
				setActivityLabelSynced(typeof frame.state?.message === "string" ? frame.state.message : undefined);
				if (frame.state?.name === "agent_settled") {
					// Server asked us to resync — refetch the session transcript and
					// rebuild the UI state without spinning up a new turn.
					const settledSessionId = sessionId;
					void client
						.loadSession({ sessionId: settledSessionId })
						.then((result) => {
							if (sessionMetadataRef.current.sessionId !== settledSessionId) return;
							setMessagesSynced(result.messages);
							setSessionMetadataSynced(result.session);
							setQueueSynced(EMPTY_QUEUE_STATE);
						})
						.catch(() => undefined);
				}
				return;
			}
			if (frame.type === "queue") {
				setQueueSynced({ steering: frame.steering, followUp: frame.followUp });
				return;
			}
		};

		const connect = () => {
			const params = new URLSearchParams({ sessionId });
			if (lastEventId > 0) {
				// EventSource only sends Last-Event-ID on native reconnect of the same
				// instance. Closing it (below) starts a new connection, so pass the
				// stored cursor as a query param the server also accepts.
				params.set("lastEventId", String(lastEventId));
			}
			const url = resolveChatApiUrl(`/api/chat/events?${params}`);
			source?.close();
			source = new EventSource(url);
			source.onmessage = (event) => {
				const seq = Number.parseInt(event.lastEventId ?? "", 10);
				if (!Number.isNaN(seq) && seq > 0) {
					lastEventId = seq;
					window.sessionStorage.setItem(lastEventIdKey, String(seq));
				}
				handleEvent(event);
			};
			source.onerror = () => {
				source?.close();
				if (closedByEffect) return;
				// Exponential-ish backoff, capped. EventSource does its own reconnect,
				// but a manual retry makes timing deterministic for the dialog flow.
				if (reconnectTimer) clearTimeout(reconnectTimer);
				reconnectTimer = setTimeout(connect, 2_000);
			};
		};
		connect();

		return () => {
			closedByEffect = true;
			source?.close();
			if (reconnectTimer) clearTimeout(reconnectTimer);
		};
	}, [
		client,
		sessionMetadata.sessionId,
		setActivityLabelSynced,
		setMessagesSynced,
		setQueueSynced,
		setSessionMetadataSynced,
	]);

	const enhancedMessages = useMemo(() => enhanceMessages(messages), [messages, enhanceMessages]);
	const renameSession = useCallback(
		async (sessionId: string, title: string) => {
			await client.renameSession(sessionId, title);
			await refreshSessions();
		},
		[client, refreshSessions],
	);
	const deleteSession = useCallback(
		async (sessionId: string) => {
			const deletingActive = sessionMetadataRef.current.sessionId === sessionId;
			if (deletingActive) stop();
			await client.deleteSession(sessionId);
			if (deletingActive) {
				setSessionMetadataSynced({});
				setMessagesSynced([]);
			}
			await refreshSessions();
		},
		[client, refreshSessions, setMessagesSynced, setSessionMetadataSynced, stop],
	);

	const answerQuestion = submitQuestionAnswer;

	const getSessionMetadata = useCallback(() => sessionMetadataRef.current, []);
	const getMessages = useCallback(() => messagesRef.current, []);

	return {
		activityLabel,
		answerQuestion,
		appendLocalMessage,
		deleteSession,
		error,
		getMessages,
		getSessionMetadata,
		messages: enhancedMessages,
		planLabel,
		queue,
		renameSession,
		refreshSessions,
		resumeSession,
		sendMessage,
		sessionMetadata,
		sessions,
		setError,
		startNewSession,
		status,
		stop,
		switchProject,
	};
}
