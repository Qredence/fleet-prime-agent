import type {
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import { ChatStreamEventCursorSchema, ChatStreamEventSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { type MutableRefObject, useEffect, useRef } from "react";
import type { ChatClient } from "@/components/chat/chat-client";
import type { QueueState } from "@/components/chat/chat-fetch";
import {
	applyAssistantReasoningText,
	createTextMessage,
	upsertAssistantReasoningPresentation,
	upsertToolPart,
} from "@/components/chat/chat-message-helpers";
import { resolveChatApiUrl } from "@/components/chat/chat-runtime-url";
import type { ChatStreamRecoveryState } from "@/components/chat/chat-stream-recovery";
import { EMPTY_QUEUE_STATE } from "@/components/chat/chat-stream-state";
import { hydratePlanPresentationMessages } from "@/components/chat/plans/plan-presentation";
import { readStoredValue, writeStoredValue } from "@/lib/safe-storage";

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
}: SessionEventsOptions) {
	const internalRecoveryRef = useRef<ChatStreamRecoveryState>({ active: false, needsSnapshot: false });
	const activeRecoveryRef = recoveryRef ?? internalRecoveryRef;
	useEffect(() => {
		if (!sessionId || typeof window === "undefined") return;
		if (!activeRecoveryRef.current.active && activeRecoveryRef.current.sessionId !== sessionId) {
			activeRecoveryRef.current.sessionId = sessionId;
			activeRecoveryRef.current.cursor = undefined;
			activeRecoveryRef.current.needsSnapshot = false;
		}

		const lastEventIdKey = `pi:sse:last-event-id:${sessionId}`;
		const sseCapabilitiesRef = { current: undefined as FleetAdapterCapabilities | undefined };
		let streamGeneration: string | undefined;
		let lastEventId = 0;
		const rawStoredCursor = readStoredValue(lastEventIdKey, "session");
		if (rawStoredCursor) {
			if (rawStoredCursor.startsWith("{")) {
				try {
					const parsed = JSON.parse(rawStoredCursor) as { generation?: unknown; lastEventId?: unknown };
					if (typeof parsed.generation === "string" && parsed.generation.length > 0) {
						streamGeneration = parsed.generation;
					}
					if (
						typeof parsed.lastEventId === "number" &&
						Number.isInteger(parsed.lastEventId) &&
						parsed.lastEventId > 0
					) {
						lastEventId = parsed.lastEventId;
					}
				} catch {
					lastEventId = 0;
				}
			} else {
				const parsed = Number.parseInt(rawStoredCursor, 10);
				if (!Number.isNaN(parsed) && parsed > 0) lastEventId = parsed;
			}
		}
		if (!activeRecoveryRef.current.cursor && streamGeneration) {
			activeRecoveryRef.current.cursor = { generation: streamGeneration, sequence: lastEventId };
		}
		const persistCursor = (nextSeq: number, nextGeneration = streamGeneration) => {
			lastEventId = nextSeq;
			streamGeneration = nextGeneration;
			if (nextGeneration) {
				writeStoredValue(
					lastEventIdKey,
					JSON.stringify({ generation: nextGeneration, lastEventId: nextSeq }),
					"session",
				);
			} else {
				writeStoredValue(lastEventIdKey, String(nextSeq), "session");
			}
		};

		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let reconnectAttempt = 0;
		let reconnectNoticeShown = false;
		let lastAppliedRlmSeq = 0;
		let closedByEffect = false;
		let activeAssistantId: string | undefined;

		const handleEvent = (raw: MessageEvent<string>, seq: number) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw.data);
			} catch {
				if (activeRecoveryRef.current.active) activeRecoveryRef.current.needsSnapshot = true;
				return;
			}
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
							sequence: connected.cursorReset ? 0 : lastEventId,
						};
					}
					streamGeneration = connected.streamGeneration;
				}
				if (connected.cursorReset) {
					lastAppliedRlmSeq = 0;
					if (activeRecoveryRef.current.active) activeRecoveryRef.current.needsSnapshot = true;
					else {
						persistCursor(0, streamGeneration);
						if (streamGeneration) {
							activeRecoveryRef.current.cursor = { generation: streamGeneration, sequence: 0 };
						}
					}
				}
				if (activeRecoveryRef.current.active && !activeRecoveryRef.current.needsSnapshot) {
					setActivityLabelSynced(undefined);
				}
				return;
			}
			const validation = ChatStreamEventSchema.safeParse(parsed);
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
						persistCursor(cursor.sequence, cursor.generation);
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
					persistCursor(cursor.sequence, cursor.generation);
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
			// Snapshot for dispatch-time checks below the streaming guard, where the
			// narrowed type no longer includes the in-flight statuses.
			const statusAtFrame = statusRef.current;
			if (frame.type === "presentation") {
				if (frame.presentation.revision > (presentationRef.current?.revision ?? -1)) {
					setPresentationSynced(frame.presentation);
				}
				return;
			}
			if (frame.type === "rlm") {
				// ChatRlmStreamEvent carries no revision, so order frames by the SSE
				// stream sequence: drop redelivered sequences so a stale replay cannot
				// clobber newer child state.
				if (!Number.isNaN(seq) && seq > 0) {
					if (seq <= lastAppliedRlmSeq) return;
					lastAppliedRlmSeq = seq;
				}
				const current = presentationRef.current;
				const existing = current.rlmChildren.find((child) => child.id === frame.child.id);
				if (existing && existing.timestamp > frame.child.timestamp) return;
				setPresentationSynced({
					...current,
					rlmChildren: [...current.rlmChildren.filter((child) => child.id !== frame.child.id), frame.child],
					...(frame.tree ? { rlmTree: frame.tree } : {}),
				});
				return;
			}
			// Clarification questions surface even while a turn is streaming: the
			// POST stream owns state/queue frames during streaming, but a pending
			// tool-Question blocks progress until answered. Dedupe by toolCallId
			// keeps redeliveries from duplicating the prompt.
			if (frame.type === "tool" && frame.part?.type === "tool-Question") {
				setMessagesSynced((current) => {
					const toolCallId = frame.part.toolCallId ?? "";
					if (!toolCallId) return current;
					const hasToolCall = (message: ChatMessage) =>
						message.parts.some(
							(part) =>
								part.type !== "text" &&
								part.type !== "error" &&
								"toolCallId" in part &&
								part.toolCallId === toolCallId,
						);
					let targetIndex = frame.messageId
						? current.findIndex((message) => message.id === frame.messageId && message.role === "assistant")
						: -1;
					if (targetIndex < 0 && activeAssistantId) {
						targetIndex = current.findIndex(
							(message) => message.id === activeAssistantId && message.role === "assistant",
						);
					}
					if (targetIndex < 0) {
						let latestAssistantWithoutToolCall = -1;
						let latestMatchingToolCall = -1;
						for (let index = current.length - 1; index >= 0; index -= 1) {
							const message = current[index]!;
							if (message.role !== "assistant") continue;
							if (hasToolCall(message) && latestMatchingToolCall < 0) latestMatchingToolCall = index;
							else if (latestAssistantWithoutToolCall < 0) latestAssistantWithoutToolCall = index;
						}
						// The first question frame normally races the POST stream's start
						// frame, so attach it to the newest assistant bubble that has not
						// seen this tool call yet. Later output frames update the existing
						// matching part instead.
						targetIndex =
							frame.part.state === "input-streaming"
								? latestAssistantWithoutToolCall >= 0
									? latestAssistantWithoutToolCall
									: latestMatchingToolCall
								: latestMatchingToolCall >= 0
									? latestMatchingToolCall
									: latestAssistantWithoutToolCall;
					}
					const questionPart: ChatMessage["parts"][number] = { ...frame.part, type: "tool-Question" };
					if (targetIndex < 0) {
						return [
							...current,
							{
								id: frame.messageId ?? crypto.randomUUID(),
								role: "assistant",
								parts: [questionPart],
								createdAt: new Date().toISOString(),
							},
						];
					}
					return current.flatMap((message, index) => {
						if (index === targetIndex) {
							return [{ ...message, parts: upsertToolPart(message.parts, questionPart) }];
						}
						if (!hasToolCall(message)) return [message];
						const parts = message.parts.filter(
							(part) =>
								!(
									part.type !== "text" &&
									part.type !== "error" &&
									"toolCallId" in part &&
									part.toolCallId === toolCallId
								),
						);
						return parts.length > 0 ? [{ ...message, parts }] : [];
					});
				});
				return;
			}
			if (statusRef.current === "streaming" || statusRef.current === "submitted") return;
			if (frame.type === "reasoning_text" && frame.messageId) {
				const messageId = frame.messageId;
				setMessagesSynced((current) =>
					applyAssistantReasoningText(
						current.some((message) => message.id === messageId)
							? current
							: [...current, createTextMessage("assistant", "", messageId)],
						messageId,
						frame,
					),
				);
				return;
			}
			if (frame.type === "reasoning") {
				const messageId = frame.messageId;
				if (!sseCapabilitiesRef.current?.features.includes("reasoning-summary-v1") || !messageId) return;
				setMessagesSynced((current) =>
					upsertAssistantReasoningPresentation(current, messageId, frame.presentation),
				);
				return;
			}
			if (frame.type === "state") {
				const nextActivityLabel =
					frame.state?.name === "agent_settled" || frame.state?.message === "resync-required"
						? undefined
						: typeof frame.state?.message === "string"
							? frame.state.message
							: undefined;
				setActivityLabelSynced(nextActivityLabel);
				if (frame.state?.name === "agent_settled") {
					// Hydration replays the full session snapshot: skip while a turn
					// is in flight so it cannot clobber optimistic or streamed state.
					if (statusAtFrame === "streaming" || statusAtFrame === "submitted") return;
					const metadataSessionIdAtFrame = sessionMetadataRef.current.sessionId;
					void client
						.loadSession({ sessionId })
						.then((result) => {
							if (closedByEffect || sessionMetadataRef.current.sessionId !== sessionId) return;
							if (sessionMetadataRef.current.sessionId !== metadataSessionIdAtFrame) return;
							if (statusRef.current === "streaming" || statusRef.current === "submitted") return;
							setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
							setPresentationSynced(result.presentation);
							setSessionMetadataSynced(result.session);
							setQueueSynced(EMPTY_QUEUE_STATE);
						})
						.catch(() => undefined);
				}
				return;
			}
			if (frame.type === "queue") setQueueSynced({ steering: frame.steering, followUp: frame.followUp });
		};

		const connect = () => {
			const params = new URLSearchParams({ sessionId });
			const recoveryCursor = activeRecoveryRef.current.active ? activeRecoveryRef.current.cursor : undefined;
			const requestedGeneration = recoveryCursor?.generation ?? streamGeneration;
			const requestedSequence = recoveryCursor?.sequence ?? lastEventId;
			if (requestedGeneration) params.set("streamGeneration", requestedGeneration);
			if (requestedSequence > 0) params.set("lastEventId", String(requestedSequence));
			source?.close();
			const nextSource = new EventSource(resolveChatApiUrl(`/api/chat/events?${params}`));
			source = nextSource;
			nextSource.onmessage = (event) => {
				// Browser EventSource implementations can still dispatch an already
				// queued event after close(). Do not let a previous connection update
				// the state after a reconnect or visible-session switch.
				if (closedByEffect || source !== nextSource) return;
				const seq = Number.parseInt(event.lastEventId ?? "", 10);
				if (reconnectAttempt > 0) {
					reconnectAttempt = 0;
					if (reconnectNoticeShown) {
						reconnectNoticeShown = false;
						if (statusRef.current !== "streaming" && statusRef.current !== "submitted") {
							setActivityLabelSynced(undefined);
						}
					}
				}
				handleEvent(event, seq);
				if (
					!activeRecoveryRef.current.active &&
					statusRef.current !== "streaming" &&
					statusRef.current !== "submitted" &&
					!Number.isNaN(seq) &&
					seq > 0
				) {
					persistCursor(seq, streamGeneration);
					if (streamGeneration) {
						activeRecoveryRef.current.cursor = { generation: streamGeneration, sequence: seq };
					}
				}
			};
			nextSource.onerror = () => {
				if (closedByEffect || source !== nextSource) return;
				nextSource.close();
				reconnectAttempt += 1;
				// The first failure reconnects silently; persistent failures escalate
				// the activity label so a dead stream stays visible. Retries never stop.
				if (reconnectAttempt > 1 && statusRef.current !== "streaming" && statusRef.current !== "submitted") {
					reconnectNoticeShown = true;
					setActivityLabelSynced(
						reconnectAttempt > 2 ? `Reconnecting… (attempt ${reconnectAttempt})` : "Reconnecting…",
					);
				}
				if (reconnectTimer) clearTimeout(reconnectTimer);
				reconnectTimer = setTimeout(connect, Math.min(2_000, 250 * 2 ** Math.min(reconnectAttempt, 3)));
			};
		};
		const requestReconnect = () => {
			if (closedByEffect) return;
			if (reconnectTimer) clearTimeout(reconnectTimer);
			reconnectTimer = null;
			reconnectAttempt = 0;
			connect();
		};
		activeRecoveryRef.current.requestReconnect = requestReconnect;
		connect();

		return () => {
			closedByEffect = true;
			if (activeRecoveryRef.current.requestReconnect === requestReconnect) {
				activeRecoveryRef.current.requestReconnect = undefined;
			}
			source?.close();
			if (reconnectTimer) clearTimeout(reconnectTimer);
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
	]);
}
