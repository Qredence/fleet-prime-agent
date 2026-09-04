import { lazy, Suspense } from "react"
import { Activity, Bot, Folder, Library, Package, SquareTerminal } from "lucide-react"
import { Skeleton } from "../../../ui/skeleton"
import {
  useChatPanelDataContext,
  useWorkspaceTreeContext,
} from "./right-panel-context"
import type { ComponentType, ElementType } from "react"
import type { RightPanel } from "../../../../lib/canvas-utils"

export type ActiveRightPanel = Exclude<RightPanel, null>
export type RightPanelBadgeSource = "resources" | "artifacts" | "repl"
export type RightPanelLoadingSource = "resources" | "workspace"

export type RightPanelDefinition = {
  id: ActiveRightPanel
  order: number
  title: string
  ariaLabel: string
  commandLabel: string
  commandKeywords: Array<string>
  icon: ElementType
  dataTestid: string
  mobileDataTestid: string
  showInLauncher?: boolean
  badgeSource?: RightPanelBadgeSource
  loadingSource?: RightPanelLoadingSource
  refreshSource?: RightPanelLoadingSource
  component: ComponentType
}

const LazyArtifactsPanel = lazy(() =>
  import("../pi/artifacts-panel").then(({ ArtifactsPanelContent }) => ({
    default: ArtifactsPanelContent,
  }))
)
const LazyResourcesPanel = lazy(() =>
  import("../pi/resources-panel").then(({ ResourcesPanelContent }) => ({
    default: ResourcesPanelContent,
  }))
)
const LazySessionInsightsPanel = lazy(() =>
  import("../pi/session-insights-panel").then(({ SessionInsightsPanel }) => ({
    default: SessionInsightsPanel,
  }))
)
const LazyReplPanel = lazy(() =>
  import("../pi/repl-panel").then(({ ReplPanelContent }) => ({
    default: ReplPanelContent,
  }))
)
const LazySubagentsPanel = lazy(() =>
  import("../pi/subagents-panel").then(({ SubagentsPanelContent }) => ({
    default: SubagentsPanelContent,
  }))
)
const LazyWorkspacePanel = lazy(() =>
  import("../pi/workspace-panel").then(({ WorkspacePanelContent }) => ({
    default: WorkspacePanelContent,
  }))
)

function PanelFallback() {
  return (
    <div className="flex min-h-32 flex-col gap-3 p-4" aria-label="Loading panel">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-20 w-full" />
    </div>
  )
}

function SessionInsightsContent() {
  const data = useChatPanelDataContext()
  return (
    <Suspense fallback={<PanelFallback />}>
      <LazySessionInsightsPanel
        activityLabel={data.activityLabel}
        artifactRuns={data.artifactRuns}
        chatMode={data.chatMode}
        messages={data.messages}
        planLabel={data.planLabel}
        presentation={data.presentation}
        queue={data.queue}
        selectedModelKey={data.selectedModelKey}
        sessionId={data.sessionId}
        status={data.status}
        thinkingLevel={data.thinkingLevel}
      />
    </Suspense>
  )
}

function ResourcesContent() {
  const data = useChatPanelDataContext()
  const workspace = useWorkspaceTreeContext()
  return (
    <Suspense fallback={<PanelFallback />}>
      <LazyResourcesPanel
        error={data.resourcesError}
        loading={data.resourcesLoading}
        resources={data.resources}
        workspace={workspace.workspaceTree}
      />
    </Suspense>
  )
}

function WorkspaceContent() {
  const workspace = useWorkspaceTreeContext()
  return (
    <Suspense fallback={<PanelFallback />}>
      <LazyWorkspacePanel
        error={workspace.workspaceError}
        loadWorkspaceFile={workspace.loadWorkspaceFile}
        loading={workspace.workspaceLoading}
        onSelectedPathChange={workspace.setSelectedWorkspacePath}
        selectedPath={workspace.selectedWorkspacePath}
        workspace={workspace.workspaceTree}
      />
    </Suspense>
  )
}

function ArtifactsContent() {
  const data = useChatPanelDataContext()
  return (
    <Suspense fallback={<PanelFallback />}>
      <LazyArtifactsPanel
        artifactRuns={data.artifactRuns}
        messages={data.messages}
        onOpenUIAction={data.onOpenUIAction}
        selectedArtifactId={data.selectedArtifactId}
        status={data.status}
      />
    </Suspense>
  )
}

/**
 * Renders the REPL panel with current artifact run data and selection.
 *
 * @returns The REPL panel content
 */
