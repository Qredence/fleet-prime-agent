import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import { ChatSessionMetadataSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { useCallback, useEffect, useState } from "react";

const CHAT_SESSION_STORAGE_KEY = "fleet-pi-chat-session";

export function useChatStorage() {
	const [sessionMetadata, setSessionMetadataState] = useState<ChatSessionMetadata>(() => readStoredBrowserSessions());

	const setSessionMetadata = useCallback((metadata: ChatSessionMetadata) => {
		setSessionMetadataState(metadata);
	}, []);

	useEffect(() => {
		storeBrowserSessions(sessionMetadata);
	}, [sessionMetadata]);

	return {
		sessionMetadata,
		setSessionMetadata,
	};
}

function readStoredBrowserSessions(): ChatSessionMetadata {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (typeof window === "undefined" || !window.localStorage) return {};

	try {
		const raw = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY);
		if (!raw) return readLegacyScopeStorage();
		const parsed = JSON.parse(raw) as unknown;
		return parseSessionMetadata(parsed);
	} catch {
		return readLegacyScopeStorage();
	}
}

function readLegacyScopeStorage(): ChatSessionMetadata {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (typeof window === "undefined" || !window.localStorage) return {};
	const raw = window.localStorage.getItem("fleet-pi-chat-sessions");
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw) as { normal?: unknown } | null;
		return parseSessionMetadata(parsed?.normal);
	} catch {
		return {};
	}
}

function parseSessionMetadata(value: unknown): ChatSessionMetadata {
	const result = ChatSessionMetadataSchema.safeParse(value);
	return result.success ? result.data : {};
}

export function clearBrowserChatSessions() {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (typeof window === "undefined" || !window.localStorage) return;

	window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
	window.localStorage.removeItem("fleet-pi-chat-sessions");
	window.localStorage.removeItem("fleet-pi-chat-mode");
}

function storeBrowserSessions(metadata: ChatSessionMetadata) {
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (typeof window === "undefined" || !window.localStorage) return;

	if (!metadata.sessionFile && !metadata.sessionId) {
		window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY);
		window.localStorage.removeItem("fleet-pi-chat-sessions");
		return;
	}

	window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, JSON.stringify(metadata));
}
