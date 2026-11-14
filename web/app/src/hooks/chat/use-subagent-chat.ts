import type {
	ChatSessionResponse,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentRlmChild,
} from "@prime-agent/web-protocol/chat-protocol";
import { ChatStreamEventSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	createReconnectingEventSource,
	createSseCursorStore,
	type SseReconnectingController,
} from "@/hooks/chat/chat-sse";
import type { ChatClient } from "@/lib/chat/chat-client";
import { chatErrorFromStreamEvent, isUnknownSessionError, parseWithSchema } from "@/lib/chat/chat-fetch";
import { createOptimisticUserMessage, removeOptimisticUserMessage } from "@/lib/chat/chat-message-helpers";
import {
	applyChatStreamEvent,
	type ChatStreamSnapshot,
	type ChatStreamTransition,
	EMPTY_QUEUE_STATE,
} from "@/lib/chat/chat-stream-state";

export type SubagentChatState = {
	status: ChatStatus;
	loading: boolean;
	messages: Array<ChatMessage>;
	presentation?: ChatSessionResponse["presentation"];
	error?: Error;
};

/**
 * Maps a child lifecycle status to its corresponding chat status.
 *
 * @param status - The child lifecycle status
 * @returns The chat status represented by `status`
 */
function childStatus(status: PrimeAgentRlmChild["status"]): ChatStatus {
	if (status === "running" || status === "recovering") return "streaming";
	if (status === "error" || status === "failed") return "error";
	return "ready";
}

function emptyState(): SubagentChatState {
	return { status: "ready", loading: false, messages: [] };
}

/**
 * Creates an initial chat stream transition from a session response.
 *
 * @param response - The session response containing the initial messages, presentation, and metadata
 * @returns A chat stream transition initialized with the session snapshot
 */
function initialTransition(response: ChatSessionResponse): ChatStreamTransition {
	const snapshot: ChatStreamSnapshot = {
		messages: response.messages,
		presentation: response.presentation,
		queue: EMPTY_QUEUE_STATE,
		sessionMetadata: response.session,
	};
	return { assistantId: null, snapshot };
}

/**
 * Determines whether a value is a connected stream frame with a session identifier.
 *
 * @returns `true` if the value is a connected frame with a string session identifier, `false` otherwise.
 */
function isConnectedFrame(value: unknown): value is {
	type: "connected";
	sessionId: string;
	adapterCapabilities?: FleetAdapterCapabilities;
	streamGeneration?: string;
	cursorReset?: boolean;
	resumeAccepted?: boolean;
} {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "connected" &&
		typeof (value as { sessionId?: unknown }).sessionId === "string"
	);
}

/**
 * Loads and maintains a subagent chat session, including live stream updates.
 *
 * @param child - The subagent child whose chat session should be displayed.
 * @param parentSessionId - Identifier of the parent session containing the child.
 * @returns The current chat state and a function to reload the session.
 */
