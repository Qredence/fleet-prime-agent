import { Library } from "lucide-react"
import { ResizableCanvas } from "../pi/resizable-canvas"
import { MobilePanel } from "../pi/right-panel-launcher"
import { getRightPanelDefinition } from "./right-panel-registry"
import { useRightPanelContext } from "./right-panel-context"
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
  const { rightPanel, setRightPanel, ...contentProps } = useRightPanelContext()
  const panelOpen = rightPanel !== null
  const definition = rightPanel ? getRightPanelDefinition(rightPanel) : null

  return (
    <>
      <MobilePanel
        dataTestid={definition?.mobileDataTestid}
        headerActions={null}
        icon={definition?.icon}
        onClose={() => setRightPanel(null)}
        open={panelOpen}
        title={definition?.title ?? ""}
      >
        {definition?.render(contentProps)}
      </MobilePanel>

      <ResizableCanvas
        dataTestid={definition?.dataTestid}
        headerActions={null}
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
