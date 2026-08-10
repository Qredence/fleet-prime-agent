import { memo } from "react"
import { IconFileText } from "@tabler/icons-react"
import { useToolComplete } from "../hooks/use-tool-complete"
import { adaptToolPart } from "../utils/tool-adapters"
import { cn } from "../utils/cn"
import { ToolRowBase } from "./tool-row-base"
import type { SourceType } from "../icons/source-icons"
import type { StepState, TimelineStep } from "../types/timeline"

export type SearchResult = { source: SourceType; title: string; date: string }

type SearchGroupRichProps = {
  toolSteps: Array<Extract<TimelineStep, { type: "tool-call" }>>
  stepStates: Record<string, StepState>
  onStepComplete: (id: string) => void
  results?: Array<SearchResult>
  defaultOpen?: boolean
}

function SearchGroupRich({
  toolSteps,
  stepStates,
  onStepComplete,
  results = [],
  defaultOpen,
}: SearchGroupRichProps) {
  const anyAnimating = toolSteps.some((s) => stepStates[s.id] === "animating")
  const searchQuery =
    toolSteps.find((s) => s.searchQuery)?.searchQuery ?? "searching..."
  const totalResults = results.length
  // Only expose the expand affordance once there is something useful to show.
  // While the search is still streaming we have no results yet and the panel
  // header is just "Searched for <same query>" — redundant with the row
  // label. Once results arrive the panel becomes meaningful.
  const hasExpandableContent = totalResults > 0

  function CompleteTracker({
    step,
  }: {
    step: Extract<TimelineStep, { type: "tool-call" }>
  }) {
    useToolComplete(stepStates[step.id] === "animating", step.duration, () =>
      onStepComplete(step.id)
    )
    return null
  }

  return (
    <>
      {toolSteps.map((step) => (
        <CompleteTracker key={step.id} step={step} />
      ))}
      <ToolRowBase
        shimmerLabel="Searching..."
        completeLabel={`Found ${totalResults} results`}
        isAnimating={anyAnimating}
        expandable={hasExpandableContent}
        defaultOpen={defaultOpen}
      >
        <div className="overflow-hidden rounded-an-tool-border-radius border border-border bg-an-tool-background">
          <div className="flex h-7 items-center gap-1 border-b border-an-tool-border-color px-2.5 py-0 text-xs">
            <span className="font-medium text-foreground">Searched for</span>{" "}
            <span className="truncate text-muted-foreground">
              &ldquo;{searchQuery}&rdquo;
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto bg-background">
            <div className="flex flex-col gap-1 p-1">
              {results.map((result, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-[calc(var(--an-tool-border-radius)-4px)] px-2 py-1",
                    "hover:bg-muted/50"
                  )}
                >
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground">
                    <IconFileText className="h-4 w-4" />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                    {result.title}
                  </span>
                  <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                    {result.date || result.source}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </ToolRowBase>
    </>
  )
}

export type SearchToolProps = {
  part: {
    id?: string
    toolCallId?: string
    type?: string
    state?: string
    input?: Record<string, unknown>
    args?: Record<string, unknown>
    output?: Record<string, unknown>
    result?: Record<string, unknown>
  }
  results?: Array<SearchResult>
  defaultOpen?: boolean
}

function normalizeResults(value: unknown): Array<SearchResult> | undefined {
  if (!Array.isArray(value)) return undefined
  const parsed = value
    .map((item) => {
      if (!item || typeof item !== "object") return null
      const source = (item as { source?: unknown }).source
      const title = (item as { title?: unknown }).title
      const date = (item as { date?: unknown }).date
      if (
        typeof source !== "string" ||
        typeof title !== "string" ||
        typeof date !== "string"
      ) {
        return null
      }
      return { source: source as SourceType, title, date }
    })
    .filter((item): item is SearchResult => Boolean(item))
  return parsed.length > 0 ? parsed : undefined
}

export const SearchTool = memo(function SearchTool({
  part,
  results,
  defaultOpen,
}: SearchToolProps) {
  const toolName = part.type?.replace("tool-", "") || "WebSearch"
  const { step, stepState } = adaptToolPart(part, toolName)
  const stepStates = { [step.id]: stepState }
  const noop = () => {}

  return (
    <SearchGroupRich
      toolSteps={[step]}
      stepStates={stepStates}
      onStepComplete={noop}
      results={
        results ??
        normalizeResults(part.output?.results) ??
        normalizeResults(part.result?.results)
      }
      defaultOpen={defaultOpen}
    />
  )
})
