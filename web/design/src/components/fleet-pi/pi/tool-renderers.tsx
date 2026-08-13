// prime-agent's native tool surface (ipython / edit / bash) is rendered by the
// specialised components in `../agent-elements/tools/`; there is no workspace
// inventory/install/index runtime to adapt here. Keep the exported name so the
// chat shell's existing wiring (`<FleetPiAgentChat toolRenderers={...} />` and
// `<FleetPiToolRenderer />`) type-checks against an empty table.
import type { ComponentType } from "react"
import type { CustomToolRendererProps } from "../../agent-elements/types"

export const PI_TOOL_RENDERERS: Record<
	string,
	ComponentType<CustomToolRendererProps>
> = {}
