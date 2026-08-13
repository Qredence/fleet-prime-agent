/**
 * Load a workspace file preview from the prime-agent local FS API.
 */
import type { WorkspaceFileResponse } from "@prime-agent/web-protocol/chat-protocol";
import { chatClient } from "@/lib/pi/chat-client";

export async function loadWorkspaceFile(path: string): Promise<WorkspaceFileResponse> {
	return chatClient.getWorkspaceFile(path);
}
