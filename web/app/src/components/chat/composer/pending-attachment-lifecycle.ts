import type { ProjectId } from "@prime-agent/web-protocol";
import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";

export function shouldClearPendingAttachments(current: ChatSessionMetadata, next: ChatSessionMetadata): boolean {
	return current.sessionId !== next.sessionId || current.projectId !== next.projectId;
}

export function shouldClearPendingAttachmentsForNewSession(
	current: ChatSessionMetadata,
	targetProjectId?: ProjectId,
): boolean {
	return Boolean(current.sessionId) || (targetProjectId !== undefined && targetProjectId !== current.projectId);
}
