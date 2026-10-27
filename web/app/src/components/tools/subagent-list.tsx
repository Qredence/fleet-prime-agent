"use client";

import type { PrimeAgentRlmChild, PrimeAgentRlmTree } from "@prime-agent/web-protocol/chat-protocol";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { orderedRlmChildren, rlmStatusIcon } from "@/components/chat/subagents/subagent-utils";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";

type SubagentListProps = {
	children: readonly PrimeAgentRlmChild[];
	tree?: PrimeAgentRlmTree;
	className?: string;
};

/**
 * Displays a collapsible list of subagents and their current status.
 *
 * @param children - The subagent entries to display
 * @param tree - Optional hierarchy metadata used to order and indent the entries
 * @returns The subagent list, or `null` when no subagents are available
 */
export function SubagentList({ children, tree, className }: SubagentListProps) {
	const agents = useMemo(() => orderedRlmChildren(children, tree), [children, tree]);
	const active = agents.some(
		(child) => child.status === "queued" || child.status === "running" || child.status === "recovering",
	);
	const [open, setOpen] = useState(active);
	if (agents.length === 0) return null;

	return (
		<Trace className={cn("mt-2", className)} data-testid="subagent-trace">
			<TraceCollapsible open={open || active} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger aria-label={active ? "Subagents working" : "Subagents completed"}>
					<TraceLine status={active ? "running" : undefined}>
						<TraceIcon>{active ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}</TraceIcon>
						<TraceTitle>{active ? "Subagents working" : "Subagents completed"}</TraceTitle>
						<TraceDescription>{agents.length}</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<Trace className="gap-1">
						{agents.map((child) => (
							<TraceLine key={child.id} style={{ paddingLeft: `${Math.max(0, child.depth ?? 0) * 12}px` }}>
								<TraceIcon>{rlmStatusIcon(child.status)}</TraceIcon>
								<TraceTitle>{child.label}</TraceTitle>
								{child.model ? <TraceDescription>{child.model}</TraceDescription> : null}
								<TraceDescription className="capitalize">{child.status}</TraceDescription>
								{(child.error ?? child.answerPreview ?? child.progressNote ?? child.activity?.toolName) ? (
									<TraceDescription className="max-w-56 truncate">
										{child.error ?? child.answerPreview ?? child.progressNote ?? child.activity?.toolName}
									</TraceDescription>
								) : null}
							</TraceLine>
						))}
					</Trace>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