function ReplContent() {
  const data = useChatPanelDataContext()
  return (
    <Suspense fallback={<PanelFallback />}>
      <LazyReplPanel artifactRuns={data.artifactRuns} selectedArtifactId={data.selectedArtifactId} />
    </Suspense>
  )
}

/**
 * Renders the subagents panel with the current session's agent data.
 */
function SubagentsContent() {
  const data = useChatPanelDataContext()
  return (
    <Suspense fallback={<PanelFallback />}>
      <LazySubagentsPanel
        agents={data.presentation.rlmChildren}
        loadSession={data.loadSubagentSession}
        onOpenTab={data.onOpenSubagentTab}
        parentSessionId={data.sessionId}
        tree={data.presentation.rlmTree}
      />
    </Suspense>
  )
}

export const RIGHT_PANEL_REGISTRY = {
  resources: {
    id: "resources",
    order: 0,
    title: "Resources",
    ariaLabel: "Resources",
    commandLabel: "Open Resources",
    commandKeywords: ["resources", "skills", "panels"],
    icon: Library,
    dataTestid: "pi-resources-canvas",
    mobileDataTestid: "pi-resources-mobile-panel",
    showInLauncher: true,
    badgeSource: "resources",
    loadingSource: "resources",
    refreshSource: "resources",
    component: ResourcesContent,
  },
  workspace: {
    id: "workspace",
    order: 1,
    title: "Workspace",
    ariaLabel: "Workspace",
    commandLabel: "Open Workspace",
    commandKeywords: ["workspace", "files", "panels"],
    icon: Folder,
    dataTestid: "pi-workspace-canvas",
    mobileDataTestid: "pi-workspace-mobile-panel",
    showInLauncher: true,
    badgeSource: undefined,
    loadingSource: "workspace",
    refreshSource: "workspace",
    component: WorkspaceContent,
  },
  artifacts: {
    id: "artifacts",
    order: 2,
    title: "Artifacts",
    ariaLabel: "Artifacts",
    commandLabel: "Open Artifacts",
    commandKeywords: ["artifacts", "reports", "datasets", "panels"],
    icon: Package,
    dataTestid: "pi-artifacts-canvas",
    mobileDataTestid: "pi-artifacts-mobile-panel",
    showInLauncher: true,
    badgeSource: "artifacts",
    loadingSource: undefined,
    refreshSource: undefined,
    component: ArtifactsContent,
  },
  repl: {
    id: "repl",
    order: 3,
    title: "REPL",
    ariaLabel: "REPL runs",
    commandLabel: "Open REPL",
    commandKeywords: ["repl", "ipython", "python", "cells", "panels"],
    icon: SquareTerminal,
    dataTestid: "pi-repl-canvas",
    mobileDataTestid: "pi-repl-mobile-panel",
    showInLauncher: true,
    badgeSource: "repl",
    loadingSource: undefined,
    refreshSource: undefined,
    component: ReplContent,
  },
  subagents: {
    id: "subagents",
    order: 4,
    title: "Subagents",
    ariaLabel: "Subagents",
    commandLabel: "Open Subagents",
    commandKeywords: ["subagents", "agents", "threads", "delegation", "panels"],
    icon: Bot,
    dataTestid: "pi-subagents-canvas",
    mobileDataTestid: "pi-subagents-mobile-panel",
    showInLauncher: false,
    badgeSource: undefined,
    loadingSource: undefined,
    refreshSource: undefined,
    component: SubagentsContent,
  },
  "session-insights": {
    id: "session-insights",
    order: 5,
    title: "Session insights",
    ariaLabel: "Session insights",
    commandLabel: "Open Session Insights",
    commandKeywords: ["session", "insights", "activity", "panels"],
    icon: Activity,
    dataTestid: "pi-session-insights-canvas",
    mobileDataTestid: "pi-session-insights-mobile-panel",
    showInLauncher: true,
    badgeSource: undefined,
    loadingSource: undefined,
    refreshSource: undefined,
    component: SessionInsightsContent,
  },
} satisfies Record<ActiveRightPanel, RightPanelDefinition>

export const RIGHT_PANEL_DEFINITIONS = Object.values(RIGHT_PANEL_REGISTRY).sort(
  (left, right) => left.order - right.order
)

export const RIGHT_PANEL_LAUNCHER_DEFINITIONS = RIGHT_PANEL_DEFINITIONS.filter(
  (definition) => definition.showInLauncher !== false
)

/**
 * Retrieves the registry definition for a right panel.
 *
 * @param panel - The active right panel identifier
 * @returns The definition associated with `panel`
 */
export function getRightPanelDefinition(panel: ActiveRightPanel) {
  return RIGHT_PANEL_REGISTRY[panel]
}
