import { Activity, Folder, Library, Package } from "lucide-react"
import { ArtifactsPanelContent } from "../pi/artifacts-panel"

import { ResourcesPanelContent } from "../pi/resources-panel"
import { SessionInsightsPanel } from "../pi/session-insights-panel"
import { WorkspacePanelContent } from "../pi/workspace-panel"
import type { ElementType, ReactNode } from "react"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { RightPanel, ThemePreference } from "../../../lib/canvas-utils"
import type {
	ChatPiSettingsUpdate,
	ChatMode,
  ChatProviderInfo,
  ChatProviderOAuthLoginRequest,
  ChatProviderOAuthLoginResponse,
  ChatProviderRemoveRequest,
  ChatProviderRemoveResponse,
  ChatProviderUpdateRequest,
  ChatProviderUpdateResponse,
	ChatResourcesResponse,
	ChatSettingsResponse,
	ChatThinkingLevel,
	PrimeAgentSessionPresentation,
  QueueState,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
  PrimeAgentArtifactRun,
} from "@prime-agent/web-protocol/chat-protocol"
import type { ChatModelOption } from "../../../lib/pi/chat-helpers"

export type ActiveRightPanel = Exclude<RightPanel, null>

export type RightPanelContentProps = {
	activityLabel?: string
	artifactRuns: Array<PrimeAgentArtifactRun>
	chatMode: ChatMode
	isLoadingProviders?: boolean
	isUpdatingProvider?: boolean
	onOpenUIAction?: (message: string) => void
	/** Current session messages — the artifacts panel derives generative-UI entries from them. */
  messages: Array<ChatMessage>
  models: Array<ChatModelOption>
  /** Full registry catalog for Settings model curation (unfiltered). */
  modelCatalog?: Array<ChatModelOption>
  onDiscoverModels?: (providerId: string) => Promise<Array<ChatModelOption>>
  onOAuthLogin?: (
    request: ChatProviderOAuthLoginRequest
  ) => Promise<ChatProviderOAuthLoginResponse>
  onThemePreferenceChange: (preference: ThemePreference) => void
  onRemoveProvider?: (
    request: ChatProviderRemoveRequest
  ) => Promise<ChatProviderRemoveResponse>
  onUpdateProvider?: (
    request: ChatProviderUpdateRequest
  ) => Promise<ChatProviderUpdateResponse>
  planLabel?: string
  presentation: PrimeAgentSessionPresentation
  providers?: Array<ChatProviderInfo>
  queue: QueueState
  refreshResources: () => void
  refreshWorkspace: () => void
  resources: ChatResourcesResponse | null
  resourcesError: Error | null
  resourcesLoading: boolean
  saveSettings: (
    settings: ChatPiSettingsUpdate
  ) => Promise<ChatSettingsResponse>
  selectedModelKey?: string
	sessionId?: string
  settings: ChatSettingsResponse | null
  settingsError: Error | null
  settingsLoading: boolean
	status: ChatStatus
	selectedArtifactId?: string | null
	thinkingLevel?: ChatThinkingLevel
  themePreference: ThemePreference
  workspaceError: Error | null
  workspaceLoading: boolean
  workspaceTree: WorkspaceTreeResponse | null
  loadWorkspaceFile: (path: string) => Promise<WorkspaceFileResponse>
  openWorkspacePath: (rawPath: string) => void
  selectedWorkspacePath: string | null
  setSelectedWorkspacePath: (path: string | null) => void
}

type RightPanelDefinition = {
  title: string
  icon: ElementType
  dataTestid: string
  mobileDataTestid: string
  getLoading: (props: RightPanelContentProps) => boolean
  getOnRefresh: (props: RightPanelContentProps) => (() => void) | undefined
  render: (props: RightPanelContentProps) => ReactNode
}

export const RIGHT_PANEL_REGISTRY: Record<
  ActiveRightPanel,
  RightPanelDefinition
> = {
  "session-insights": {
    title: "Session insights",
    icon: Activity,
    dataTestid: "pi-session-insights-canvas",
    mobileDataTestid: "pi-session-insights-mobile-panel",
    getLoading: () => false,
    getOnRefresh: () => undefined,
    render: (props) => (
      <SessionInsightsPanel
        activityLabel={props.activityLabel}
        artifactRuns={props.artifactRuns}
        chatMode={props.chatMode}
        messages={props.messages}
        planLabel={props.planLabel}
        presentation={props.presentation}
        queue={props.queue}
        selectedModelKey={props.selectedModelKey}
        sessionId={props.sessionId}
        status={props.status}
        thinkingLevel={props.thinkingLevel}
      />
    ),
  },
  resources: {
    title: "Resources",
    icon: Library,
    dataTestid: "pi-resources-canvas",
    mobileDataTestid: "pi-resources-mobile-panel",
    getLoading: (props) => props.resourcesLoading,
    getOnRefresh: (props) => props.refreshResources,
    render: (props) => (
      <ResourcesPanelContent
        error={props.resourcesError}
        loading={props.resourcesLoading}
        resources={props.resources}
        workspace={props.workspaceTree}
      />
    ),
  },
  workspace: {
    title: "Workspace",
    icon: Folder,
    dataTestid: "pi-workspace-canvas",
    mobileDataTestid: "pi-workspace-mobile-panel",
    getLoading: (props) => props.workspaceLoading,
    getOnRefresh: (props) => props.refreshWorkspace,
    render: (props) => (
      <WorkspacePanelContent
        error={props.workspaceError}
        loadWorkspaceFile={props.loadWorkspaceFile}
        loading={props.workspaceLoading}
        onSelectedPathChange={props.setSelectedWorkspacePath}
        selectedPath={props.selectedWorkspacePath}
        workspace={props.workspaceTree}
      />
    ),
  },
  artifacts: {
    title: "Artifacts",
    icon: Package,
    dataTestid: "pi-artifacts-canvas",
    mobileDataTestid: "pi-artifacts-mobile-panel",
    getLoading: (props) => props.workspaceLoading,
    getOnRefresh: (props) => props.refreshWorkspace,
    render: (props) => (
      <ArtifactsPanelContent
        error={props.workspaceError}
        loadWorkspaceFile={props.loadWorkspaceFile}
        loading={props.workspaceLoading}
        messages={props.messages}
        artifactRuns={props.artifactRuns}
        onOpenUIAction={props.onOpenUIAction}
        onSelectedPathChange={props.setSelectedWorkspacePath}
        selectedPath={props.selectedWorkspacePath}
        status={props.status}
        selectedArtifactId={props.selectedArtifactId}
        workspace={props.workspaceTree}
      />
    ),
  },
}

export function getRightPanelDefinition(panel: ActiveRightPanel) {
  return RIGHT_PANEL_REGISTRY[panel]
}
