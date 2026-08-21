import { memo } from "react"
import { ToolRenderer } from "../../agents/tools/tool-renderer"
import { PI_TOOL_RENDERERS } from "../pi/tool-renderers"
import type { ToolRendererProps } from "../../agents/tools/tool-renderer"
import { BeuiToolRenderer } from "./beui-tool-renderer"

function hasVisibleToolOutput(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return ["content", "text", "stdout", "stderr", "result", "data"].some((key) =>
    hasVisibleToolOutput(record[key]),
  )
}

/**
 * The official ToolTimeline already conveys a completed terminal activity.
 * Retain a terminal card only when it gives the user real output to inspect.
 */
function isTimelineOnlyTechnicalTool(part: unknown) {
  if (!part || typeof part !== "object") return false
  const record = part as Record<string, unknown>
  if (record.type !== "tool-Bash" && record.type !== "tool-IPython") return false
  if (record.state !== "output-available" && record.state !== "complete") return false
  return !hasVisibleToolOutput(record.output) && !hasVisibleToolOutput(record.result)
}

// Prime-agent web keeps the existing Fleet fallback renderer for parts without
// a rich payload, while routing every tool part through the locally owned BEUI
// presentation layer first.
export const FleetPiToolRenderer = memo(function FleetPiToolRenderer(
  props: ToolRendererProps
) {
  const partType = props.part.type as string
  if (isTimelineOnlyTechnicalTool(props.part)) return null

  const fallback = (
    <ToolRenderer {...props} toolRenderers={PI_TOOL_RENDERERS} />
  )

  // Give every Prime tool the BEUI presentation layer first. The renderer
  // returns the existing Fleet renderer when a part has no rich payload, so
  // unknown tools and grouped task/agent calls still degrade safely.
  if (partType.startsWith("tool-")) {
    return <BeuiToolRenderer {...props} fallback={fallback} />
  }

  return fallback
})
