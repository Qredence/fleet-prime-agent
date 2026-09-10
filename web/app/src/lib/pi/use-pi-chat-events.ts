import { readStoredValue, writeStoredValue } from "@prime-agent/web-design/lib/safe-storage";
import type {
	ChatSessionMetadata,
	ChatStreamEvent,
	FleetAdapterCapabilities,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { type MutableRefObject, useEffect } from "react";
import type { ChatClient } from "./chat-client";
import type { QueueState } from "./chat-fetch";
import { upsertAssistantReasoningPresentation, upsertToolPart } from "./chat-message-helpers";
import { resolveChatApiUrl } from "./chat-runtime-url";
import { EMPTY_QUEUE_STATE } from "./chat-stream-state";
import { hydratePlanPresentationMessages } from "./plan-presentation";

type SessionEventsOptions = {
	client: ChatClient;
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
	useEffect(() => {
		if (!sessionId || typeof window === "undefined") return;

		const lastEventIdKey = `pi:sse:last-event-id:${sessionId}`;
		const sseCapabilitiesRef = { current: undefined as FleetAdapterCapabilities | undefined };
		let lastEventId = Number.parseInt(readStoredValue(lastEventIdKey, "session") ?? "0", 10);
		if (Number.isNaN(lastEventId)) lastEventId = 0;

		let source: EventSource | null = null;
		let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
		let reconnectAttempt = 0;
		let reconnectNoticeShown = false;
		let lastAppliedRlmSeq = 0;
		let closedByEffect = false;
		let activeAssistantId: string | undefined;

		const handleEvent = (raw: MessageEvent<string>, seq: number) => {
			let frame: ChatStreamEvent;
			try {
				frame = JSON.parse(raw.data) as ChatStreamEvent;
			} catch {
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
			const connected = frame as unknown as {
				adapterCapabilities?: FleetAdapterCapabilities;
				cursorReset?: boolean;
				type?: string;
			};
			if (connected.type === "connected") {
				sseCapabilitiesRef.current = connected.adapterCapabilities;
				setAdapterCapabilities(connected.adapterCapabilities);
				if (connected.cursorReset) lastAppliedRlmSeq = 0;
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
				setActivityLabelSynced(typeof frame.state?.message === "string" ? frame.state.message : undefined);
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
			if (lastEventId > 0) params.set("lastEventId", String(lastEventId));
			source?.close();
			const nextSource = new EventSource(resolveChatApiUrl(`/api/chat/events?${params}`));
			source = nextSource;
			nextSource.onmessage = (event) => {
				// Browser EventSource implementations can still dispatch an already
				// queued event after close(). Do not let a previous connection update
				// the state after a reconnect or visible-session switch.
				if (closedByEffect || source !== nextSource) return;
				const seq = Number.parseInt(event.lastEventId ?? "", 10);
				if (!Number.isNaN(seq) && seq > 0) {
					lastEventId = seq;
					writeStoredValue(lastEventIdKey, String(seq), "session");
				}
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
		connect();

		return () => {
			closedByEffect = true;
			source?.close();
			if (reconnectTimer) clearTimeout(reconnectTimer);
		};
	}, [
		client,
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
