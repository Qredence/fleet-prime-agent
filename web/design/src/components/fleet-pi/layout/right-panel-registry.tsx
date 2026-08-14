import { Folder, Library, Package } from "lucide-react"
import { ArtifactsPanelContent } from "../pi/artifacts-panel"

import { ResourcesPanelContent } from "../pi/resources-panel"
import { WorkspacePanelContent } from "../pi/workspace-panel"
import type { ElementType, ReactNode } from "react"
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { RightPanel, ThemePreference } from "../../../lib/canvas-utils"
import type {
  ChatPiSettingsUpdate,
  ChatProviderInfo,
  ChatProviderOAuthLoginRequest,
  ChatProviderOAuthLoginResponse,
  ChatProviderRemoveRequest,
  ChatProviderRemoveResponse,
  ChatProviderUpdateRequest,
  ChatProviderUpdateResponse,
  ChatResourcesResponse,
  ChatSettingsResponse,
  QueueState,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"
import type { ChatModelOption } from "../../../lib/pi/chat-helpers"

export type ActiveRightPanel = Exclude<RightPanel, null>

export type RightPanelContentProps = {
  activityLabel?: string
  isLoadingProviders?: boolean
  isUpdatingProvider?: boolean
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
  settings: ChatSettingsResponse | null
  settingsError: Error | null
  settingsLoading: boolean
  status: ChatStatus
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
  resources: {
    title: "Pi Resources",
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
        onSelectedPathChange={props.setSelectedWorkspacePath}
        selectedPath={props.selectedWorkspacePath}
        workspace={props.workspaceTree}
      />
    ),
  },
}

export function getRightPanelDefinition(panel: ActiveRightPanel) {
  return RIGHT_PANEL_REGISTRY[panel]
}
