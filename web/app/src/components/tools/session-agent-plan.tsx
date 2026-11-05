"use client";

import { Circle, CircleCheck, CircleDot, Route } from "lucide-react";
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
import { mono } from "@/lib/surfaces";
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

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return min;
	return Math.min(max, Math.max(min, value));
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
						<TraceDescription className={cn(mono, "text-xs")}>{`${completed} of ${total} done`}</TraceDescription>
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
