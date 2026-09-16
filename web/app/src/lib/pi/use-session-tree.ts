import type { ChatSessionMetadata, SessionTreeSnapshot } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { chatClient } from "./chat-client";

type UseSessionTreeArgs = {
	sessionMetadata: ChatSessionMetadata;
	status: ChatStatus;
	resumeSession: (metadata: ChatSessionMetadata) => Promise<boolean>;
	rightPanel: string | null;
};

export function useSessionTree({ sessionMetadata, status, resumeSession, rightPanel }: UseSessionTreeArgs) {
	const sessionId = sessionMetadata.sessionId;
	const [snapshot, setSnapshot] = useState<SessionTreeSnapshot | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
	const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
	const treeGenerationRef = useRef(0);

	const refreshSessionTree = useCallback(async () => {
		if (!sessionId) {
			setSnapshot(null);
			setError(null);
			setLoading(false);
			return;
		}
		const refreshGeneration = treeGenerationRef.current;
		setLoading(true);
		setError(null);
		try {
			const next = await chatClient.getSessionTree(sessionId);
			if (treeGenerationRef.current !== refreshGeneration) return;
			setSnapshot(next);
		} catch (refreshError) {
			if (treeGenerationRef.current !== refreshGeneration) return;
			setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
		} finally {
			if (treeGenerationRef.current === refreshGeneration) setLoading(false);
		}
	}, [sessionId]);

	useEffect(() => {
		if (rightPanel !== "session-tree") return;
		void refreshSessionTree();
	}, [refreshSessionTree, rightPanel]);

	useEffect(() => {
		// Invalidate in-flight refresh/rewind whenever the active session identity changes.
		treeGenerationRef.current += 1;
		setLoading(false);
		setSelectedEntryId(null);
		setHighlightedMessageId(null);
		setSnapshot(null);
		setError(null);
		void sessionId;
	}, [sessionId]);

	const selectSessionTreeEntry = useCallback((entryId: string, messageId?: string) => {
		setSelectedEntryId(entryId);
		setHighlightedMessageId(messageId ?? null);
	}, []);

	const rewindSessionTree = useCallback(
		async (entryId: string, expectedLeafId: string | null) => {
			if (!sessionId) {
				throw new Error("No active session to rewind.");
			}
			const rewindSessionId = sessionId;
			const rewindMetadata = sessionMetadata;
			const rewindGeneration = ++treeGenerationRef.current;
			const isCurrentRewind = () => treeGenerationRef.current === rewindGeneration;

			setLoading(true);
			// Dialog owns rewind failure copy (confirmError). Clear any prior refresh banner.
			setError(null);
			try {
				await chatClient.navigateSessionTree({
					sessionId: rewindSessionId,
					targetEntryId: entryId,
					...(expectedLeafId ? { expectedLeafId } : {}),
				});
				if (!isCurrentRewind()) {
					throw new Error("Session changed during rewind.");
				}
				setHighlightedMessageId(null);
				const resumed = await resumeSession(rewindMetadata);
				if (!isCurrentRewind()) {
					throw new Error("Session changed during rewind.");
				}
				if (!resumed) {
					throw new Error("Failed to resume session after rewind.");
				}
				// Resume can reshape transcripts; refresh markers, then commit once.
				const after = await chatClient.getSessionTree(rewindSessionId);
				if (!isCurrentRewind()) {
					throw new Error("Session changed during rewind.");
				}
				setSnapshot(after);
				setSelectedEntryId(after.leafId);
			} catch (rewindError) {
				if (isCurrentRewind()) {
					// Navigate may have succeeded before resume/refresh failed — reconcile UI to server.
					try {
						const after = await chatClient.getSessionTree(rewindSessionId);
						if (isCurrentRewind()) {
							setSnapshot(after);
							setSelectedEntryId(after.leafId);
						}
					} catch {
						/* keep prior snapshot if reconcile also fails */
					}
				}
				throw rewindError;
			} finally {
				if (isCurrentRewind()) setLoading(false);
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
