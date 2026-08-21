import { memo, useState } from "react"
import {
  IconChevronsDown,
  IconChevronsUp,
  IconFileDescription,
} from "@tabler/icons-react"
import { Markdown } from "../markdown"
import { IconSpinner } from "../icons"
import { areToolPropsEqual, getToolStatus } from "../utils/format-tool"
import { cn } from "../utils/cn"

export type Plan = {
  id?: string
  title: string
  summary?: string
  status?: string
  todos?: Array<{
    step: number
    text: string
    completed: boolean
  }>
}

export type PlanToolProps = {
  part: {
    type: string
    toolCallId?: string
    state?: string
    input?: {
      plan?: Plan
      pendingDecision?: boolean
      executing?: boolean
      completed?: number
      total?: number
      onExecute?: () => Promise<unknown> | void
      onStay?: () => Promise<unknown> | void
      onRefine?: (instructions?: string) => Promise<unknown> | void
      executeLabel?: string
      stayLabel?: string
      refineLabel?: string
      approved?: boolean
    }
  }
  chatStatus?: string
}

function getPlanFileName(plan: Plan) {
  const rawId = plan.id?.trim()
  if (!rawId) return "plan-working.md"
  if (rawId.endsWith(".md")) return rawId
  return `plan-${rawId}.md`
}

