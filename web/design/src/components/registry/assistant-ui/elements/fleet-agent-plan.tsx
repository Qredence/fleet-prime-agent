"use client"

import { AgentPlan } from "./agent-plan"

export type FleetPlanItemState = "pending" | "in_progress" | "completed" | "cancelled"

export type FleetPlanItem = {
  id: string
  title: string
  status: FleetPlanItemState
}

export type FleetAgentPlanPresentation = {
  steps: string[]
  activeIndex: number
}

/**
 * Translates Fleet's existing typed PlanWrite todos into the narrower model
 * accepted by the official Assistant UI AgentPlan element. The element models
 * a single active cursor, so non-contiguous completion deliberately falls back
 * to the existing TodoList presenter instead of producing a misleading plan.
 */
export function fleetAgentPlanPresentation(
  items: readonly FleetPlanItem[],
): FleetAgentPlanPresentation | undefined {
  if (items.length === 0) return undefined

  const steps = items.flatMap((item) => {
    const title = item.title.trim();
    return title ? [title] : [];
  });
  if (steps.length !== items.length) return undefined

  let activeIndex = 0
  while (activeIndex < items.length && items[activeIndex]?.status === "completed") {
    activeIndex += 1
  }

  const hasNonContiguousCompletion = items
    .slice(activeIndex + 1)
    .some((item) => item.status === "completed")
  if (hasNonContiguousCompletion) return undefined

  return { steps, activeIndex }
}

export function FleetAgentPlan({
  presentation,
  className,
}: {
  presentation: FleetAgentPlanPresentation
  className?: string
}) {
  return (
    <AgentPlan
      steps={presentation.steps}
      activeIndex={presentation.activeIndex}
      aria-label={`Plan progress: ${Math.min(presentation.activeIndex, presentation.steps.length)} of ${presentation.steps.length} steps completed`}
      className={className}
    />
  )
}
