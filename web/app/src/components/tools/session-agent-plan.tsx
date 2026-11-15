"use client";

import { ChevronsDown, ChevronsUp, Circle, CircleCheck, CircleDot, FileText, Loader2, Route } from "lucide-react";
import { useState } from "react";
import { LazyMarkdown } from "@/components/chat/markdown/lazy-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { usePlanDecision } from "@/hooks/chat/use-pi-chat-plan-decisions";
import { cn } from "@/lib/utils";

export type SessionPlanItemState = "pending" | "in_progress" | "completed" | "cancelled";

export type SessionPlanItem = {
	id: string;
	title: string;
	status: SessionPlanItemState;
};

export type SessionAgentPlanPresentation = {
	steps: string[];
	activeIndex: number;
};

export type SessionPlanPayload = {
	id?: string;
	title: string;
	summary?: string;
	status?: string;
	todos?: Array<{
		step?: number;
		text?: string;
		completed?: boolean;
	}>;
};

export type SessionPlanDecisionPart = {
	type: string;
	toolCallId?: string;
	state?: string;
	input?: {
		plan?: SessionPlanPayload;
		pendingDecision?: boolean;
		executing?: boolean;
		completed?: number;
		total?: number;
		onExecute?: () => Promise<unknown> | void;
		onStay?: () => Promise<unknown> | void;
		onRefine?: (instructions?: string) => Promise<unknown> | void;
		executeLabel?: string;
		stayLabel?: string;
		refineLabel?: string;
		approved?: boolean;
	};
};

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
}

function planFileName(plan: SessionPlanPayload) {
	const rawId = plan.id?.trim();
	if (!rawId) return "plan-working.md";
	if (rawId.endsWith(".md")) return rawId;
	return `plan-${rawId}.md`;
}

function isPlanPartPending(part: SessionPlanDecisionPart, chatStatus?: string) {
	const activelyStreaming = chatStatus === "streaming" || chatStatus === "submitted";
	return activelyStreaming && (part.state === "input-streaming" || part.state === "input-available");
}

