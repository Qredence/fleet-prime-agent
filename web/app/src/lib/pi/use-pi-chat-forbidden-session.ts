import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import type { ChatClient } from "./chat-client";
import { notifyChatError } from "./chat-error-notify";
import type { QueueState } from "./chat-fetch";
import { isForbiddenSessionError, isUnknownSessionError } from "./chat-fetch";
import { EMPTY_QUEUE_STATE } from "./chat-stream-state";

export type ForbiddenSessionRecoveryDeps = {
	client: ChatClient;
	projectId?: ProjectId;
	refreshSessions: () => Promise<unknown>;
	setActivityLabelSynced: (label: string | undefined) => void;
	setError: (error: Error | null) => void;
	setMessagesSynced: (updater: Array<ChatMessage> | ((current: Array<ChatMessage>) => Array<ChatMessage>)) => void;
	setPlanLabelSynced: (label: string | undefined) => void;
	setPresentationSynced: (presentation: PrimeAgentSessionPresentation) => void;
	setQueueSynced: (queue: QueueState) => void;
	setSessionMetadataSynced: (metadata: { sessionId?: string; projectId?: ProjectId | null }) => void;
	setStatus: (status: ChatStatus) => void;
};

export async function runForbiddenSessionRecovery(deps: ForbiddenSessionRecoveryDeps) {
	deps.setSessionMetadataSynced({});
	deps.setMessagesSynced([]);
	deps.setQueueSynced(EMPTY_QUEUE_STATE);
	deps.setActivityLabelSynced(undefined);
	deps.setPlanLabelSynced(undefined);
	deps.setPresentationSynced({ revision: 0, userBash: [], rlmChildren: [], refinements: [], artifactRuns: [] });
	deps.setError(null);
	deps.setStatus("ready");

	const result = await deps.client.createSession(deps.projectId);
	deps.setSessionMetadataSynced(result.session);
	deps.setMessagesSynced(result.messages);
	deps.setPresentationSynced(result.presentation);
	deps.setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
	await deps.refreshSessions();
}

async function tryRecoverMatchingSessionError(
	error: unknown,
	matches: (error: unknown) => boolean,
	recover: () => Promise<void>,
	deps: Pick<ForbiddenSessionRecoveryDeps, "setError" | "setStatus">,
) {
	if (!matches(error)) {
		return false;
	}

	try {
		await recover();
	} catch (recoveryError) {
		const nextError = recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError));
		deps.setError(nextError);
		deps.setStatus("error");
		notifyChatError(nextError);
	}

	return true;
}

export async function tryRecoverForbiddenSession(
	error: unknown,
	recover: () => Promise<void>,
	deps: Pick<ForbiddenSessionRecoveryDeps, "setError" | "setStatus">,
) {
	return tryRecoverMatchingSessionError(error, isForbiddenSessionError, recover, deps);
}

/** 404 twin of the forbidden-session recovery: a listed transcript the daemon can no longer resume. */
export async function tryRecoverUnknownSession(
	error: unknown,
	recover: () => Promise<void>,
	deps: Pick<ForbiddenSessionRecoveryDeps, "setError" | "setStatus">,
) {
	return tryRecoverMatchingSessionError(error, isUnknownSessionError, recover, deps);
}
