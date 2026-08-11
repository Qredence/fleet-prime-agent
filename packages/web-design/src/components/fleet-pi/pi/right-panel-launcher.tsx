import { Folder, Library, Package, X } from "lucide-react"
import { useEffect, useEffectEvent, useId, useMemo, useRef } from "react"
import { TabsSubtle, TabsSubtleItem } from "../../tabs-subtle"
import { DESKTOP_PANEL_ONLY } from "../../../lib/layout-constants"
import {
  useChatPanelDataContext,
  useWorkspaceTreeContext,
} from "../layout/right-panel-context"
import { HIT_AREA_EXPAND_CLASS, PANEL_OVERLAY_CLASS } from "../styles/tokens"
import { getArtifactsScopePath } from "./artifacts-utils"
import {
  countWorkspaceFiles,
  findWorkspaceNode,
  getResourceGroups,
} from "./shared"
import type { ReactNode } from "react"
import type { RightPanel } from "../../../lib/canvas-utils"
import type {
  ChatResourcesResponse,
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"
/** Reads panel state from RightPanelProvider — no prop threading from route. */
export function RightPanelLauncherFromContext() {
  const { rightPanel, setRightPanel, resources } = useChatPanelDataContext()
  const { workspaceTree } = useWorkspaceTreeContext()

  return (
    <RightPanelLauncher
      activePanel={rightPanel}
      onPanelChange={setRightPanel}
      resources={resources}
      workspace={workspaceTree}
    />
  )
}

export function RightPanelLauncher({
  activePanel,
  onPanelChange,
  resources,
  workspace,
}: {
  activePanel: RightPanel
  onPanelChange: (panel: RightPanel) => void
  resources: ChatResourcesResponse | null
  workspace: WorkspaceTreeResponse | null
}) {
  const totalResources = getResourceGroups(resources, workspace).reduce(
    (count, group) => count + group.items.length,
    0
  )
  const totalArtifacts = useMemo(() => {
    if (!workspace) return undefined

    const artifactsRoot = findWorkspaceNode(
      workspace.nodes,
      getArtifactsScopePath(workspace.root)
    )
    if (!artifactsRoot?.children?.length) return undefined

    return countWorkspaceFiles(artifactsRoot.children)
  }, [workspace])

  const tabs = useMemo(
    () => [
      {
        id: "resources" as const,
        title: "Pi Resources",
        ariaLabel: "Pi Resources",
        badge: totalResources,
        icon: Library,
      },
      {
        id: "workspace" as const,
        title: "Workspace",
        ariaLabel: "Workspace",
        icon: Folder,
      },
      {
        id: "artifacts" as const,
        title: "Artifacts",
        ariaLabel: "Workspace artifacts",
        badge: totalArtifacts,
        icon: Package,
      },
    ],
    [totalArtifacts, totalResources]
  )

  const selectedIndex = tabs.findIndex((tab) => tab.id === activePanel)

  return (
    <TabsSubtle
      activeLabel
      variant="pill"
      className="flex items-center"
      data-testid="right-panel-inline-launcher"
      idPrefix="right-panel"
      selectedIndex={selectedIndex}
      onSelect={(index) => {
        const next = tabs.at(index)?.id
        if (!next) return
        onPanelChange(next === activePanel ? null : next)
      }}
    >
      {tabs.map((tab, index) => (
        <TabsSubtleItem
          key={tab.id}
          index={index}
          icon={tab.icon}
          label={tab.title}
          badge={tab.badge}
          aria-label={tab.ariaLabel}
        />
      ))}
    </TabsSubtle>
  )
}

export function MobilePanel({
  children,
  dataTestid,
  headerActions,
  icon: Icon,
  onClose,
  open,
  title,
}: {
  children: ReactNode
  dataTestid?: string
  headerActions?: ReactNode
  icon?: React.ElementType
  onClose?: () => void
  open: boolean
  title?: string
}) {
  const panelRef = useRef<HTMLDialogElement>(null)
  const panelTitleId = useId()

  // Light dismiss — the full-viewport ::backdrop region maps clicks onto the
  // dialog element, matching the previous bottom sheet-style backdrop button.
  const onLightDismiss = useEffectEvent((event: MouseEvent) => {
    if (panelRef.current && event.target === panelRef.current) onClose?.()
  })

  useEffect(() => {
    if (!open) return
    const dialog = panelRef.current
    if (!dialog) return
    const handler = (event: MouseEvent) => onLightDismiss(event)
    dialog.addEventListener("click", handler)
    return () => dialog.removeEventListener("click", handler)
  }, [open])

  useEffect(() => {
    if (open) {
      panelRef.current?.showModal()
      panelRef.current?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={panelRef}
      data-testid={dataTestid}
      className={`fixed top-[var(--chat-chrome-top)] right-3 bottom-3 m-0 ${PANEL_OVERLAY_CLASS} backdrop:bg-black/20 ${DESKTOP_PANEL_ONLY}`}
      aria-labelledby={panelTitleId}
      onClose={() => onClose?.()}
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
        <span id={panelTitleId} className="sr-only">
          {title ?? "Panel"}
        </span>
        {title && (
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3">
            <div className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-foreground/80">
              {Icon && <Icon className="size-3.5 shrink-0" />}
              <span className="truncate">{title}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className={`${HIT_AREA_EXPAND_CLASS} inline-flex h-7 w-7 items-center justify-center rounded-sm text-foreground/40 transition-[background-color,color,transform] duration-150 hover:bg-foreground/6 hover:text-foreground/70 active:scale-[0.96]`}
                  aria-label="Close panel"
                  title="Close panel"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {children}
        </div>
      </div>
    </dialog>
  )
}
