import { memo } from "react"
import { ToolRenderer } from "../../agent-elements/tools/tool-renderer"
import { GenericTool } from "../../agent-elements/tools/generic-tool"
import { EditTool } from "../../agent-elements/tools/edit-tool"
import { toolRegistry } from "../../agent-elements/tools/tool-registry"
import { getToolStatus } from "../../agent-elements/utils/format-tool"
import { PI_TOOL_RENDERERS } from "../pi/tool-renderers"
import type { ToolRendererProps } from "../../agent-elements/tools/tool-renderer"

// Prime-agent web: the `fleet-pi` EditTool / workspace-write / workspace-tree
// hooks are out of scope (no workspace panel in v1). We still dispatch tool-IPython,
// tool-Bash, tool-Edit through the shared ToolRenderer, which picks the specialised
// card per partType; everything else falls back to GenericTool via the empty
// PI_TOOL_RENDERERS table.
export const FleetPiToolRenderer = memo(function FleetPiToolRenderer(
  props: ToolRendererProps
) {
  const partType = props.part.type as string

  if (partType === "tool-Edit" || partType === "tool-Write") {
    return <EditTool part={props.part} />
  }

  if (partType === "tool-Read") {
    const meta = toolRegistry[partType]
    if (meta) {
      const { isPending, isError } = getToolStatus(props.part, props.chatStatus)
      return (
        <GenericTool
          icon={meta.icon}
          title={meta.title(props.part)}
          subtitle={meta.subtitle?.(props.part)}
          isPending={isPending}
          isError={isError}
        />
      )
    }
  }

  return <ToolRenderer {...props} toolRenderers={PI_TOOL_RENDERERS} />
})
