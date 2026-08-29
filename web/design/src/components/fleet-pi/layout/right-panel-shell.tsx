import { Library } from "lucide-react"
import { ResizableCanvas } from "../pi/resizable-canvas"
import {
  MobilePanel,
  RightPanelTabsFromContext,
} from "../pi/right-panel-launcher"
import {
  getRightPanelDefinition,
  type RightPanelContentProps,
} from "./right-panel-registry"
import {
  useRightPanelContext,
  useWorkspaceTreeContext,
} from "./right-panel-context"
import type { PointerEvent as ReactPointerEvent } from "react"

export type RightPanelShellProps = {
  handleResourceCanvasResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void
  resourceCanvasWidth: number
}

export function RightPanelShell({
  handleResourceCanvasResizeStart,
  resourceCanvasWidth,
}: RightPanelShellProps) {
  const { rightPanel, setRightPanel, ...panelProps } = useRightPanelContext()
  useWorkspaceTreeContext()
  const contentProps = panelProps as RightPanelContentProps
  const panelOpen = rightPanel !== null
  const definition = rightPanel ? getRightPanelDefinition(rightPanel) : null
  return (
    <>
      <MobilePanel
        dataTestid={definition?.mobileDataTestid}
        icon={definition?.icon}
        onClose={() => setRightPanel(null)}
        open={panelOpen}
        title={definition?.title ?? ""}
      >
        {definition?.render(contentProps)}
      </MobilePanel>

      <ResizableCanvas
        dataTestid={definition?.dataTestid}
        headerLeading={
          <RightPanelTabsFromContext idPrefix="right-panel-desktop" />
        }
        loading={definition ? definition.getLoading(contentProps) : false}
        onClose={() => setRightPanel(null)}
        onRefresh={definition?.getOnRefresh(contentProps)}
        onResizeStart={handleResourceCanvasResizeStart}
        open={panelOpen}
        title={definition?.title ?? ""}
        titleIcon={definition?.icon ?? Library}
        width={resourceCanvasWidth}
      >
        {definition?.render(contentProps)}
      </ResizableCanvas>
    </>
  )
}
