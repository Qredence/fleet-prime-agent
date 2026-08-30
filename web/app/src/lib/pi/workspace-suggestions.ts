import type { SuggestionItem } from "@prime-agent/web-design/components/registry/beui/agents/input/suggestions";
import type { WorkspaceTreeNode, WorkspaceTreeResponse } from "@prime-agent/web-protocol/chat-protocol";
import { WorkspaceRelativePathSchema } from "@prime-agent/web-protocol/fleet-contract";

const WORKSPACE_SUGGESTION_PREFIX = "workspace:";

function flattenWorkspaceNodes(nodes: Array<WorkspaceTreeNode>, result: Array<WorkspaceTreeNode> = []) {
	for (const node of nodes) {
		result.push(node);
		if (node.children) flattenWorkspaceNodes(node.children, result);
	}
	return result;
}

export function buildWorkspaceReferenceSuggestions(workspace: WorkspaceTreeResponse | null): Array<SuggestionItem> {
	if (!workspace) return [];

	return flattenWorkspaceNodes(workspace.nodes).map((node) => ({
		id: `${WORKSPACE_SUGGESTION_PREFIX}${node.path}`,
		label: node.path,
		description: node.type === "directory" ? "Folder" : "Workspace file",
		keywords: [node.name, node.path],
		metadata: { kind: node.type === "directory" ? "folder" : "file" },
	}));
}

export function workspacePathFromSuggestion(item: SuggestionItem): string | null {
	if (!item.id.startsWith(WORKSPACE_SUGGESTION_PREFIX)) return null;
	const path = item.id.slice(WORKSPACE_SUGGESTION_PREFIX.length);
	if (!path) return null;
	const parsed = WorkspaceRelativePathSchema.safeParse(path);
	return parsed.success ? parsed.data : null;
}
