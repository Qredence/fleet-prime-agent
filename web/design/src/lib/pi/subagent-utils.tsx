import { CheckCircle2, CircleAlert, CircleX, LoaderCircle } from "lucide-react"
import type { PrimeAgentRlmChild, PrimeAgentRlmTree } from "@prime-agent/web-protocol/chat-protocol"

export function orderedRlmChildren(children: readonly PrimeAgentRlmChild[], tree?: PrimeAgentRlmTree) {
	const byId = new Map(children.map((child) => [child.id, child]))
	const visited = new Set<string>()
	const ordered: Array<PrimeAgentRlmChild> = []
	const visit = (id: string) => {
		if (visited.has(id)) return
		visited.add(id)
		const child = byId.get(id)
		if (child) ordered.push(child)
		for (const nextId of tree?.nodes[id]?.childrenIds ?? []) visit(nextId)
	}

	for (const id of tree?.rootChildrenIds ?? []) visit(id)
	for (const child of children) visit(child.id)
	return ordered
}

export function rlmStatusIcon(status: PrimeAgentRlmChild["status"]) {
	if (status === "done") return <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
	if (status === "error") return <CircleAlert className="size-3.5 text-destructive" />
	if (status === "cancelled") return <CircleX className="size-3.5 text-muted-foreground" />
	return <LoaderCircle className="size-3.5 animate-spin text-blue-600 dark:text-blue-400" />
}
