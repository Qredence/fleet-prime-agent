import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"
import type { RightPanel } from "../../../../lib/canvas-utils"
import type { ThemePreference } from "../../../../lib/canvas-utils"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { ChatModelOption } from "../../../../lib/pi/chat-helpers"
import type {
  ChatMode,
  ChatPiSettingsUpdate,
  ChatProviderInfo,
  ChatProviderOAuthLoginRequest,
  ChatProviderOAuthLoginResponse,
  ChatProviderRemoveRequest,
  ChatProviderRemoveResponse,
  ChatProviderUpdateRequest,
  ChatProviderUpdateResponse,
  ChatResourcesResponse,
  ChatSessionMetadata,
  ChatSessionResponse,
  ChatSettingsResponse,
  ChatThinkingLevel,
  PrimeAgentArtifactRun,
  PrimeAgentSessionPresentation,
  QueueState,
  WorkspaceFileResponse,
  WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol"

export type ChatPanelDataContextValue = {
  activityLabel?: string
  artifactRuns: Array<PrimeAgentArtifactRun>
  chatMode: ChatMode
  loadSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>
  loadSubagentSession: (
    parentSessionId: string,
    childId: string,
  ) => Promise<ChatSessionResponse>
  messages: Array<ChatMessage>
  models: Array<ChatModelOption>
  onOpenUIAction?: (message: string) => void
  planLabel?: string
  presentation: PrimeAgentSessionPresentation
  queue: QueueState
  refreshResources: () => void
  resources: ChatResourcesResponse | null
  resourcesError: Error | null
  resourcesLoading: boolean
  selectedModelKey?: string
  sessionId?: string
  status: ChatStatus
  selectedArtifactId?: string | null
  thinkingLevel?: ChatThinkingLevel
  reopenRightPanel: () => void
  rightPanel: RightPanel
  setRightPanel: (panel: RightPanel) => void
}

export type WorkspaceTreeContextValue = {
  loadWorkspaceFile: (path: string) => Promise<WorkspaceFileResponse>
  openWorkspacePath: (rawPath: string) => void
  refreshWorkspace: () => void
  selectedWorkspacePath: string | null
  setSelectedWorkspacePath: (path: string | null) => void
  workspaceError: Error | null
  workspaceLoading: boolean
  workspaceTree: WorkspaceTreeResponse | null
}

export type SettingsActionsContextValue = {
  isLoadingProviders?: boolean
  isUpdatingProvider?: boolean
  modelCatalog?: Array<ChatModelOption>
  onDiscoverModels?: (providerId: string) => Promise<Array<ChatModelOption>>
  onOAuthLogin?: (
    request: ChatProviderOAuthLoginRequest
  ) => Promise<ChatProviderOAuthLoginResponse>
  onRemoveProvider?: (
    request: ChatProviderRemoveRequest
  ) => Promise<ChatProviderRemoveResponse>
  onThemePreferenceChange: (preference: ThemePreference) => void
  onUpdateProvider?: (
    request: ChatProviderUpdateRequest
  ) => Promise<ChatProviderUpdateResponse>
  providers?: Array<ChatProviderInfo>
  saveSettings: (settings: ChatPiSettingsUpdate) => Promise<ChatSettingsResponse>
  settings: ChatSettingsResponse | null
  settingsError: Error | null
  settingsLoading: boolean
  themePreference: ThemePreference
}

const ChatPanelDataContext = createContext<ChatPanelDataContextValue | null>(
  null
)
const WorkspaceTreeContext = createContext<WorkspaceTreeContextValue | null>(
  null
)
const SettingsActionsContext =
  createContext<SettingsActionsContextValue | null>(null)

export function RightPanelProvider({
  chatPanelData,
  children,
  onOpenUIAction,
  settingsActions,
  workspaceTree,
}: {
  chatPanelData: ChatPanelDataContextValue
  children: ReactNode
  onOpenUIAction?: (message: string) => void
  settingsActions: SettingsActionsContextValue
  workspaceTree: WorkspaceTreeContextValue
}) {
  const chatPanelDataValue = useMemo(
    () => ({ ...chatPanelData, onOpenUIAction }),
    [chatPanelData, onOpenUIAction],
  )

  return (
    <SettingsActionsContext.Provider value={settingsActions}>
      <WorkspaceTreeContext.Provider value={workspaceTree}>
        <ChatPanelDataContext.Provider value={chatPanelDataValue}>
          {children}
        </ChatPanelDataContext.Provider>
      </WorkspaceTreeContext.Provider>
    </SettingsActionsContext.Provider>
  )
}

export function useChatPanelDataContext() {
  const context = useContext(ChatPanelDataContext)
  if (!context) {
    throw new Error(
      "useChatPanelDataContext must be used within RightPanelProvider"
    )
  }
  return context
}

export function useWorkspaceTreeContext() {
  const context = useContext(WorkspaceTreeContext)
  if (!context) {
    throw new Error(
      "useWorkspaceTreeContext must be used within RightPanelProvider"
    )
  }
  return context
}

export function useSettingsActionsContext() {
  const context = useContext(SettingsActionsContext)
  if (!context) {
    throw new Error(
      "useSettingsActionsContext must be used within RightPanelProvider"
    )
  }
  return context
}
