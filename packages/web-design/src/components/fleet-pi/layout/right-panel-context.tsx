import { createContext, useContext, useMemo } from "react"
import type { ReactNode } from "react"
import type { RightPanel } from "../../../lib/canvas-utils"
import type { RightPanelContentProps } from "./right-panel-registry"

export type ChatPanelDataContextValue = Pick<
  RightPanelContentProps,
  | "activityLabel"
  | "mode"
  | "models"
  | "planLabel"
  | "queue"
  | "refreshResources"
  | "resources"
  | "resourcesError"
  | "resourcesLoading"
  | "selectedModelKey"
  | "status"
> & {
  rightPanel: RightPanel
  setRightPanel: (panel: RightPanel) => void
}

export type WorkspaceTreeContextValue = Pick<
  RightPanelContentProps,
  | "loadWorkspaceFile"
  | "openWorkspacePath"
  | "refreshWorkspace"
  | "selectedWorkspacePath"
  | "setSelectedWorkspacePath"
  | "workspaceError"
  | "workspaceLoading"
  | "workspaceTree"
>

export type SettingsActionsContextValue = Pick<
  RightPanelContentProps,
  | "isLoadingProviders"
  | "isUpdatingProvider"
  | "modelCatalog"
  | "onDiscoverModels"
  | "onRemoveProvider"
  | "onThemePreferenceChange"
  | "onUpdateProvider"
  | "providers"
  | "saveSettings"
  | "settings"
  | "settingsError"
  | "settingsLoading"
  | "themePreference"
>

export type RightPanelContextValue = ChatPanelDataContextValue &
  WorkspaceTreeContextValue &
  SettingsActionsContextValue

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
  settingsActions,
  workspaceTree,
}: {
  chatPanelData: ChatPanelDataContextValue
  children: ReactNode
  settingsActions: SettingsActionsContextValue
  workspaceTree: WorkspaceTreeContextValue
}) {
  return (
    <SettingsActionsContext.Provider value={settingsActions}>
      <WorkspaceTreeContext.Provider value={workspaceTree}>
        <ChatPanelDataContext.Provider value={chatPanelData}>
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

/**
 * Compatibility shim for consumers that still need the full merged value.
 * Prefer the narrowed hooks where a consumer only reads one slice.
 */
export function useRightPanelContext(): RightPanelContextValue {
  const chatPanelData = useChatPanelDataContext()
  const workspaceTree = useWorkspaceTreeContext()
  const settingsActions = useSettingsActionsContext()
  return useMemo(
    () => ({ ...chatPanelData, ...workspaceTree, ...settingsActions }),
    [chatPanelData, workspaceTree, settingsActions]
  )
}