export function useSubagentChat({
	client,
	enabled,
	child,
	loadSession,
	parentSessionId,
}: {
	client: ChatClient;
	enabled: boolean;
	child?: PrimeAgentRlmChild;
	loadSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>;
	parentSessionId?: string;
}): SubagentChatState & {
	refresh: () => void;
	sendMessage: (text: string) => Promise<void>;
	sending: boolean;
	stop: () => void;
} {
	const [reloadToken, setReloadToken] = useState(0);
	const [state, setState] = useState<SubagentChatState>(emptyState);
	/** Keeps the SSE stream connected while a locally sent turn is in flight. */
	const [sendActive, setSendActive] = useState(false);
	const transitionRef = useRef<ChatStreamTransition | null>(null);
	const requestVersionRef = useRef(0);
	const sendControllerRef = useRef<{
		controller: AbortController;
		parentSessionId: string;
		childId: string;
	} | null>(null);
	const childId = child?.id;
	const childStatusValue = child?.status;
	const childError = child?.error;
	const childThreadIdentity =
		enabled && parentSessionId && childId && childStatusValue ? `${parentSessionId}:${childId}` : null;
	const [boundThreadIdentity, setBoundThreadIdentity] = useState(childThreadIdentity);
	if (childThreadIdentity !== boundThreadIdentity) {
		setBoundThreadIdentity(childThreadIdentity);
		setState(emptyState());
	}

	useEffect(() => {
		transitionRef.current = null;
	}, [childThreadIdentity]);

	const refresh = useCallback(() => setReloadToken((value) => value + 1), []);

	const sendMessage = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed || !parentSessionId || !childId) return;
			if (sendControllerRef.current) return;
			const controller = new AbortController();
			sendControllerRef.current = { controller, parentSessionId, childId };
			setSendActive(true);
			const userMessage = createOptimisticUserMessage(trimmed);
			setState((current) => ({
				...current,
				status: "streaming",
				loading: false,
				error: undefined,
				messages: [...current.messages, userMessage],
			}));
			try {
				// The POST response carries only control frames (start/done/error);
				// live turn content arrives on the child SSE stream, which stays
				// connected while this send is in flight. Reconcile heals gaps.
				await client.streamMessage(
					{ sessionId: parentSessionId, childId, message: trimmed, streamingBehavior: "steer" },
					(event) => {
						if (controller.signal.aborted) return;
						if (event.type === "error") throw chatErrorFromStreamEvent(event);
						if (event.type === "start") {
							setState((current) => ({ ...current, status: "streaming" }));
						}
					},
					controller.signal,
				);
				if (controller.signal.aborted) return;
				try {
					const response = await loadSession(parentSessionId, childId);
					if (controller.signal.aborted) return;
					const transition = initialTransition(response);
					transitionRef.current = transition;
					setState({
						status: "ready",
						loading: false,
						messages: response.messages,
						presentation: response.presentation,
					});
				} catch {
					setState((current) => ({ ...current, status: "ready", loading: false }));
				}
			} catch (error) {
				if (controller.signal.aborted) return;
				setState((current) => ({
					...current,
					status: "error",
					loading: false,
					messages: removeOptimisticUserMessage(current.messages, userMessage.id),
					error: error instanceof Error ? error : new Error(String(error)),
				}));
			} finally {
				if (sendControllerRef.current?.controller === controller) {
					sendControllerRef.current = null;
					setSendActive(false);
				}
			}
		},
		[childId, client, loadSession, parentSessionId],
	);

	const stop = useCallback(() => {
		const activeSend = sendControllerRef.current;
		activeSend?.controller.abort();
		sendControllerRef.current = null;
		const sessionIdToAbort = activeSend?.parentSessionId ?? parentSessionId;
		const childIdToAbort = activeSend?.childId ?? childId;
		if (sessionIdToAbort && childIdToAbort) {
			void client.abortSession({ sessionId: sessionIdToAbort, childId: childIdToAbort }).catch(() => undefined);
		}
		setSendActive(false);
		refresh();
	}, [childId, client, parentSessionId, refresh]);

	useEffect(() => {
		const requestVersion = requestVersionRef.current + 1;
		requestVersionRef.current = requestVersion;
		const isCurrent = () => requestVersionRef.current === requestVersion;
		if (reloadToken > 0) transitionRef.current = null;

		if (!enabled || !parentSessionId || !childId || !childStatusValue) {
			transitionRef.current = null;
			return;
		}

		let disposed = false;
		let subscription: SseReconnectingController | null = null;
		let reconnectClassificationInFlight = false;
		let currentStatus: ChatStatus = childStatus(childStatusValue);
		// Keyed on the child thread, not its active session: a session reset must
		// reuse (and clear) the same cursor instead of orphaning the old one.
		const cursorStore = createSseCursorStore({
			key: `pi:sse:cursor:subagent:${parentSessionId}:${childId}`,
			allowZeroLastEventId: true,
			removeWhenNoGeneration: true,
		});
		const isActive = () => !disposed && isCurrent();

		const updateFromTransition = (transition: ChatStreamTransition, nextStatus: ChatStatus, error?: Error) => {
			if (!isActive()) return;
			currentStatus = nextStatus;
			transitionRef.current = transition;
			setState({
				status: nextStatus,
				loading: false,
				messages: transition.snapshot.messages,
				presentation: transition.snapshot.presentation,
				...(error ? { error } : {}),
			});
		};

		const classifyAndReconnect = async (scheduleReconnect: () => void, closeStream: () => void) => {
			if (!isActive() || reconnectClassificationInFlight) return;
			reconnectClassificationInFlight = true;
			try {
				await loadSession(parentSessionId, childId);
				if (isActive()) scheduleReconnect();
			} catch (error) {
				if (!isActive()) return;
				if (isUnknownSessionError(error)) {
					closeStream();
					const message = error instanceof Error ? error : new Error(String(error));
					setState((current) => ({ ...current, status: "error", loading: false, error: message }));
					return;
				}
				scheduleReconnect();
			} finally {
				reconnectClassificationInFlight = false;
			}
		};

		const load = async () => {
			setState((current) => ({ ...current, loading: true, error: undefined }));
			try {
				const response = await loadSession(parentSessionId, childId);
				if (!isActive()) return;
				const transition = initialTransition(response);
				transitionRef.current = transition;
				setState({
					status: currentStatus,
					loading: false,
					messages: response.messages,
					presentation: response.presentation,
				});

				if (childStatusValue !== "running" && childStatusValue !== "recovering" && !sendActive) return;

				subscription = createReconnectingEventSource({
					canConnect: isActive,
					getUrl: () => {
						const { generation, lastEventId } = cursorStore.current();
						return client.openSubagentEvents(parentSessionId, childId, {
							...(generation ? { streamGeneration: generation } : {}),
							...(lastEventId > 0 ? { lastEventId } : {}),
						});
					},
					onMalformedJson: () => {
						subscription?.close();
						setState((current) => ({
							...current,
							status: "error",
							loading: false,
							error: new Error(
								"The subagent stream received an invalid event. Reload the conversation to refresh it.",
							),
						}));
					},
					onMessage: (raw, sequence) => {
						if (sequence !== undefined) {
							cursorStore.persist(sequence);
						}

						if (isConnectedFrame(raw)) {
							const currentCursor = cursorStore.current();
							if (raw.streamGeneration && currentCursor.generation !== raw.streamGeneration) {
								cursorStore.reset(raw.streamGeneration);
							} else {
								if (raw.streamGeneration) cursorStore.setGeneration(raw.streamGeneration);
								if (raw.cursorReset) cursorStore.reset();
								else cursorStore.persist(cursorStore.current().lastEventId);
							}
							return;
						}

						let frame: ChatStreamEvent;
						try {
							frame = parseWithSchema(ChatStreamEventSchema, raw, "Subagent chat stream event");
						} catch (error) {
							subscription?.close();
							setState((current) => ({
								...current,
								status: "error",
								loading: false,
								error: error instanceof Error ? error : new Error("Invalid subagent stream event"),
							}));
							return;
						}

						if (frame.type === "state" && frame.state.message === "resync-required") {
							cursorStore.reset();
							subscription?.close();
							refresh();
							return;
						}

						const currentTransition = transitionRef.current;
						if (!currentTransition) return;
						const nextTransition = applyChatStreamEvent(currentTransition, frame);
						if (frame.type === "error") {
							subscription?.close();
							updateFromTransition(nextTransition, "error", chatErrorFromStreamEvent(frame));
							return;
						}
						if (frame.type === "done" && frame.sessionReset) {
							cursorStore.reset();
							subscription?.close();
							refresh();
							return;
						}
						if (frame.type === "done") {
							updateFromTransition(nextTransition, "ready");
							return;
						}
						if (frame.type === "session_snapshot") {
							const snapshotError =
								frame.status === "error"
									? new Error(childError ?? "The subagent thread ended with an error.")
									: undefined;
							if (frame.terminal) {
								subscription?.close();
							}
							updateFromTransition(nextTransition, frame.status, snapshotError);
							return;
						}
						if (frame.type === "state") {
							const nextStatus =
								frame.state.name === "agent_start" || frame.state.name === "turn_start"
									? "streaming"
									: frame.state.name === "agent_end" || frame.state.name === "turn_end"
										? "ready"
										: currentStatus;
							updateFromTransition(nextTransition, nextStatus);
							return;
						}
						updateFromTransition(nextTransition, currentStatus);
					},
					onError: ({ scheduleReconnect, close }) => {
						void classifyAndReconnect(scheduleReconnect, close);
					},
				});

				subscription.connect();
			} catch (error) {
				if (!isActive()) return;
				setState((current) => ({
					...current,
					status: "error",
					loading: false,
					error: error instanceof Error ? error : new Error(String(error)),
				}));
			}
		};

		void load();
		return () => {
			disposed = true;
			subscription?.close();
		};
	}, [
		childId,
		childError,
		childStatusValue,
		client,
		enabled,
		loadSession,
		parentSessionId,
		refresh,
		reloadToken,
		sendActive,
	]);

	return { ...state, refresh, sendMessage, sending: sendActive, stop };
}
