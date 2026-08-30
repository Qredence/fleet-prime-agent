import { PanelRight, X } from "lucide-react"
import { useEffect, useEffectEvent, useId, useMemo, useRef } from "react"
import { TabsSubtle, TabsSubtleItem } from "../../tabs-subtle"
import {
  CHAT_PANEL_BREAKPOINT_PX,
  DESKTOP_PANEL_ONLY,
} from "../../../../lib/layout-constants"
import {
  useChatPanelDataContext,
  useWorkspaceTreeContext,
} from "../layout/right-panel-context"
import { RIGHT_PANEL_DEFINITIONS } from "../layout/right-panel-registry"
import { ChromePillButton } from "../primitives/chrome-pill"
import { Button } from "../../../ui/button"
import { HIT_AREA_EXPAND_CLASS, PANEL_OVERLAY_CLASS } from "../styles/tokens"
import { collectSessionOpenUIBlocks, getArtifactsScopePath } from "./artifacts-utils"
import {
  countWorkspaceFiles,
  findWorkspaceNode,
  getResourceGroups,
} from "./shared"
import type { ReactNode } from "react"
import type { RightPanel } from "../../../../lib/canvas-utils"
import type {
  ChatResourcesResponse,
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"
/** Reads panel state from RightPanelProvider — no prop threading from route. */
export function RightPanelLauncherFromContext() {
  const { reopenRightPanel, rightPanel } = useChatPanelDataContext()

  return (
    <>
      <div className="min-[960px]:hidden">
        <RightPanelTabsFromContext idPrefix="right-panel-mobile" />
      </div>
      <div className="hidden min-[960px]:block">
        {rightPanel === null ? (
          <RightPanelTrigger onOpen={reopenRightPanel} />
        ) : null}
      </div>
    </>
  )
}

export function RightPanelTabsFromContext({
  idPrefix = "right-panel",
}: {
  idPrefix?: string
}) {
  const { artifactRuns, messages, rightPanel, setRightPanel, resources } =
    useChatPanelDataContext()
  const { workspaceTree } = useWorkspaceTreeContext()

  return (
    <RightPanelLauncher
      activePanel={rightPanel}
      onPanelChange={setRightPanel}
      resources={resources}
      sessionBlocks={collectSessionOpenUIBlocks(messages).length}
      technicalArtifacts={artifactRuns.flatMap((run) => run.artifacts).length}
      workspace={workspaceTree}
      idPrefix={idPrefix}
    />
  )
}

export function RightPanelTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <ChromePillButton
      ariaLabel="Open side panel"
      className="size-9 justify-center px-0"
      onClick={onOpen}
    >
      <PanelRight className="size-4" />
    </ChromePillButton>
  )
}

export function RightPanelLauncher({
  activePanel,
  onPanelChange,
  resources,
  sessionBlocks = 0,
  technicalArtifacts = 0,
  workspace,
  idPrefix = "right-panel",
}: {
  activePanel: RightPanel
  idPrefix?: string
  onPanelChange: (panel: RightPanel) => void
  resources: ChatResourcesResponse | null
  /** Generative-UI blocks in the current session — counted alongside workspace files. */
  sessionBlocks?: number
  technicalArtifacts?: number
  workspace: WorkspaceTreeResponse | null
}) {
  const totalResources = getResourceGroups(resources, workspace).reduce(
    (count, group) => count + group.items.length,
    0
  )
  const totalArtifacts = useMemo(() => {
    const files = (() => {
      if (!workspace) return 0

      const artifactsRoot = findWorkspaceNode(
        workspace.nodes,
        getArtifactsScopePath(workspace.root)
      )
      if (!artifactsRoot?.children?.length) return 0

      return countWorkspaceFiles(artifactsRoot.children)
    })()

    const total = files + sessionBlocks + technicalArtifacts
    return total > 0 ? total : undefined
  }, [sessionBlocks, technicalArtifacts, workspace])

  const tabs = useMemo(
    () =>
      RIGHT_PANEL_DEFINITIONS.map((definition) => ({
        ...definition,
        badge:
          definition.badgeSource === "resources"
            ? totalResources || undefined
            : definition.badgeSource === "artifacts"
              ? totalArtifacts
              : undefined,
      })),
    [totalArtifacts, totalResources]
  )

  const selectedIndex = tabs.findIndex((tab) => tab.id === activePanel)

  return (
    <TabsSubtle
      activeLabel
      className="w-fit max-w-full"
      data-testid="right-panel-inline-launcher"
      data-active-panel={activePanel ?? "closed"}
      idPrefix={idPrefix}
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
  // When the desktop ResizableCanvas owns the panel, we must keep this dialog
  // out of the browser top layer. Closing it for that reason must not bubble
  // into the shared `onClose` (which would also dismiss the desktop panel).
  const suppressCloseRef = useRef(false)

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
    const dialog = panelRef.current
    if (!dialog) return

    if (!open) {
      if (dialog.open) {
        suppressCloseRef.current = true
        dialog.close()
        suppressCloseRef.current = false
      }
      return
    }

    const media = window.matchMedia(`(min-width: ${CHAT_PANEL_BREAKPOINT_PX}px)`)

    const syncMode = () => {
      // Desktop (>=960px): ResizableCanvas renders the panel. A CSS-hidden
      // showModal() dialog still occupies the top layer and intercepts clicks
      // on the header tabs / chat chrome — so close it without notifying.
      if (media.matches) {
        if (dialog.open) {
          suppressCloseRef.current = true
          dialog.close()
          // HTMLDialogElement.close() fires the `close` event asynchronously
          // (queued task per the WHATWG spec), so leave the flag set — the
          // onClose handler consumes it to avoid dismissing the desktop panel.
        }
        return
      }
      if (!dialog.open) {
        dialog.showModal()
        dialog.focus()
      }
    }

    syncMode()
    media.addEventListener("change", syncMode)
    return () => media.removeEventListener("change", syncMode)
  }, [open])

  if (!open) return null

  return (
    <dialog
      ref={panelRef}
      data-testid={dataTestid}
      className={`fixed top-[var(--chat-chrome-top)] right-3 bottom-3 m-0 ${PANEL_OVERLAY_CLASS} backdrop:bg-black/20 ${DESKTOP_PANEL_ONLY}`}
      aria-labelledby={panelTitleId}
      onClose={() => {
        if (suppressCloseRef.current) {
          suppressCloseRef.current = false
          return
        }
        onClose?.()
      }}
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
                <Button
                  type="button"
                  onClick={onClose}
                  variant="ghost"
                  size="icon-sm"
                  className={`${HIT_AREA_EXPAND_CLASS} text-foreground/40 hover:text-foreground/70`}
                  aria-label="Close panel"
                  title="Close panel"
                >
                  <X data-icon="inline-start" className="size-3.5" />
                </Button>
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
