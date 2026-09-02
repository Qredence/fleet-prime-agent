import { PanelRight, X } from "lucide-react"
import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
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
import { Select, type SelectOption } from "../../../ui/select"
import { HIT_AREA_EXPAND_CLASS, PANEL_OVERLAY_CLASS } from "../styles/tokens"
import { collectSessionOpenUIBlocks } from "./artifacts-utils"
import { getResourceGroups } from "./resource-helpers"
import type { HTMLAttributes, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
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

/**
 * Renders the right-panel launcher using state and data from application contexts.
 *
 * @param idPrefix - Prefix used for generated right-panel element IDs
 * @returns The right-panel launcher
 */
export function RightPanelTabsFromContext({
  idPrefix = "right-panel",
}: {
  idPrefix?: string
}) {
  const {
    artifactRuns,
    messages,
    presentation,
    rightPanel,
    setRightPanel,
    resources,
  } =
    useChatPanelDataContext()
  const { workspaceTree } = useWorkspaceTreeContext()

  return (
    <RightPanelLauncher
      activePanel={rightPanel}
      onPanelChange={setRightPanel}
      resources={resources}
      replRuns={artifactRuns
        .flatMap((run) => run.artifacts)
        .filter((artifact) => artifact.kind === "ipython").length}
      sessionBlocks={collectSessionOpenUIBlocks(messages).length}
      subagents={presentation.rlmChildren.length}
      openUIArtifacts={artifactRuns
        .flatMap((run) => run.artifacts)
        .filter((artifact) => artifact.kind === "openui-html").length}
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

/**
 * Renders the responsive launcher for switching between right-panel views.
 *
 * @param activePanel - The currently active panel, or `null` when all panels are closed
 * @param onPanelChange - Called when a panel is opened, switched, or closed
 * @param resources - Resources used to calculate the resources badge count
 * @param replRuns - Number of REPL runs to show in the corresponding badge
 * @param sessionBlocks - Number of generative UI blocks in the current session
 * @param subagents - Number of subagents to show in the corresponding badge
 * @param openUIArtifacts - Number of open generative UI artifacts
 * @param workspace - Workspace data used to calculate the resources badge count
 * @param idPrefix - Prefix used for the launcher's element IDs
 */
export function RightPanelLauncher({
  activePanel,
  onPanelChange,
  resources,
  replRuns = 0,
  sessionBlocks = 0,
  subagents = 0,
  openUIArtifacts = 0,
  workspace,
  idPrefix = "right-panel",
}: {
  activePanel: RightPanel
  idPrefix?: string
  onPanelChange: (panel: RightPanel) => void
  resources: ChatResourcesResponse | null
  replRuns?: number
  /** Generative-UI blocks in the current session. */
  sessionBlocks?: number
  subagents?: number
  openUIArtifacts?: number
  workspace: WorkspaceTreeResponse | null
}) {
  const totalResources = getResourceGroups(resources, workspace).reduce(
    (count, group) => count + group.items.length,
    0
  )
  const totalArtifacts = useMemo(() => {
    const total = sessionBlocks + openUIArtifacts
    return total > 0 ? total : undefined
  }, [openUIArtifacts, sessionBlocks])

  const tabs = useMemo(
    () =>
      RIGHT_PANEL_DEFINITIONS.map((definition) => ({
        ...definition,
        badge:
          definition.badgeSource === "resources"
            ? totalResources || undefined
            : definition.badgeSource === "artifacts"
              ? totalArtifacts
              : definition.badgeSource === "repl"
                ? replRuns || undefined
                : definition.badgeSource === "subagents"
                  ? subagents || undefined
              : undefined,
      })),
    [replRuns, subagents, totalArtifacts, totalResources]
  )

  const selectedIndex = tabs.findIndex((tab) => tab.id === activePanel)
  const panelOptions = useMemo<Array<SelectOption>>(
    () =>
      tabs.map((tab) => ({
        value: tab.id,
        label: tab.title,
        icon: tab.icon as LucideIcon,
      })),
    [tabs],
  )

  return (
    <ResponsivePanelLauncher
      data-testid="right-panel-inline-launcher"
      data-active-panel={activePanel ?? "closed"}
      activePanel={activePanel}
      options={panelOptions}
      panelOptions={tabs}
      idPrefix={idPrefix}
      selectedIndex={selectedIndex}
      onSelect={(index) => {
        const next = tabs.at(index)?.id
        if (!next) return
        onPanelChange(next === activePanel ? null : next)
      }}
    />
  )
}

type PanelLauncherTab = (typeof RIGHT_PANEL_DEFINITIONS)[number] & {
  badge?: number
}

type ResponsivePanelLauncherProps = Omit<HTMLAttributes<HTMLDivElement>, "className" | "onSelect"> & {
  activePanel: RightPanel
  className?: string
  idPrefix: string
  onSelect: (index: number) => void
  options: Array<SelectOption>
  panelOptions: Array<PanelLauncherTab>
  selectedIndex: number
}

/**
 * Renders panel navigation as tabs or a dropdown based on the available width.
 *
 * @returns The responsive panel launcher.
 */
function ResponsivePanelLauncher({
  activePanel,
  className,
  idPrefix,
  onSelect,
  options,
  panelOptions,
  selectedIndex,
  ...props
}: ResponsivePanelLauncherProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const [isDropdown, setIsDropdown] = useState(false)

  const measure = useCallback(() => {
    const container = containerRef.current
    const measurement = measurementRef.current
    if (!container || !measurement) return

    const availableWidth = container.parentElement?.clientWidth ?? container.clientWidth
    const requiredWidth = measurement.getBoundingClientRect().width
    setIsDropdown(requiredWidth > availableWidth + 1)
  }, [])

  useLayoutEffect(() => {
    measure()
    const container = containerRef.current
    const measurement = measurementRef.current
    if (!container || !measurement || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(measure)
    if (container.parentElement) observer.observe(container.parentElement)
    observer.observe(container)
    observer.observe(measurement)
    return () => observer.disconnect()
  }, [measure, panelOptions, selectedIndex])

  const selectPanel = useCallback(
    (nextPanel: string) => {
      const nextIndex = panelOptions.findIndex((panel) => panel.id === nextPanel)
      if (nextIndex >= 0) onSelect(nextIndex)
    },
    [onSelect, panelOptions],
  )

  return (
    <div
      ref={containerRef}
      className={`relative ${isDropdown ? "w-full" : "w-fit"} min-w-0 max-w-full overflow-hidden ${className ?? ""}`}
      data-panel-launcher-mode={isDropdown ? "dropdown" : "tabs"}
      {...props}
    >
      {isDropdown ? (
        <Select
          aria-label="Select panel"
          className="w-full min-w-0 max-w-full rounded-full border-border/70 bg-sidebar"
          onValueChange={selectPanel}
          options={options}
          placeholder="Open panel"
          value={activePanel}
        />
      ) : (
        <TabsSubtle
          activeLabel
          className="w-fit max-w-full"
          idPrefix={idPrefix}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
        >
          {panelOptions.map((panel, index) => (
            <TabsSubtleItem
              key={panel.id}
              index={index}
              icon={panel.icon}
              label={panel.title}
              badge={panel.badge}
              aria-label={panel.ariaLabel}
            />
          ))}
        </TabsSubtle>
      )}
      <div
        ref={measurementRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 -z-10 h-0 w-max max-w-none overflow-hidden"
        data-panel-launcher-measurement
        inert
      >
        <TabsSubtle
          activeLabel
          className="w-max max-w-none"
          idPrefix={`${idPrefix}-measurement`}
          selectedIndex={selectedIndex}
          onSelect={() => undefined}
        >
          {panelOptions.map((panel, index) => (
            <TabsSubtleItem
              key={panel.id}
              index={index}
              icon={panel.icon}
              label={panel.title}
              badge={panel.badge}
              aria-label={panel.ariaLabel}
            />
          ))}
        </TabsSubtle>
      </div>
    </div>
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