function AgentPlan({
	steps,
	activeIndex,
	className,
	...props
}: {
	steps: readonly string[];
	activeIndex: number;
	className?: string;
	"aria-label"?: string;
}) {
	const total = steps.length;
	const completed = !(total > 0) ? 0 : Math.floor(clamp(activeIndex, 0, total));
	const allDone = completed >= total;
	const occurrences = new Map<string, number>();
	const stepKeys = steps.map((step) => {
		const occurrence = occurrences.get(step) ?? 0;
		occurrences.set(step, occurrence + 1);
		return `${step}:${occurrence}`;
	});

	return (
		<Trace data-testid="plan-trace" className={cn("max-w-sm", className)} {...props}>
			<TraceCollapsible defaultOpen>
				<TraceCollapsibleTrigger aria-label={props["aria-label"] ?? `Plan: ${completed} of ${total} done`}>
					<TraceLine status={allDone ? undefined : "running"}>
						<TraceIcon>
							<Route />
						</TraceIcon>
						<TraceTitle>Plan</TraceTitle>
						<TraceDescription className="font-mono text-xs tracking-tight">{`${completed} of ${total} done`}</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<Trace className="gap-1" data-slot="plan-content">
						{steps.map((step, i) => {
							const done = allDone || i < completed;
							const active = !allDone && i === completed;
							const Icon = done ? CircleCheck : active ? CircleDot : Circle;
							return (
								<TraceLine
									key={stepKeys[i]}
									data-plan-step
									status={active ? "running" : !done ? "pending" : undefined}
								>
									<TraceIcon>
										<Icon />
									</TraceIcon>
									<TraceTitle>{step}</TraceTitle>
								</TraceLine>
							);
						})}
					</Trace>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

/**
 * Translates typed PlanWrite todos into the linear AgentPlan model.
 * The presenter uses a single active cursor, so non-contiguous completion
 * falls back to TodoList instead of showing a misleading plan.
 */
export function sessionAgentPlanPresentation(
	items: readonly SessionPlanItem[],
): SessionAgentPlanPresentation | undefined {
	if (items.length === 0) return undefined;

	const steps = items.flatMap((item) => {
		const title = item.title.trim();
		return title ? [title] : [];
	});
	if (steps.length !== items.length) return undefined;

	let activeIndex = 0;
	while (activeIndex < items.length && items[activeIndex]?.status === "completed") {
		activeIndex += 1;
	}

	const hasNonContiguousCompletion = items.slice(activeIndex + 1).some((item) => item.status === "completed");
	if (hasNonContiguousCompletion) return undefined;

	return { steps, activeIndex };
}

export function SessionAgentPlan({
	presentation,
	className,
}: {
	presentation: SessionAgentPlanPresentation;
	className?: string;
}) {
	return (
		<AgentPlan
			steps={presentation.steps}
			activeIndex={presentation.activeIndex}
			aria-label={`Plan progress: ${Math.min(presentation.activeIndex, presentation.steps.length)} of ${presentation.steps.length} steps completed`}
			className={className}
		/>
	);
}

/**
 * Renders the interactive PlanWrite review card when a generated plan awaits execution approval.
 */
export function SessionAgentPlanDecision({
	part,
	chatStatus,
	className,
}: {
	part: SessionPlanDecisionPart;
	chatStatus?: string;
	className?: string;
}) {
	const submitPlanDecision = usePlanDecision();
	const plan = part.input?.plan;
	const [isExpanded, setIsExpanded] = useState(false);
	const [isApproved, setIsApproved] = useState(false);
	const [isActing, setIsActing] = useState<null | "execute" | "stay" | "refine">(null);
	const [isRefining, setIsRefining] = useState(false);
	const [refineText, setRefineText] = useState("");

	if (!plan) return null;

	const isPending = isPlanPartPending(part, chatStatus);
	const toolCallId = part.toolCallId;
	const onExecute =
		part.input?.onExecute ??
		(submitPlanDecision && toolCallId
			? () => submitPlanDecision({ toolCallId, answer: { kind: "single", selectedIds: ["execute"] } })
			: undefined);
	const onStay =
		part.input?.onStay ??
		(submitPlanDecision && toolCallId
			? () => submitPlanDecision({ toolCallId, answer: { kind: "single", selectedIds: ["stay"] } })
			: undefined);
	const onRefine =
		part.input?.onRefine ??
		(submitPlanDecision && toolCallId
			? (instructions?: string) =>
					submitPlanDecision({
						toolCallId,
						answer:
							instructions && instructions.trim().length > 0
								? { kind: "text", text: instructions.trim() }
								: { kind: "single", selectedIds: ["refine"] },
					})
			: undefined);

	const fileName = planFileName(plan);
	const summary = plan.summary?.trim() ?? "";
	const hasSummary = summary.length > 0;
	const completed = part.input?.completed ?? 0;
	const total = part.input?.total ?? plan.todos?.length ?? 0;
	const pendingDecision = Boolean(part.input?.pendingDecision);
	const canAct = pendingDecision && !isPending;
	const isAlreadyApproved =
		part.input?.approved || isApproved || plan.status === "approved" || plan.status === "completed";

	const runAction = async (
		action: "execute" | "stay" | "refine",
		callback?: (() => Promise<unknown> | void) | ((instructions?: string) => Promise<unknown> | void),
		instructions?: string,
	) => {
		if (!callback || isActing) return;

		setIsActing(action);
		try {
			await callback(instructions);
			if (action === "execute") {
				setIsApproved(true);
			}
			if (action === "refine") {
				setRefineText("");
				setIsRefining(false);
			}
		} finally {
			setIsActing(null);
		}
	};

	const actionLabel = total > 0 ? `${completed}/${total} complete` : pendingDecision ? "Awaiting review" : undefined;

	return (
		<div className={cn("overflow-hidden rounded-xl border border-border bg-muted", className)}>
			<div className="flex h-8 items-center justify-between pr-2 pl-3">
				<div className="flex min-w-0 items-center gap-1.5">
					{isPending ? (
						<Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
					) : (
						<FileText className="size-3.5 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate text-xs text-muted-foreground">{fileName}</span>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-compact"
					onClick={() => setIsExpanded((prev) => !prev)}
					aria-label={isExpanded ? "Collapse plan" : "Expand plan"}
					className="size-6 text-muted-foreground hover:text-foreground"
				>
					{isExpanded ? <ChevronsUp className="size-3.5" /> : <ChevronsDown className="size-3.5" />}
				</Button>
			</div>

			<div className="border-t border-border bg-background pt-2.5">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2 px-3">
						<div className="text-sm font-medium text-foreground">{plan.title}</div>
						{actionLabel ? (
							<Badge variant="outline" size="compact" className="text-xs text-muted-foreground">
								{actionLabel}
							</Badge>
						) : null}
					</div>

					{hasSummary ? (
						<div className="relative">
							<div
								className={cn("px-3 text-sm text-muted-foreground", !isExpanded && "max-h-24 overflow-hidden")}
							>
								<LazyMarkdown content={summary} className="text-sm" />
							</div>

							{!isExpanded && (
								<div className="absolute inset-x-0 bottom-0 h-16 pr-2 pb-2 pl-3.5">
									<div className="absolute inset-x-0 bottom-0 h-full w-full bg-linear-to-b from-transparent from-0% to-background to-55%" />
									<div className="relative flex h-full items-end justify-between">
										<Button
											type="button"
											variant="ghost"
											size="compact"
											onClick={() => setIsExpanded(true)}
											className="-mx-2 h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
										>
											Read detailed plan
										</Button>
									</div>
								</div>
							)}
						</div>
					) : (
						<div className="px-3 pb-2 text-xs text-muted-foreground">No plan summary provided.</div>
					)}
				</div>

				{(isExpanded || !hasSummary) && (
					<div className="mt-2 flex items-center justify-between border-t border-border bg-muted px-3 py-2">
						<Button
							type="button"
							variant="ghost"
							size="compact"
							onClick={() => setIsExpanded((prev) => !prev)}
							className="-mx-2 h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
						>
							{isExpanded ? "Hide detailed plan" : "Read detailed plan"}
						</Button>
						{canAct ? (
							<div className="text-xs text-muted-foreground">Choose what to do with this plan.</div>
						) : isAlreadyApproved ? (
							<div className="text-xs text-muted-foreground">Approved</div>
						) : null}
					</div>
				)}

				{canAct ? (
					<div className="flex flex-col gap-2 border-t border-border bg-muted px-3 py-2.5">
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="primary"
								size="compact"
								onClick={() => runAction("execute", onExecute)}
								disabled={Boolean(isActing)}
							>
								{isActing === "execute" ? "Executing..." : (part.input?.executeLabel ?? "Execute")}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="compact"
								onClick={() => runAction("stay", onStay)}
								disabled={Boolean(isActing)}
							>
								{isActing === "stay" ? "Saving..." : (part.input?.stayLabel ?? "Stay")}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="compact"
								onClick={() => setIsRefining((prev) => !prev)}
								disabled={Boolean(isActing)}
							>
								{part.input?.refineLabel ?? "Refine"}
							</Button>
						</div>

						{isRefining ? (
							<div className="flex flex-col gap-2">
								<Textarea
									size="compact"
									value={refineText}
									onChange={(event) => setRefineText(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Escape") {
											event.preventDefault();
											setIsRefining(false);
											setRefineText("");
											return;
										}
										if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
											event.preventDefault();
											void runAction("refine", onRefine, refineText);
										}
									}}
									rows={3}
									placeholder="Describe what should change in the plan"
									className="min-h-18 bg-background text-sm"
								/>
								<div className="flex items-center justify-end gap-2">
									<Button
										type="button"
										variant="outline"
										size="compact"
										onClick={() => {
											setIsRefining(false);
											setRefineText("");
										}}
										disabled={Boolean(isActing)}
									>
										Cancel
									</Button>
									<Button
										type="button"
										variant="primary"
										size="compact"
										onClick={() => runAction("refine", onRefine, refineText)}
										disabled={Boolean(isActing)}
									>
										{isActing === "refine" ? "Submitting..." : "Submit refinement"}
									</Button>
								</div>
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
