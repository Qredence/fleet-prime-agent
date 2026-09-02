import { Library } from "lucide-react"
import { ResizableCanvas } from "../pi/resizable-canvas"
import {
  MobilePanel,
  RightPanelTabsFromContext,
} from "../pi/right-panel-launcher"
import {
  getRightPanelDefinition,
} from "./right-panel-registry"
import {
  useChatPanelDataContext,
  useWorkspaceTreeContext,
} from "./right-panel-context"
import type { PointerEvent as ReactPointerEvent } from "react"

export type RightPanelShellProps = {
  handleResourceCanvasResizeStart: (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => void
  onClose: () => void
  resourceCanvasWidth: number
}

export function RightPanelShell({
  handleResourceCanvasResizeStart,
  onClose,
  resourceCanvasWidth,
}: RightPanelShellProps) {
  const chat = useChatPanelDataContext()
  const workspace = useWorkspaceTreeContext()
  const { rightPanel } = chat
  const panelOpen = rightPanel !== null
  const definition = rightPanel ? getRightPanelDefinition(rightPanel) : null
  const PanelContent = definition?.component
  const loading =
    definition?.loadingSource === "resources"
      ? chat.resourcesLoading
      : definition?.loadingSource === "workspace"
        ? workspace.workspaceLoading
        : false
  const onRefresh =
    definition?.refreshSource === "resources"
      ? chat.refreshResources
      : definition?.refreshSource === "workspace"
        ? workspace.refreshWorkspace
        : undefined
  return (
    <>
      <MobilePanel
        dataTestid={definition?.mobileDataTestid}
        icon={definition?.icon}
        onClose={onClose}
        open={panelOpen}
        title={definition?.title ?? ""}
      >
        {PanelContent ? <PanelContent /> : null}
      </MobilePanel>

      <ResizableCanvas
        dataTestid={definition?.dataTestid}
        headerLeading={
          <RightPanelTabsFromContext idPrefix="right-panel-desktop" />
        }
        loading={loading}
        onClose={onClose}
        onRefresh={onRefresh}
        onResizeStart={handleResourceCanvasResizeStart}
        open={panelOpen}
        title={definition?.title ?? ""}
        titleIcon={definition?.icon ?? Library}
        width={resourceCanvasWidth}
      >
        {PanelContent ? <PanelContent /> : null}
      </ResizableCanvas>
    </>
  )
}
