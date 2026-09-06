import type {
	ChatSessionInfo,
	ChatSessionMetadata,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { type MutableRefObject, useEffect } from "react";
import type { ChatClient } from "./chat-client";
import { notifyChatError } from "./chat-error-notify";
import type { QueueState } from "./chat-fetch";
import { EMPTY_QUEUE_STATE } from "./chat-stream-state";
import { hydratePlanPresentationMessages } from "./plan-presentation";
import { tryRecoverForbiddenSession, tryRecoverUnknownSession } from "./use-pi-chat-forbidden-session";

type BootstrapOptions = {
	client: ChatClient;
	initialSessionMetadataRef: MutableRefObject<ChatSessionMetadata>;
	initializedRef: MutableRefObject<boolean>;
	recoverFromForbiddenSession: () => Promise<void>;
	refreshSessions: () => Promise<Array<ChatSessionInfo>>;
	setActivityLabelSynced: (label: string | undefined) => void;
	setError: (error: Error | null) => void;
	setMessagesSynced: (updater: Array<ChatMessage> | ((current: Array<ChatMessage>) => Array<ChatMessage>)) => void;
	setPlanLabelSynced: (label: string | undefined) => void;
	setPresentationSynced: (presentation: PrimeAgentSessionPresentation) => void;
	setQueueSynced: (queue: QueueState) => void;
	setSessionMetadataSynced: (metadata: ChatSessionMetadata) => void;
	setStatus: (status: ChatStatus) => void;
};

/** Hydrates the initial visible session and makes every post-await update abort-aware. */
export function usePiChatBootstrap({
	client,
	initialSessionMetadataRef,
	initializedRef,
	recoverFromForbiddenSession,
	refreshSessions,
	setActivityLabelSynced,
	setError,
	setMessagesSynced,
	setPlanLabelSynced,
	setPresentationSynced,
	setQueueSynced,
	setSessionMetadataSynced,
	setStatus,
}: BootstrapOptions) {
	useEffect(() => {
		if (initializedRef.current) return;
		initializedRef.current = true;
		const controller = new AbortController();
		setStatus("ready");
		setError(null);
		setQueueSynced(EMPTY_QUEUE_STATE);
		setActivityLabelSynced(undefined);
		setPlanLabelSynced(undefined);
		setMessagesSynced([]);

		const storedSession = initialSessionMetadataRef.current;
		void refreshSessions()
			.then((availableSessions) => {
				if (controller.signal.aborted) return undefined;
				const selected = storedSession.sessionId
					? availableSessions.find((candidate) => candidate.sessionId === storedSession.sessionId)
					: undefined;
				const fallback =
					selected ??
					(storedSession.projectId
						? availableSessions.find((candidate) => candidate.projectId === storedSession.projectId)
						: availableSessions[0]);
				if (!fallback) {
					setSessionMetadataSynced(storedSession.projectId ? { projectId: storedSession.projectId } : {});
					return undefined;
				}
				const metadata = selected
					? storedSession
					: { sessionId: fallback.sessionId, projectId: fallback.projectId };
				return client.loadSession(metadata);
			})
			.then((result) => {
				if (!result || controller.signal.aborted) return;
				setSessionMetadataSynced(result.session);
				setMessagesSynced(hydratePlanPresentationMessages(result.messages, result.planPresentations));
				setPresentationSynced(result.presentation);
				setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
			})
			.catch(async (err) => {
				if (controller.signal.aborted) return;
				const recoveryDeps = { setError, setStatus };
				const recovered =
					(await tryRecoverForbiddenSession(err, recoverFromForbiddenSession, recoveryDeps)) ||
					(await tryRecoverUnknownSession(err, recoverFromForbiddenSession, recoveryDeps));
				if (recovered || controller.signal.aborted) return;
				const nextError = err instanceof Error ? err : new Error(String(err));
				setError(nextError);
				setStatus("error");
				notifyChatError(nextError);
			});

		return () => controller.abort();
	}, [
		client,
		initialSessionMetadataRef,
		initializedRef,
		recoverFromForbiddenSession,
		refreshSessions,
		setActivityLabelSynced,
		setError,
		setMessagesSynced,
		setPlanLabelSynced,
		setPresentationSynced,
		setQueueSynced,
		setSessionMetadataSynced,
		setStatus,
	]);
}
