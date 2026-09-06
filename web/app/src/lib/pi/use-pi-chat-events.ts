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
import { upsertAssistantReasoningPresentation } from "./chat-message-helpers";
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
			if (frame.type === "presentation") {
				if (frame.presentation.revision > (presentationRef.current?.revision ?? -1)) {
					setPresentationSynced(frame.presentation);
				}
				return;
			}
			if (frame.type === "rlm") {
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
			if (statusRef.current === "streaming" || statusRef.current === "submitted") return;
			const connected = frame as unknown as { adapterCapabilities?: FleetAdapterCapabilities; type?: string };
			if (connected.type === "connected") {
				sseCapabilitiesRef.current = connected.adapterCapabilities;
				setAdapterCapabilities(connected.adapterCapabilities);
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
			if (frame.type === "tool" && frame.part?.type === "tool-Question") {
				setMessagesSynced((current) => {
					const toolCallId = frame.part.toolCallId ?? "";
					if (
						current.some((message) =>
							message.parts.some(
								(part) =>
									part.type !== "text" &&
									part.type !== "error" &&
									"toolCallId" in part &&
									part.toolCallId === toolCallId,
							),
						)
					)
						return current;
					const questionPart: ChatMessage["parts"][number] = { ...frame.part, type: "tool-Question" };
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
					void client
						.loadSession({ sessionId })
						.then((result) => {
							if (sessionMetadataRef.current.sessionId !== sessionId) return;
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
					window.sessionStorage.setItem(lastEventIdKey, String(seq));
				}
				handleEvent(event);
			};
			nextSource.onerror = () => {
				if (closedByEffect || source !== nextSource) return;
				nextSource.close();
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
