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
	firstKeptEntryId?: string;
	summary?: string;
	customType?: string;
	display?: boolean;
	harnessDigest?: string;
	message?: { role?: string; content?: unknown; toolCallId?: string };
};

type UpstreamSessionTreeNode = {
	entry: UpstreamSessionTreeEntry;
	label?: string;
	children: UpstreamSessionTreeNode[];
};

const HARNESS_DIGEST_CUSTOM_TYPE = "harness_digest";

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

function findActiveBranchEntries(nodes: UpstreamSessionTreeNode[], leafId: string | null): UpstreamSessionTreeEntry[] {
	if (!leafId) return [];
	const path: UpstreamSessionTreeEntry[] = [];

	const walk = (items: UpstreamSessionTreeNode[]): boolean => {
		for (const node of items) {
			if (node.entry.id === leafId) {
				path.push(node.entry);
				return true;
			}
			if (walk(node.children)) {
				path.push(node.entry);
				return true;
			}
		}
		return false;
	};

	walk(nodes);
	path.reverse();
	return path;
}

function assistantToolCallIds(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const ids: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const item = block as { type?: unknown; id?: unknown };
		if (item.type === "toolCall" && typeof item.id === "string" && item.id.length > 0) {
			ids.push(item.id);
		}
	}
	return ids;
}

/**
 * Computes the hydrated transcript message index (`${sessionId}-m${index}`) for
 * entries on the active branch, mirroring `SessionManager.buildSessionContext`
 * and `toChatMessagesFromAgentMessages`.
 */
function buildMessageIndexByEntryId(activeEntries: readonly UpstreamSessionTreeEntry[]): Map<string, number> {
	const messageIndexByEntryId = new Map<string, number>();
	if (activeEntries.length === 0) return messageIndexByEntryId;

	let compaction: UpstreamSessionTreeEntry | undefined;
	let compactionIdx = -1;
	for (const [index, entry] of activeEntries.entries()) {
		if (entry.type === "compaction") {
			compaction = entry;
			compactionIdx = index;
		}
	}

	let newestDigestEntryId: string | undefined;
	let newestDigestIdx = -1;
	for (let index = activeEntries.length - 1; index >= 0; index -= 1) {
		const entry = activeEntries[index]!;
		if (entry.type === "custom_message" && entry.customType === HARNESS_DIGEST_CUSTOM_TYPE) {
			newestDigestEntryId = entry.id;
			newestDigestIdx = index;
			break;
		}
	}
	const snapshotOutranksDigest =
		compaction?.harnessDigest !== undefined && (newestDigestIdx === -1 || newestDigestIdx < compactionIdx);
	const keepDigestEntryId = snapshotOutranksDigest ? undefined : newestDigestEntryId;

	const isContextEntry = (entry: UpstreamSessionTreeEntry): boolean => {
		if (entry.type === "message") return true;
		if (entry.type === "custom_message") {
			return !(entry.customType === HARNESS_DIGEST_CUSTOM_TYPE && entry.id !== keepDigestEntryId);
		}
		if (entry.type === "branch_summary") return Boolean(entry.summary);
		return false;
	};

	const contextEntries: UpstreamSessionTreeEntry[] = [];
	if (compaction && compactionIdx >= 0) {
		contextEntries.push(compaction);
		let foundFirstKept = false;
		for (let index = 0; index < compactionIdx; index += 1) {
			const entry = activeEntries[index]!;
			if (entry.id === compaction.firstKeptEntryId) {
				foundFirstKept = true;
			}
			if (foundFirstKept && isContextEntry(entry)) {
				contextEntries.push(entry);
			}
		}
		for (let index = compactionIdx + 1; index < activeEntries.length; index += 1) {
			const entry = activeEntries[index]!;
			if (isContextEntry(entry)) {
				contextEntries.push(entry);
			}
		}
	} else {
		for (const entry of activeEntries) {
			if (isContextEntry(entry)) {
				contextEntries.push(entry);
			}
		}
	}

	const toolCallOwnerIndex = new Map<string, number>();
	for (const [contextIndex, entry] of contextEntries.entries()) {
		if (entry.type === "custom_message" && entry.display === false) {
			continue;
		}
		if (
			entry.type === "message" &&
			entry.message?.role === "custom" &&
			(entry.message as { display?: unknown }).display === false
		) {
			continue;
		}
		if (entry.type === "message" && entry.message?.role === "assistant") {
			messageIndexByEntryId.set(entry.id, contextIndex);
			for (const toolCallId of assistantToolCallIds(entry.message.content)) {
				toolCallOwnerIndex.set(toolCallId, contextIndex);
			}
			continue;
		}
		if (entry.type === "message" && entry.message?.role === "toolResult") {
			const toolCallId = typeof entry.message.toolCallId === "string" ? entry.message.toolCallId : undefined;
			const attachedIndex = toolCallId ? toolCallOwnerIndex.get(toolCallId) : undefined;
			messageIndexByEntryId.set(entry.id, attachedIndex ?? contextIndex);
			continue;
		}
		messageIndexByEntryId.set(entry.id, contextIndex);
	}

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
	const activeEntries = findActiveBranchEntries(upstreamNodes, leafId);
	const activePath = new Set(activeEntries.map((entry) => entry.id));
	const messageIndexByEntryId = buildMessageIndexByEntryId(activeEntries);
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
