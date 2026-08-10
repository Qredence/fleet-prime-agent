/**
 * @/lib/workspace/stub — v1 stub.
 *
 * fleet-pi's workspace client talks to a Daytona-sandbox-backed filesystem.
 * For v1 (local in-process sessions, no Daytona), the right-panel workspace
 * view is a placeholder.
 */
import type { WorkspaceFileResponse } from "@prime-agent/web-protocol/chat-protocol"

export async function loadWorkspaceFile(
	_path: string,
): Promise<WorkspaceFileResponse> {
	return {
		path: _path,
		name: _path.split("/").pop() ?? _path,
		content: "(Workspace panel is not wired to prime-agent storage in v1)",
		mediaType: "text/plain",
		status: "unsupported",
	}
}
