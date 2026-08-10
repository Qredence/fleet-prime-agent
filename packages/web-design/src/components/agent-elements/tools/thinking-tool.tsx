import { memo } from "react"
import { useToolComplete } from "../hooks/use-tool-complete"
import { adaptToolPart } from "../utils/tool-adapters"
import { ToolRowBase } from "./tool-row-base"
import type { StepState, TimelineStep } from "../types/timeline"

type ThinkingCollapsedProps = {
  step: Extract<TimelineStep, { type: "tool-call" }>
  state: StepState
  onComplete: () => void
  defaultOpen?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
}

function ThinkingCollapsed({
  step,
  state,
  onComplete,
  defaultOpen,
  expanded,
  onToggleExpand,
}: ThinkingCollapsedProps) {
  useToolComplete(state === "animating", step.duration, onComplete)

  return (
    <ToolRowBase
      shimmerLabel="Thinking"
      completeLabel="Thought"
      isAnimating={state === "animating"}
      expandable={!!step.thoughtContent}
      defaultOpen={defaultOpen}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    >
      <div className="max-h-[175px] overflow-y-auto">
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {step.thoughtContent}
        </p>
      </div>
    </ToolRowBase>
  )
}

export type ThinkingToolProps = {
  part?: any
  step?: Extract<TimelineStep, { type: "tool-call" }>
  state?: StepState
  onComplete?: () => void
  defaultOpen?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
}

export const ThinkingTool = memo(function ThinkingTool({
  part,
  step: externalStep,
  state: externalState,
  onComplete: externalOnComplete,
  defaultOpen,
  expanded,
  onToggleExpand,
}: ThinkingToolProps) {
  let step: Extract<TimelineStep, { type: "tool-call" }>
  let stepState: StepState
  let onComplete: () => void

  if (externalStep && externalState && externalOnComplete) {
    step = externalStep
    stepState = externalState
    onComplete = externalOnComplete
  } else if (part) {
    const adapted = adaptToolPart(part, "Thinking")
    step = adapted.step
    stepState = adapted.stepState
    onComplete = () => {}
  } else {
    return null
  }

  return (
    <ThinkingCollapsed
      step={step}
      state={stepState}
      onComplete={onComplete}
      defaultOpen={defaultOpen}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  )
})
