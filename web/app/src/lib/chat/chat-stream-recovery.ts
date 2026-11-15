import type { ChatStreamEvent, ChatStreamEventCursor } from "@prime-agent/web-protocol/chat-protocol";

/** Shared handoff state between the POST stream reducer and session SSE replay. */
export type ChatStreamRecoveryState = {
	sessionId?: string;
	active: boolean;
	cursor?: ChatStreamEventCursor;
	needsSnapshot: boolean;
	applyEvent?: (event: ChatStreamEvent) => void;
	requestReconnect?: () => void;
};
