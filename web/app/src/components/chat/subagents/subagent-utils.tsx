import type { PrimeAgentRlmChild, PrimeAgentRlmTree } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { CheckCircle2, CircleAlert, CircleX, LoaderCircle, RotateCw } from "lucide-react";

/**
 * Maps a subagent's lifecycle state to the corresponding chat status.
 */
export function transcriptStatus(child: PrimeAgentRlmChild): ChatStatus {
	if (child.status === "running" || child.status === "recovering") return "streaming";
	if (child.status === "error" || child.status === "failed") return "error";
	return "ready";
}

/**
 * Orders RLM child records according to the optional tree structure.
 *
 * Tree children are traversed depth-first from the root, followed by any
 * records not reached through the tree.
 *
 * @param children - The RLM child records to order
 * @param tree - Optional tree defining root and descendant relationships
 * @returns The child records in tree order, followed by unvisited records
 */
export function orderedRlmChildren(children: readonly PrimeAgentRlmChild[], tree?: PrimeAgentRlmTree) {
	const byId = new Map(children.map((child) => [child.id, child]));
	const visited = new Set<string>();
	const ordered: Array<PrimeAgentRlmChild> = [];
	const visit = (id: string) => {
		if (visited.has(id)) return;
		visited.add(id);
		const child = byId.get(id);
		if (child) ordered.push(child);
		for (const nextId of tree?.nodes[id]?.childrenIds ?? []) visit(nextId);
	};

	for (const id of tree?.rootChildrenIds ?? []) visit(id);
	for (const child of children) visit(child.id);
	return ordered;
}

/**
 * Maps an RLM child status to its corresponding status icon.
 *
 * @param status - The RLM child status
 * @returns A status icon styled for the given status
 */
export function rlmStatusIcon(status: PrimeAgentRlmChild["status"]) {
	if (status === "done") return <CheckCircle2 className="size-3.5 text-success" />;
	if (status === "error" || status === "failed") return <CircleAlert className="size-3.5 text-destructive" />;
	if (status === "cancelled") return <CircleX className="size-3.5 text-muted-foreground" />;
	if (status === "recovering") return <RotateCw className="size-3.5 animate-spin text-warning" />;
	return <LoaderCircle className="size-3.5 animate-spin text-primary" />;
}
