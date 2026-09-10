import { readStoredValue, removeStoredValue, writeStoredValue } from "@prime-agent/web-design/lib/safe-storage";
import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import { ChatSessionMetadataSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import { useCallback, useEffect, useState } from "react";

const CHAT_SESSION_STORAGE_KEY = "fleet-prime:v1:chat-session";

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
	const raw = readStoredValue(CHAT_SESSION_STORAGE_KEY);
	if (!raw) return readLegacyScopeStorage();
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parseSessionMetadata(parsed);
	} catch {
		return readLegacyScopeStorage();
	}
}

function readLegacyScopeStorage(): ChatSessionMetadata {
	const raw = readStoredValue("fleet-prime:v1:chat-sessions");
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
	removeStoredValue(CHAT_SESSION_STORAGE_KEY);
	removeStoredValue("fleet-prime:v1:chat-sessions");
	removeStoredValue("fleet-prime:v1:chat-mode");
}

function storeBrowserSessions(metadata: ChatSessionMetadata) {
	if (!metadata.sessionId && !metadata.projectId) {
		removeStoredValue(CHAT_SESSION_STORAGE_KEY);
		removeStoredValue("fleet-prime:v1:chat-sessions");
		return;
	}

	writeStoredValue(CHAT_SESSION_STORAGE_KEY, JSON.stringify(metadata));
}
