import { memo } from "react"
import { ToolRenderer } from "../../agents/tools/tool-renderer"
import { PI_TOOL_RENDERERS } from "../pi/tool-renderers"
import type { ToolRendererProps } from "../../agents/tools/tool-renderer"
import { BeuiToolRenderer } from "./beui-tool-renderer"

/**
 * The official AgentActivity already conveys a completed terminal activity.
 * Completed Bash/IPython details live in Artifacts; only active and failed
 * executions remain inline in the conversation.
 */
function isCompletedArtifactTool(part: unknown, chatStatus: ToolRendererProps["chatStatus"]) {
  if (!part || typeof part !== "object") return false
  const record = part as Record<string, unknown>
  if (record.type !== "tool-Bash" && record.type !== "tool-IPython") return false
	if (chatStatus === "streaming") return false
  return record.state === "output-available" || record.state === "complete"
}

// Prime-agent web keeps the existing Fleet fallback renderer for parts without
// a rich payload, while routing every tool part through the locally owned BEUI
// presentation layer first.
export const FleetPiToolRenderer = memo(function FleetPiToolRenderer(
  props: ToolRendererProps
) {
  const partType = props.part.type as string
  if (partType === "tool-Thinking" || partType === "tool-FleetReasoning") return null
  if (isCompletedArtifactTool(props.part, props.chatStatus)) return null

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