export const PlanTool = memo(function PlanTool({
  part,
  chatStatus,
}: PlanToolProps) {
  const { isPending } = getToolStatus(part, chatStatus)
  const plan = part.input?.plan
  const [isExpanded, setIsExpanded] = useState(false)
  const [isApproved, setIsApproved] = useState(false)
  const [isActing, setIsActing] = useState<
    null | "execute" | "stay" | "refine"
  >(null)
  const [isRefining, setIsRefining] = useState(false)
  const [refineText, setRefineText] = useState("")

  if (!plan) return null

  const fileName = getPlanFileName(plan)
  const summary = plan.summary?.trim() ?? ""
  const hasSummary = summary.length > 0
  const completed = part.input?.completed ?? 0
  const total = part.input?.total ?? plan.todos?.length ?? 0
  const pendingDecision = Boolean(part.input?.pendingDecision)
  const canAct = pendingDecision && !isPending
  const isAlreadyApproved =
    part.input?.approved ||
    isApproved ||
    plan.status === "approved" ||
    plan.status === "completed"

  const runAction = async (
    action: "execute" | "stay" | "refine",
    callback?:
      | (() => Promise<unknown> | void)
      | ((instructions?: string) => Promise<unknown> | void),
    instructions?: string
  ) => {
    if (!callback || isActing) return

    setIsActing(action)
    try {
      await callback(instructions)
      if (action === "execute") {
        setIsApproved(true)
      }
      if (action === "refine") {
        setRefineText("")
        setIsRefining(false)
      }
    } finally {
      setIsActing(null)
    }
  }

  const actionLabel =
    total > 0
      ? `${completed}/${total} complete`
      : pendingDecision
        ? "Awaiting review"
        : undefined

  return (
    <div className="an-tool-plan overflow-hidden rounded-an-tool-border-radius border border-border bg-an-tool-background">
      <div className="flex h-7 items-center justify-between pr-2.5 pl-3">
        <div className="flex min-w-0 items-center gap-1">
          {isPending ? (
            <IconSpinner className="h-3 w-3 shrink-0 animate-spin text-an-tool-color-muted" />
          ) : (
            <IconFileDescription className="h-3.5 w-3.5 shrink-0 text-an-tool-color-muted" />
          )}
          <span className="truncate text-xs text-an-tool-color-muted">
            {fileName}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-label={isExpanded ? "Collapse plan" : "Expand plan"}
          className="inline-flex size-5 items-center justify-center text-an-tool-color-muted"
        >
          {isExpanded ? (
            <IconChevronsUp className="h-3.5 w-3.5" />
          ) : (
            <IconChevronsDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="border-t border-border bg-background pt-2">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 px-3">
            <div className="text-sm text-an-tool-color">{plan.title}</div>
            {actionLabel ? (
              <div className="rounded-full border border-border px-2 py-0.5 text-[11px] text-an-tool-color-muted">
                {actionLabel}
              </div>
            ) : null}
          </div>

          {hasSummary ? (
            <div className="relative">
              <div
                className={cn(
                  "px-3",
                  "text-sm text-an-tool-color-muted",
                  !isExpanded && "max-h-[94px] overflow-hidden"
                )}
              >
                <Markdown content={summary} className="text-sm" />
              </div>

              {!isExpanded && (
                <div className="absolute inset-x-0 bottom-0 h-16 pr-2 pb-2 pl-3.5">
                  <div className="absolute inset-x-0 bottom-0 h-full w-full bg-linear-to-b from-transparent from-0% to-background to-50%" />
                  <div className="relative flex h-full items-end justify-between">
                    <button
                      type="button"
                      onClick={() => setIsExpanded(true)}
                      className="-mx-2 h-5 rounded-[4px] px-1.5 text-xs text-muted-foreground hover:text-an-tool-color"
                    >
                      Read detailed plan
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-an-tool-color-muted">
              No plan summary provided.
            </div>
          )}
        </div>

        {(isExpanded || !hasSummary) && (
          <div className="mt-2 flex items-center justify-between border-t border-border bg-an-tool-background pt-1.5 pr-2 pb-2 pl-3.5">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="-mx-2 h-5 rounded-[4px] px-1.5 text-xs text-muted-foreground hover:text-an-tool-color"
            >
              {isExpanded ? "Hide detailed plan" : "Read detailed plan"}
            </button>
            {canAct ? (
              <div className="text-[11px] text-an-tool-color-muted">
                Choose what to do with this plan.
              </div>
            ) : isAlreadyApproved ? (
              <div className="text-[11px] text-an-tool-color-muted">
                Approved
              </div>
            ) : null}
          </div>
        )}

        {canAct ? (
          <div className="flex flex-col gap-2 border-t border-border bg-an-tool-background px-3 py-2.5">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => runAction("execute", part.input?.onExecute)}
                disabled={Boolean(isActing)}
                className="h-7 rounded-[6px] bg-an-primary-color px-2.5 text-xs font-medium text-an-send-button-color disabled:opacity-60"
              >
                {isActing === "execute"
                  ? "Executing..."
                  : (part.input?.executeLabel ?? "Execute")}
              </button>
              <button
                type="button"
                onClick={() => runAction("stay", part.input?.onStay)}
                disabled={Boolean(isActing)}
                className="h-7 rounded-[6px] border border-border px-2.5 text-xs text-an-tool-color disabled:opacity-60"
              >
                {isActing === "stay"
                  ? "Saving..."
                  : (part.input?.stayLabel ?? "Stay")}
              </button>
              <button
                type="button"
                onClick={() => setIsRefining((prev) => !prev)}
                disabled={Boolean(isActing)}
                className="h-7 rounded-[6px] border border-border px-2.5 text-xs text-an-tool-color disabled:opacity-60"
              >
                {part.input?.refineLabel ?? "Refine"}
              </button>
            </div>

            {isRefining ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={refineText}
                  onChange={(event) => setRefineText(event.target.value)}
                  rows={3}
                  placeholder="Describe what should change in the plan"
                  className="w-full resize-y rounded-[8px] border border-border bg-background px-3 py-2 text-sm text-an-tool-color outline-none focus:border-an-primary-color"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRefining(false)
                      setRefineText("")
                    }}
                    disabled={Boolean(isActing)}
                    className="h-7 rounded-[6px] border border-border px-2.5 text-xs text-an-tool-color disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      runAction("refine", part.input?.onRefine, refineText)
                    }
                    disabled={Boolean(isActing)}
                    className="h-7 rounded-[6px] bg-an-primary-color px-2.5 text-xs font-medium text-an-send-button-color disabled:opacity-60"
                  >
                    {isActing === "refine"
                      ? "Submitting..."
                      : "Submit refinement"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}, areToolPropsEqual)
