import type {
	SessionTreeNode,
	SessionTreeNodeKind,
	SessionTreeNodeRole,
	SessionTreeSnapshot,
} from "@prime-agent/web-protocol/chat-protocol";

type UpstreamSessionTreeEntry = {
	id: string;
	type: string;
	parentId?: string;
	label?: string;
	message?: { role?: string; content?: unknown };
};

type UpstreamSessionTreeNode = {
	entry: UpstreamSessionTreeEntry;
	label?: string;
	children: UpstreamSessionTreeNode[];
};

function messageContentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join(" ");
}

function entryPreview(node: UpstreamSessionTreeNode): string {
	const { entry } = node;
	if (entry.type === "message" && entry.message) {
		const role = entry.message.role ?? "message";
		const oneLine = messageContentToText(entry.message.content).replace(/\s+/g, " ").trim();
		const preview = oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
		return `${role}: ${preview}`;
	}
	return entry.label ?? node.label ?? entry.type;
}

function entryKind(entry: UpstreamSessionTreeEntry): SessionTreeNodeKind {
	if (entry.type === "message") return "message";
	if (entry.type === "system" || entry.type === "compaction" || entry.type === "model_change") return "system";
	return "other";
}

function entryRole(entry: UpstreamSessionTreeEntry): SessionTreeNodeRole | undefined {
	if (entry.type !== "message" || !entry.message?.role) return undefined;
	switch (entry.message.role) {
		case "user":
			return "user";
		case "assistant":
			return "assistant";
		case "system":
			return "system";
		default:
			return "unknown";
	}
}

function findActiveBranchPath(nodes: UpstreamSessionTreeNode[], leafId: string | null): Set<string> {
	const active = new Set<string>();
	if (!leafId) return active;

	const walk = (items: UpstreamSessionTreeNode[]): boolean => {
		for (const node of items) {
			if (node.entry.id === leafId) {
				active.add(node.entry.id);
				return true;
			}
			if (walk(node.children)) {
				active.add(node.entry.id);
				return true;
			}
		}
		return false;
	};

	walk(nodes);
	return active;
}

function buildMessageIndexByEntryId(nodes: UpstreamSessionTreeNode[], leafId: string | null): Map<string, number> {
	const activePath = findActiveBranchPath(nodes, leafId);
	const messageIndexByEntryId = new Map<string, number>();
	let messageIndex = 0;

	const walk = (items: UpstreamSessionTreeNode[]) => {
		for (const node of items) {
			if (!activePath.has(node.entry.id)) continue;
			if (node.entry.type === "message") {
				messageIndexByEntryId.set(node.entry.id, messageIndex);
				messageIndex += 1;
			}
			walk(node.children);
			return;
		}
	};

	walk(nodes);
	return messageIndexByEntryId;
}

function mapNode(
	node: UpstreamSessionTreeNode,
	leafId: string | null,
	activePath: Set<string>,
	messageIndexByEntryId: Map<string, number>,
): SessionTreeNode {
	const preview = entryPreview(node);
	const role = entryRole(node.entry);
	const messageIndex = messageIndexByEntryId.get(node.entry.id);
	return {
		id: node.entry.id,
		...(node.entry.parentId ? { parentId: node.entry.parentId } : {}),
		kind: entryKind(node.entry),
		...(role ? { role } : {}),
		label: node.entry.label ?? node.label ?? node.entry.type,
		preview,
		isLeaf: node.entry.id === leafId,
		isOnActiveBranch: activePath.has(node.entry.id),
		...(messageIndex !== undefined ? { messageIndex } : {}),
		children: node.children.map((child) => mapNode(child, leafId, activePath, messageIndexByEntryId)),
	};
}

/**
 * Maps an upstream runtime session tree into the browser-safe Fleet snapshot shape.
 */
export function mapSessionTreeSnapshot(
	sessionId: string,
	nodes: readonly unknown[],
	leafId: string | null,
): SessionTreeSnapshot {
	const upstreamNodes = nodes as UpstreamSessionTreeNode[];
	const activePath = findActiveBranchPath(upstreamNodes, leafId);
	const messageIndexByEntryId = buildMessageIndexByEntryId(upstreamNodes, leafId);
	return {
		sessionId,
		leafId,
		nodes: upstreamNodes.map((node) => mapNode(node, leafId, activePath, messageIndexByEntryId)),
	};
}

/**
 * Resolves a hydrated transcript message id from a tree entry id.
 */
export function messageIdForSessionTreeEntry(
	sessionId: string,
	snapshot: SessionTreeSnapshot,
	entryId: string,
): string | undefined {
	const findNode = (nodes: SessionTreeSnapshot["nodes"]): SessionTreeNode | undefined => {
		for (const node of nodes) {
			if (node.id === entryId) return node;
			const nested = findNode(node.children);
			if (nested) return nested;
		}
		return undefined;
	};
	const node = findNode(snapshot.nodes);
	if (!node || node.messageIndex === undefined) return undefined;
	return `${sessionId}-m${node.messageIndex}`;
}
