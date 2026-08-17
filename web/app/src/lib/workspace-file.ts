/**
 * Load a workspace file preview from the prime-agent local FS API.
 */
import type { ProjectId } from "@prime-agent/web-protocol";
import type { WorkspaceFileResponse } from "@prime-agent/web-protocol/chat-protocol";
import { chatClient } from "@/lib/pi/chat-client";

export async function loadWorkspaceFile(path: string, projectId?: ProjectId): Promise<WorkspaceFileResponse> {
	return chatClient.getWorkspaceFile(path, projectId);
}
