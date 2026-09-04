import { memo } from "react"
import { Code2 } from "lucide-react"
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
  backgroundOutput?: string
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

/**
 * Renders the status header for an IPython or shell cell.
 *
 * @param isPending - Whether the cell is still running
 * @param isBashCell - Whether the cell contains shell commands
 * @param hasError - Whether the cell execution failed
 * @param kernelRestarted - Whether execution restarted the kernel
 */
function IpythonCardHeader({
  isPending,
  isBashCell,
  hasError,
  kernelRestarted,
}: {
  isPending: boolean
  isBashCell: boolean
  hasError: boolean
  kernelRestarted?: boolean
}) {
  return (
    <div className="flex h-7 items-center justify-between pr-2 pl-2.5">
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <span className="inline-flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground uppercase">
          <Code2 className="h-3 w-3" />
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
            {kernelRestarted && " · kernel restarted"}
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
  )
}

/**
 * Displays background output that is not attributed to a specific cell.
 *
 * @param output - The background output to display
 */
function IpythonBackgroundOutput({ output }: { output: string }) {
  return (
    <div className="mt-1.5 border-t border-dashed border-border/70 pt-1.5 font-mono text-[11px] leading-[15px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600/90 dark:text-amber-400/90">
        Unattributed background output:
      </span>
      <div className="mt-0.5 max-h-[140px] overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-1.5 text-muted-foreground">
        {output}
      </div>
    </div>
  )
}

/**
 * Renders an IPython or Bash cell with its code, execution status, output, errors, background output, and approval controls.
 *
 * @param step - Execution step information used to schedule completion.
 * @param state - Current execution state of the cell.
 * @param onComplete - Callback invoked when the cell finishes animating.
 * @param approval - Optional approval data for rendering approval controls.
 * @param cellIndex - Optional notebook cell index displayed with the code.
 * @param part - Tool-call data containing the cell input and output details.
 */
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
  const backgroundOutput =
    typeof part.backgroundOutput === "string" && part.backgroundOutput.trim()
      ? part.backgroundOutput
      : typeof details?.backgroundOutput === "string" && details.backgroundOutput.trim()
        ? details.backgroundOutput
        : undefined
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
      <IpythonCardHeader
        isPending={isPending}
        isBashCell={isBashCell}
        hasError={hasError}
        kernelRestarted={details?.kernelRestarted}
      />
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
        {backgroundOutput && <IpythonBackgroundOutput output={backgroundOutput} />}
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
