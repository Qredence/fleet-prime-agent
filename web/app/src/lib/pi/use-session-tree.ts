import type { ChatSessionMetadata, SessionTreeSnapshot } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useCallback, useEffect, useState } from "react";
import { chatClient } from "./chat-client";

type UseSessionTreeArgs = {
	sessionMetadata: ChatSessionMetadata;
	status: ChatStatus;
	resumeSession: (metadata: ChatSessionMetadata) => Promise<void>;
	rightPanel: string | null;
};

export function useSessionTree({ sessionMetadata, status, resumeSession, rightPanel }: UseSessionTreeArgs) {
	const sessionId = sessionMetadata.sessionId;
	const [snapshot, setSnapshot] = useState<SessionTreeSnapshot | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
	const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

	const refreshSessionTree = useCallback(async () => {
		if (!sessionId) {
			setSnapshot(null);
			setError(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const next = await chatClient.getSessionTree(sessionId);
			setSnapshot(next);
		} catch (refreshError) {
			setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
		} finally {
			setLoading(false);
		}
	}, [sessionId]);

	useEffect(() => {
		if (rightPanel !== "session-tree") return;
		void refreshSessionTree();
	}, [refreshSessionTree, rightPanel]);

	useEffect(() => {
		const activeSessionId = sessionMetadata.sessionId;
		if (!activeSessionId) {
			setSelectedEntryId(null);
			setHighlightedMessageId(null);
			setSnapshot(null);
			setError(null);
			return;
		}
		setSelectedEntryId(null);
		setHighlightedMessageId(null);
		setSnapshot(null);
		setError(null);
	}, [sessionMetadata.sessionId]);

	const selectSessionTreeEntry = useCallback((entryId: string, messageId?: string) => {
		setSelectedEntryId(entryId);
		setHighlightedMessageId(messageId ?? null);
	}, []);

	const rewindSessionTree = useCallback(
		async (entryId: string, expectedLeafId: string | null) => {
			if (!sessionId) return;
			setLoading(true);
			setError(null);
			try {
				const next = await chatClient.navigateSessionTree({
					sessionId,
					targetEntryId: entryId,
					...(expectedLeafId ? { expectedLeafId } : {}),
				});
				setSnapshot(next);
				setSelectedEntryId(entryId);
				await resumeSession(sessionMetadata);
			} catch (rewindError) {
				setError(rewindError instanceof Error ? rewindError.message : String(rewindError));
				throw rewindError;
			} finally {
				setLoading(false);
			}
		},
		[resumeSession, sessionMetadata, sessionId],
	);

	return {
		sessionTreeSnapshot: snapshot,
		sessionTreeLoading: loading,
		sessionTreeError: error,
		selectedSessionTreeEntryId: selectedEntryId,
		highlightedTranscriptMessageId: highlightedMessageId,
		refreshSessionTree,
		selectSessionTreeEntry,
		rewindSessionTree,
		isSessionTreeStreaming: status === "streaming" || status === "submitted",
	};
}
