import { memo } from "react"
import { IconCodeCircle } from "@tabler/icons-react"
import { ToolTextShimmer } from "../tool-text-shimmer"
import { useToolComplete } from "../hooks/use-tool-complete"
import { adaptToolPart } from "../utils/tool-adapters"
import { ToolApprovalFooter } from "./tool-approval-footer"
import type { ToolApproval } from "./tool-approval-footer"
import type { StepState, TimelineStep } from "../types/timeline"

type IpythonDetails = {
  durationMs?: number
  status?: "ok" | "error" | "aborted" | "starting"
  errorEname?: string
  stdout?: string
  stderr?: string
  result?: string
  kernelRestarted?: boolean
  error?: { ename: string; evalue: string; traceback?: string[] }
}

function getInputCode(part: any): string {
  const input = part.input ?? part.args ?? {}
  if (typeof input.code === "string") return input.code
  return ""
}

function getOutputDetails(part: any): IpythonDetails | undefined {
  const out = part.output ?? part.result
  if (!out || typeof out !== "object") return undefined
  return out as IpythonDetails
}

function firstNonEmpty(...candidates: Array<string | undefined>): string {
  for (const c of candidates) {
    if (c && c.trim()) return c
  }
  return ""
}

type IpythonCellCardProps = {
  step: Extract<TimelineStep, { type: "tool-call" }>
  state: StepState
  onComplete: () => void
  approval?: ToolApproval
  cellIndex?: number
  part: any
}

function IpythonCellCard({
  step,
  state,
  onComplete,
  approval,
  cellIndex,
  part,
}: IpythonCellCardProps) {
  useToolComplete(state === "animating", step.duration, onComplete)
  const isPending = state === "animating"
  const code = getInputCode(part)
  const details = getOutputDetails(part)
  const isBashCell = code.trimStart().startsWith("%%bash")
  const cellLabel = cellIndex !== undefined ? `In [${cellIndex}]` : "IPython"
  const displayOutput = firstNonEmpty(
    details?.result,
    details?.stdout,
    details?.stderr,
    details?.error?.evalue
  )
  const hasError =
    Boolean(details?.error) ||
    Boolean(details?.errorEname) ||
    details?.status === "error"

  return (
    <div className="overflow-hidden rounded-an-tool-border-radius border border-border bg-an-tool-background">
      <div className="flex h-7 items-center justify-between pr-2 pl-2.5">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground uppercase">
            <IconCodeCircle className="h-3 w-3" />
            {isBashCell ? "shell" : "python"}
          </span>
          {isPending ? (
            <ToolTextShimmer
              as="span"
              duration={1.2}
              className="m-0 inline-flex h-full items-center truncate text-xs leading-none"
            >
              Running cell
            </ToolTextShimmer>
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              {hasError ? "Cell failed" : "Ran cell"}
              {details?.kernelRestarted && " · kernel restarted"}
            </span>
          )}
        </div>
        {isPending && (
          <svg
            className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="28"
              strokeDashoffset="7"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>
      <div className="overflow-hidden border-t border-border bg-background px-2.5 py-1.5 font-mono text-[12px] leading-[16px]">
        <div className="break-all whitespace-pre-wrap">
          <span className="mr-2 text-cyan-600 select-none dark:text-cyan-400">
            {cellLabel}:
          </span>
          <span className="text-foreground">{code}</span>
        </div>
        {!isPending && displayOutput && (
          <div
            className={`mt-1 max-h-[160px] overflow-hidden whitespace-pre-line ${
              hasError ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
            }`}
          >
            {displayOutput}
          </div>
        )}
      </div>
      {approval && <ToolApprovalFooter isPending={isPending} {...approval} />}
    </div>
  )
}

// Per-session cell counter — incremented once per *new* toolCallId.
const cellCounterByToolCallId = new Map<string, number>()
let lastCellIndex = 0

function nextCellIndex(toolCallId: string | undefined): number {
  if (!toolCallId) return ++lastCellIndex
  const existing = cellCounterByToolCallId.get(toolCallId)
  if (existing) return existing
  const next = ++lastCellIndex
  cellCounterByToolCallId.set(toolCallId, next)
  return next
}

export type IpythonToolProps = {
  part: any
}

export const IpythonTool = memo(function IpythonTool({ part }: IpythonToolProps) {
  const approval = (part.input?.approval ?? part.args?.approval) as
    | ToolApproval
    | undefined
  const { step, stepState } = adaptToolPart(part, "IPython")
  const cellIndex = nextCellIndex(part.toolCallId)
  const noop = () => {}

  return (
    <IpythonCellCard
      step={step}
      state={stepState}
      onComplete={noop}
      approval={approval}
      cellIndex={cellIndex}
      part={part}
    />
  )
})
