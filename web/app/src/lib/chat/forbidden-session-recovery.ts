import type { ProjectId } from "@prime-agent/web-protocol/fleet-contract";
import type { ChatStore } from "@/hooks/chat/chat-store";
import { CLEARED_CONVERSATION } from "@/hooks/chat/chat-store";
import type { ChatClient } from "@/lib/chat/chat-client";
import { notifyChatError } from "@/lib/chat/chat-error-notify";
import { isForbiddenSessionError, isUnknownSessionError } from "@/lib/chat/chat-fetch";

export type ForbiddenSessionRecoveryDeps = {
	client: ChatClient;
	isCurrent?: () => boolean;
	projectId?: ProjectId;
	refreshSessions: () => Promise<unknown>;
	store: ChatStore;
};

export async function runForbiddenSessionRecovery({
	client,
	isCurrent,
	projectId,
	refreshSessions,
	store,
}: ForbiddenSessionRecoveryDeps) {
	if (isCurrent && !isCurrent()) return;
	store.patch({ ...CLEARED_CONVERSATION, error: null, sessionMetadata: {}, status: "ready" });

	const result = await client.createSession(projectId);
	if (isCurrent && !isCurrent()) return;
	store.patch({
		activityLabel: result.sessionReset ? "Started a fresh Pi session" : undefined,
		messages: result.messages,
		presentation: result.presentation,
		sessionMetadata: result.session,
	});
	await refreshSessions();
}

export type SessionRecoveryContext = Pick<ForbiddenSessionRecoveryDeps, "store" | "isCurrent">;

async function tryRecoverMatchingSessionError(
	error: unknown,
	matches: (error: unknown) => boolean,
	recover: () => Promise<void>,
	{ isCurrent, store }: SessionRecoveryContext,
) {
	if (!matches(error)) {
		return false;
	}

	try {
		await recover();
	} catch (recoveryError) {
		if (isCurrent && !isCurrent()) return true;
		const nextError = recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError));
		store.patch({ error: nextError, status: "error" });
		notifyChatError(nextError);
	}

	return true;
}

export async function tryRecoverForbiddenSession(
	error: unknown,
	recover: () => Promise<void>,
	context: SessionRecoveryContext,
) {
	return tryRecoverMatchingSessionError(error, isForbiddenSessionError, recover, context);
}

/** 404 twin of the forbidden-session recovery: a listed transcript the daemon can no longer resume. */
export async function tryRecoverUnknownSession(
	error: unknown,
	recover: () => Promise<void>,
	context: SessionRecoveryContext,
) {
	return tryRecoverMatchingSessionError(error, isUnknownSessionError, recover, context);
}
