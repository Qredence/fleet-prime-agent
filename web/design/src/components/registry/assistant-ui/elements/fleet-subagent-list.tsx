"use client"

import { CheckCircle2, ChevronDown, CircleAlert, CircleX, LoaderCircle } from "lucide-react"
import { useMemo, useState } from "react"

import type { PrimeAgentRlmChild, PrimeAgentRlmTree } from "@prime-agent/web-protocol/chat-protocol"
import { cn } from "../../../../lib/utils"

type FleetSubagentListProps = {
	children: readonly PrimeAgentRlmChild[]
	tree?: PrimeAgentRlmTree
	className?: string
}

function statusIcon(status: PrimeAgentRlmChild["status"]) {
	if (status === "done") return <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
	if (status === "error") return <CircleAlert className="size-3.5 text-destructive" />
	if (status === "cancelled") return <CircleX className="size-3.5 text-muted-foreground" />
	return <LoaderCircle className="size-3.5 animate-spin text-blue-600 dark:text-blue-400" />
}

function orderedChildren(children: readonly PrimeAgentRlmChild[], tree?: PrimeAgentRlmTree) {
	const byId = new Map(children.map((child) => [child.id, child]))
	const visited = new Set<string>()
	const ordered: PrimeAgentRlmChild[] = []
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

export function FleetSubagentList({ children, tree, className }: FleetSubagentListProps) {
	const agents = useMemo(() => orderedChildren(children, tree), [children, tree])
	const active = agents.some((child) => child.status === "queued" || child.status === "running")
	const [open, setOpen] = useState(active)
	if (agents.length === 0) return null

	return (
		<section className={cn("mt-2 rounded-xl border border-border/60 bg-muted/20", className)}>
			<button
				type="button"
				aria-expanded={open || active}
				onClick={() => setOpen((current) => !current)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{active ? <LoaderCircle className="size-3.5 animate-spin text-blue-600 dark:text-blue-400" /> : <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />}
				<span className="flex-1 font-medium">{active ? "Subagents working" : "Subagents completed"}</span>
				<span className="text-xs text-muted-foreground">{agents.length}</span>
				<ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", (open || active) && "rotate-180")} />
			</button>
			{open || active ? (
				<div className="space-y-1 border-t border-border/50 px-3 py-2">
					{agents.map((child) => (
						<div key={child.id} className="flex min-w-0 items-start gap-2" style={{ paddingLeft: `${Math.max(0, child.depth ?? 0) * 12}px` }}>
							<span className="mt-0.5 shrink-0">{statusIcon(child.status)}</span>
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-baseline gap-2">
									<span className="truncate text-sm text-foreground/85">{child.label}</span>
									{child.model ? <span className="truncate font-mono text-[10px] text-muted-foreground">{child.model}</span> : null}
								</div>
								{child.answerPreview || child.activity?.toolName || child.error ? (
									<p className="truncate text-xs text-muted-foreground">{child.error ?? child.answerPreview ?? child.activity?.toolName}</p>
								) : null}
							</div>
							<span className="shrink-0 text-[10px] capitalize text-muted-foreground">{child.status}</span>
						</div>
					))}
				</div>
			) : null}
		</section>
	)
}
