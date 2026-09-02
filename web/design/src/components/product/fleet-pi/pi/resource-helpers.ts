import type {
	ChatResourceInfo,
	ChatResourcesResponse,
	WorkspaceTreeNode,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { LucideIcon } from "lucide-react";
import { BookOpen, ClipboardList, FileText, Package, Palette, Plug } from "lucide-react";

export type ResourceGroupId = "skills" | "prompts" | "extensions" | "packages" | "themes" | "agentsFiles";

export function getResourceGroups(
	resources: ChatResourcesResponse | null,
	workspace: WorkspaceTreeResponse | null,
): Array<{
	id: ResourceGroupId;
	label: string;
	icon: LucideIcon;
	items: Array<ChatResourceInfo>;
}> {
	return [
		{
			id: "skills",
			label: "Skills",
			icon: BookOpen,
			items: mergeResourceItems(
				resources?.skills.filter((skill) => skill.installedInWorkspace) ?? [],
				getWorkspaceSkillResources(workspace),
			),
		},
		{
			id: "prompts",
			label: "Prompts",
			icon: FileText,
			items: resources?.prompts ?? [],
		},
		{
			id: "extensions",
			label: "Extensions",
			icon: Plug,
			items: resources?.extensions ?? [],
		},
		{
			id: "packages",
			label: "Packages",
			icon: Package,
			items: resources?.packages ?? [],
		},
		{
			id: "themes",
			label: "Themes",
			icon: Palette,
			items: resources?.themes ?? [],
		},
		{
			id: "agentsFiles",
			label: "Context",
			icon: ClipboardList,
			items: resources?.agentsFiles ?? [],
		},
	];
}

export function countWorkspaceFiles(nodes: Array<WorkspaceTreeNode>): number {
	return nodes.reduce((count, node) => {
		if (node.type === "file") return count + 1;
		if (!node.children?.length) return count;
		return count + countWorkspaceFiles(node.children);
	}, 0);
}

export function findWorkspaceNode(nodes: Array<WorkspaceTreeNode>, path: string): WorkspaceTreeNode | null {
	for (const node of nodes) {
		if (node.path === path) return node;
		const child = node.children ? findWorkspaceNode(node.children, path) : null;
		if (child) return child;
	}

	return null;
}

export function getWorkspaceSkillResources(workspace: WorkspaceTreeResponse | null): Array<ChatResourceInfo> {
	if (!workspace) return [];

	const skillsRoot = findWorkspaceNode(workspace.nodes, "agent-workspace/skills");
	if (!skillsRoot?.children?.length) return [];

	return skillsRoot.children
		.flatMap((node) => {
			if (node.type !== "directory") return [];

			const skillFile =
				node.children?.find((child) => child.type === "file" && child.name.toLowerCase() === "skill.md") ?? null;

			if (!skillFile) return [];

			return [
				{
					name: node.name,
					path: skillFile.path,
					source: "workspace",
				},
			];
		})
		.sort((left, right) => left.name.localeCompare(right.name));
}

export function displayResourcePath(path: string) {
	const marker = "/fleet-pi/";
	const index = path.indexOf(marker);
	return index >= 0 ? path.slice(index + marker.length) : path;
}

export function getResourceChipTitle(item: ChatResourceInfo) {
	return [
		item.name,
		item.source ? `Source: ${item.source}` : null,
		item.activationStatus ? `Status: ${item.activationStatus}` : null,
		item.description ?? null,
		item.workspacePath ? displayResourcePath(item.workspacePath) : null,
		item.path ? displayResourcePath(item.path) : null,
	]
		.filter(Boolean)
		.join("\n");
}

export function resourceKey(item: ChatResourceInfo) {
	return `${item.source ?? "resource"}:${item.path ?? item.name}`;
}

function mergeResourceItems(primary: Array<ChatResourceInfo>, secondary: Array<ChatResourceInfo>) {
	const seen = new Set<string>();
	return [...primary, ...secondary].filter((item) => {
		const key = `${item.path ?? item.workspacePath ?? ""}:${item.name}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
