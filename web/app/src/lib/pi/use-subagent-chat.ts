import { readStoredValue, removeStoredValue, writeStoredValue } from "@prime-agent/web-design/lib/safe-storage";
import type {
	ChatSessionResponse,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentRlmChild,
} from "@prime-agent/web-protocol/chat-protocol";
import { ChatStreamEventSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatClient } from "./chat-client";
import { chatErrorFromStreamEvent, isUnknownSessionError, parseWithSchema } from "./chat-fetch";
import { createOptimisticUserMessage, removeOptimisticUserMessage } from "./chat-message-helpers";
import {
	applyChatStreamEvent,
	type ChatStreamSnapshot,
	type ChatStreamTransition,
	EMPTY_QUEUE_STATE,
} from "./chat-stream-state";

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

type StoredSubagentCursor = {
	generation: string;
	lastEventId: number;
};

/**
 * Loads a valid subagent event cursor from session storage.
 *
 * Invalid or unavailable stored data is removed and treated as absent.
 *
 * @param key - The session storage key containing the cursor
 * @returns The stored cursor, or `undefined` when no valid cursor is available
 */
function readStoredSubagentCursor(key: string): StoredSubagentCursor | undefined {
	try {
		const raw = readStoredValue(key, "session");
		if (!raw) return undefined;
		const value = JSON.parse(raw) as { generation?: unknown; lastEventId?: unknown };
		if (
			typeof value.generation !== "string" ||
			value.generation.length === 0 ||
			typeof value.lastEventId !== "number" ||
			!Number.isInteger(value.lastEventId) ||
			value.lastEventId < 0
		) {
			removeStoredValue(key, "session");
			return undefined;
		}
		return { generation: value.generation, lastEventId: value.lastEventId };
	} catch {
		removeStoredValue(key, "session");
		return undefined;
	}
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
	const childActiveSessionId = child?.activeSessionId;
	const childStatusValue = child?.status;
	const childError = child?.error;

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
			setState(emptyState());
			return;
		}

		let disposed = false;
		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let reconnectAttempt = 0;
		let reconnectClassificationInFlight = false;
		let lastEventId = 0;
		let streamGeneration: string | undefined;
		let terminalStream = false;
		let currentStatus: ChatStatus = childStatus(childStatusValue);
		const childKey = `${parentSessionId}:${childId}:${childActiveSessionId ?? ""}`;
		const cursorKey = `pi:sse:cursor:subagent:${childKey}`;
		const storedCursor = readStoredSubagentCursor(cursorKey);
		if (storedCursor) {
			streamGeneration = storedCursor.generation;
			lastEventId = storedCursor.lastEventId;
		}

		const persistCursor = () => {
			if (!streamGeneration) {
				removeStoredValue(cursorKey, "session");
				return;
			}
			writeStoredValue(cursorKey, JSON.stringify({ generation: streamGeneration, lastEventId }), "session");
		};
		const clearCursor = () => {
			lastEventId = 0;
			persistCursor();
		};
		const clearReconnectTimer = () => {
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
		};

		const updateFromTransition = (transition: ChatStreamTransition, nextStatus: ChatStatus, error?: Error) => {
			if (disposed || !isCurrent()) return;
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

		let connect = () => undefined;
		const scheduleReconnect = () => {
			if (disposed || !isCurrent() || terminalStream) return;
			reconnectAttempt += 1;
			clearReconnectTimer();
			reconnectTimer = setTimeout(connect, Math.min(2_000, 250 * 2 ** Math.min(reconnectAttempt, 3)));
		};
		const classifyAndReconnect = async () => {
			if (disposed || !isCurrent() || terminalStream || reconnectClassificationInFlight) return;
			reconnectClassificationInFlight = true;
			try {
				await loadSession(parentSessionId, childId);
				if (!disposed && isCurrent()) scheduleReconnect();
			} catch (error) {
				if (disposed || !isCurrent()) return;
				if (isUnknownSessionError(error)) {
					terminalStream = true;
					clearReconnectTimer();
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
				if (disposed || !isCurrent()) return;
				const transition = initialTransition(response);
				transitionRef.current = transition;
				setState({
					status: currentStatus,
					loading: false,
					messages: response.messages,
					presentation: response.presentation,
				});

				if (childStatusValue !== "running" && childStatusValue !== "recovering" && !sendActive) return;
				if (typeof window === "undefined" || typeof EventSource === "undefined") return;

				connect = () => {
					if (disposed || !isCurrent() || terminalStream) return;
					const url = client.openSubagentEvents(parentSessionId, childId, {
						...(streamGeneration ? { streamGeneration } : {}),
						...(lastEventId > 0 ? { lastEventId } : {}),
					});
					source?.close();
					try {
						source = new EventSource(url);
					} catch {
						void classifyAndReconnect();
						return;
					}
					source.onopen = () => {
						reconnectAttempt = 0;
					};
					source.onmessage = (event) => {
						if (disposed || !isCurrent() || terminalStream) return;
						const sequence = Number.parseInt(event.lastEventId ?? "", 10);
						if (Number.isFinite(sequence) && sequence > 0) {
							lastEventId = sequence;
							persistCursor();
						}

						let raw: unknown;
						try {
							raw = JSON.parse(event.data) as unknown;
						} catch {
							return;
						}
						if (isConnectedFrame(raw)) {
							if (raw.streamGeneration && streamGeneration !== raw.streamGeneration) {
								streamGeneration = raw.streamGeneration;
								clearCursor();
							} else if (raw.streamGeneration) {
								streamGeneration = raw.streamGeneration;
							}
							if (raw.cursorReset) clearCursor();
							persistCursor();
							return;
						}

						let frame: ChatStreamEvent;
						try {
							frame = parseWithSchema(ChatStreamEventSchema, raw, "Subagent chat stream event");
						} catch {
							return;
						}

						if (frame.type === "state" && frame.state.message === "resync-required") {
							clearCursor();
							source?.close();
							source = null;
							refresh();
							return;
						}

						const currentTransition = transitionRef.current;
						if (!currentTransition) return;
						const nextTransition = applyChatStreamEvent(currentTransition, frame);
						if (frame.type === "error") {
							terminalStream = true;
							clearReconnectTimer();
							source?.close();
							source = null;
							updateFromTransition(nextTransition, "error", chatErrorFromStreamEvent(frame));
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
								terminalStream = true;
								clearReconnectTimer();
								source?.close();
								source = null;
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
					};
					source.onerror = () => {
						source?.close();
						source = null;
						void classifyAndReconnect();
					};
				};

				connect();
			} catch (error) {
				if (disposed || !isCurrent()) return;
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
			terminalStream = true;
			source?.close();
			clearReconnectTimer();
		};
	}, [
		childActiveSessionId,
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
