/**
 * Load a workspace file preview from the prime-agent local FS API.
 */
import type { ProjectId } from "@prime-agent/web-protocol";
import type { WorkspaceFileResponse } from "@prime-agent/web-protocol/chat-protocol";
import { chatClient } from "@/lib/pi/chat-client";

export const WORKSPACE_FILE_REQUEST_TIMEOUT_MS = 15_000;

export async function loadWorkspaceFile(
	path: string,
	projectId?: ProjectId,
	signal?: AbortSignal,
): Promise<WorkspaceFileResponse> {
	const timeout =
		typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(WORKSPACE_FILE_REQUEST_TIMEOUT_MS) : undefined;
	const requestSignal =
		signal && timeout && typeof AbortSignal.any === "function"
			? AbortSignal.any([signal, timeout])
			: (signal ?? timeout);
	return chatClient.getWorkspaceFile(path, projectId, requestSignal);
}
