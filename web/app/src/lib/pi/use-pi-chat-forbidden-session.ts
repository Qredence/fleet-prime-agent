import { notify } from "@prime-agent/web-design/lib/notify";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import type { ChatClient } from "./chat-client";
import type { QueueState } from "./chat-fetch";
import { isForbiddenSessionError } from "./chat-fetch";
import { EMPTY_QUEUE_STATE } from "./chat-stream-state";

export type ForbiddenSessionRecoveryDeps = {
	client: ChatClient;
	projectId?: ProjectId;
	refreshSessions: () => Promise<void>;
	setActivityLabelSynced: (label: string | undefined) => void;
	setError: (error: Error | null) => void;
	setMessagesSynced: (updater: Array<ChatMessage> | ((current: Array<ChatMessage>) => Array<ChatMessage>)) => void;
	setPlanLabelSynced: (label: string | undefined) => void;
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
	deps.setError(null);
	deps.setStatus("ready");

	const result = await deps.client.createSession(deps.projectId);
	deps.setSessionMetadataSynced(result.session);
	deps.setMessagesSynced(result.messages);
	deps.setActivityLabelSynced(result.sessionReset ? "Started a fresh Pi session" : undefined);
	notify.message("Started a fresh session");
	await deps.refreshSessions();
}

export async function tryRecoverForbiddenSession(
	error: unknown,
	recover: () => Promise<void>,
	deps: Pick<ForbiddenSessionRecoveryDeps, "setError" | "setStatus">,
) {
	if (!isForbiddenSessionError(error)) {
		return false;
	}

	try {
		await recover();
	} catch (recoveryError) {
		const nextError = recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError));
		deps.setError(nextError);
		deps.setStatus("error");
		notify.error(nextError.message);
	}

	return true;
}
