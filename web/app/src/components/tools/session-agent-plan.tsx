"use client";

import { AgentPlan } from "@/components/tools/agent-plan";

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
