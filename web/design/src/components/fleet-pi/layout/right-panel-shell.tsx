import { FolderOpen, Library } from "lucide-react"
import { useState } from "react"
import { Button } from "../../button"
import { ResizableCanvas } from "../pi/resizable-canvas"
import { MobilePanel } from "../pi/right-panel-launcher"
import { OpenProjectFolderDialog } from "../pi/open-project-folder-dialog"
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
  const { browseWorkspace, setWorkspaceRoot, workspaceTree } =
    useWorkspaceTreeContext()
  const {
    browseWorkspace: _,
    setWorkspaceRoot: __,
    ...contentRest
  } = panelProps
  const contentProps = contentRest as RightPanelContentProps
  void _
  void __
  const panelOpen = rightPanel !== null
  const definition = rightPanel ? getRightPanelDefinition(rightPanel) : null
  const [openFolderDialog, setOpenFolderDialog] = useState(false)

  const workspaceHeaderActions =
    rightPanel === "workspace" ? (
      <Button
        className="h-7 gap-1 px-2 text-xs"
        data-testid="open-project-folder-button"
        onClick={() => setOpenFolderDialog(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <FolderOpen className="size-3.5" data-icon="inline-start" />
        Open project folder
      </Button>
    ) : null

  return (
    <>
      <MobilePanel
        dataTestid={definition?.mobileDataTestid}
        headerActions={workspaceHeaderActions}
        icon={definition?.icon}
        onClose={() => setRightPanel(null)}
        open={panelOpen}
        title={definition?.title ?? ""}
      >
        {definition?.render(contentProps)}
      </MobilePanel>

      <ResizableCanvas
        dataTestid={definition?.dataTestid}
        headerActions={workspaceHeaderActions}
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

      <OpenProjectFolderDialog
        browseWorkspace={browseWorkspace}
        initialPath={workspaceTree?.root ?? ""}
        key={openFolderDialog ? (workspaceTree?.root ?? "") : "closed"}
        onOpenChange={setOpenFolderDialog}
        onSelectRoot={setWorkspaceRoot}
        open={openFolderDialog}
      />
    </>
  )
}
