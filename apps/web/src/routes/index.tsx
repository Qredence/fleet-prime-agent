import { createFileRoute } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ChatCommandPalette } from "@prime-agent/web-design/components/fleet-pi/chat-command-palette"
import { UiErrorBoundary } from "@prime-agent/web-design/components/fleet-pi/ui-error-boundary"
import { RightPanelShell } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-shell"
import { RightPanelProvider } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-context"
import { ChatWorkspaceLayout } from "@prime-agent/web-design/components/fleet-pi/layout/chat-workspace-layout"
import { SettingsDialog } from "@prime-agent/web-design/components/fleet-pi/pi/settings-dialog"
import {
  queueLabel,
  toModelOption,
} from "@prime-agent/web-design/lib/pi/chat-helpers"
import type {
  ChatPiSettingsUpdate,
  ChatSettingsResponse,
} from "@prime-agent/web-protocol/chat-protocol"
import type { ChatModelOption } from "@prime-agent/web-design/lib/pi/chat-helpers"
import type { SettingsSlashTab } from "@/lib/pi/slash-commands"
import { useChatWorkspaceHeader } from "@/lib/pi/use-chat-workspace-header"
import { ChatPanel } from "@/lib/pi/chat-panel"
import { useLocalSlashActions } from "@/lib/pi/use-local-slash-actions"
import { assistantMessageHasPendingQuestion } from "@/lib/pi/question-pending"
import { usePiChat } from "@/lib/pi/use-pi-chat"
import { useOptionalUser } from "@/lib/auth-stub"
import { identifyAnalyticsUser } from "@/lib/analytics-stub"
import { useQueryClient } from "@tanstack/react-query"
import {
  invalidateWorkspaceScopedQueries,
  useChatCommands,
  useChatModelCatalog,
  useChatModels,
  useChatProviders,
  useChatResources,
  useChatSettings,
  useDiscoverChatModels,
  useRemoveChatProvider,
  useUpdateChatProvider,
  useUpdateChatSettings,
  useWorkspaceTree,
} from "@/lib/pi/chat-queries"
import { buildSlashCommands } from "@/lib/pi/slash-commands"
import { useResourceInstallRefresh } from "@/lib/pi/use-resource-install-refresh"
import { useChatShellState } from "@/lib/pi/use-chat-shell-state"
import { useRightPanelContextValue } from "@/lib/pi/use-right-panel-context-value"
import {
  useActiveSessionLabel,
  useChatSuggestions,
} from "@/lib/pi/use-chat-view"
import { usePendingQuestionBar } from "@/lib/pi/use-pending-question-bar"
import { loadWorkspaceFile } from "@/lib/workspace-file"
import { chatClient } from "@/lib/pi/chat-client"

export const Route = createFileRoute("/")({ component: Chat })

function resolveSavedModelKey(
  models: Array<ChatModelOption>,
  response: ChatSettingsResponse
): string | undefined {
  const { defaultProvider, defaultModel } = response.effective
  return (
    models.find(
      (model) =>
        model.provider === defaultProvider && model.modelId === defaultModel
    )?.id ??
    (defaultProvider && defaultModel
      ? `${defaultProvider}/${defaultModel}`
      : undefined)
  )
}

function ChatWorkspaceShell() {
  const user = useOptionalUser()
  const queryClient = useQueryClient()
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<
    SettingsSlashTab | undefined
  >(undefined)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)

  useEffect(() => {
    if (user) identifyAnalyticsUser(user)
  }, [user])
  const { data: providersData, isLoading: isLoadingProviders } =
    useChatProviders()
  const { mutateAsync: onUpdateProvider, isPending: isUpdatingProvider } =
    useUpdateChatProvider()
  const { mutateAsync: onRemoveProvider, isPending: isRemovingProvider } =
    useRemoveChatProvider()
  const { data: modelsData } = useChatModels()
  const { data: modelCatalogData } = useChatModelCatalog({
    enabled: settingsDialogOpen,
  })
  const discoverModelsMutation = useDiscoverChatModels()
  const {
    commandPaletteOpen,
    handleResourceCanvasResizeStart,
    handleThemePreferenceChange,
    initialSessionMetadata,
    modelKey,
    modelSelection,
    models,
    openWorkspacePath,
    persistSession,
    resourceCanvasWidth,
    rightPanel,
    selectedWorkspacePath,
    setCommandPaletteOpen,
    setModelKey,
    setRightPanel,
    setSelectedWorkspacePath,
    themePreference,
  } = useChatShellState(modelsData)

  const {
    data: resourcesData,
    isLoading: resourcesLoading,
    error: resourcesError,
    refetch: refetchResources,
  } = useChatResources()
  const { data: commandsData } = useChatCommands()
  const {
    data: settingsData,
    isLoading: settingsLoading,
    error: settingsError,
  } = useChatSettings()
  const updateSettings = useUpdateChatSettings()
  const shouldLoadWorkspaceTree =
    rightPanel === "resources" ||
    rightPanel === "workspace" ||
    rightPanel === "artifacts"
  const {
    data: workspaceData,
    isLoading: workspaceLoading,
    error: workspaceError,
    refetch: refetchWorkspace,
  } = useWorkspaceTree({ enabled: shouldLoadWorkspaceTree })

  const resources = resourcesData ?? null
  const workspaceTree = workspaceData ?? null

  const refreshResources = useCallback(() => {
    void refetchResources()
  }, [refetchResources])

  const saveSettings = useCallback(
    async (settings: ChatPiSettingsUpdate) => {
      const response = await updateSettings.mutateAsync({ settings })
      const nextModelKey = resolveSavedModelKey(models, response)
      if (nextModelKey) setModelKey(nextModelKey)
      return response
    },
    [models, setModelKey, updateSettings]
  )

  const refreshWorkspace = useCallback(() => {
    void refetchWorkspace()
  }, [refetchWorkspace])

  const browseWorkspace = useCallback(async (path?: string) => {
    return chatClient.browseWorkspace(path)
  }, [])

  const setWorkspaceRoot = useCallback(
    async (path: string) => {
      await chatClient.setWorkspaceRoot(path)
      setSelectedWorkspacePath(null)
      invalidateWorkspaceScopedQueries(queryClient)
      await refetchWorkspace()
    },
    [queryClient, refetchWorkspace, setSelectedWorkspacePath]
  )

  const {
    activityLabel,
    answerQuestion,
    appendLocalMessage,
    error,
    messages,
    planLabel,
    queue,
    resumeSession,
    sendMessage,
    sessionMetadata,
    sessions,
    startNewSession,
    status,
    stop,
  } = usePiChat(modelSelection, {
    initialSessionMetadata,
    persistSession,
  })

  useResourceInstallRefresh({
    messages,
    refreshResources,
    refreshWorkspace,
    sessionId: sessionMetadata.sessionId,
    shouldLoadWorkspaceTree,
    workspaceTree,
  })

  const infoDescription = queueLabel(queue) ?? activityLabel ?? planLabel
  const pendingQuestionBar = usePendingQuestionBar({
    messages,
    answerQuestion: ({ toolCallId, answer }) => {
      void answerQuestion({ toolCallId, answer }).catch(() => undefined)
    },
  })
  const activeSessionLabel = useActiveSessionLabel({
    activeSessionId: sessionMetadata.sessionId,
    messages,
    sessions,
  })
  const suggestions = useChatSuggestions({
    messages,
    resources,
    workspaceTree,
  })
  const shouldShowInputSuggestions = useMemo(() => {
    if (messages.length === 0) return false
    if (status === "streaming" || status === "submitted") return false

    const lastMessage = messages[messages.length - 1]
    if (lastMessage.role !== "assistant") return false

    return !assistantMessageHasPendingQuestion(lastMessage)
  }, [messages, status])
  const inputSuggestionItems = useMemo(
    () => (shouldShowInputSuggestions ? suggestions : []),
    [shouldShowInputSuggestions, suggestions]
  )
  const slashCommands = useMemo(
    () =>
      buildSlashCommands(
        resources,
        settingsData?.effective.enableSkillCommands ?? false,
        commandsData
      ),
    [commandsData, resources, settingsData]
  )

  const openSettings = useCallback((tab?: SettingsSlashTab) => {
    setSettingsInitialTab(tab)
    setSettingsDialogOpen(true)
  }, [])

  const { handleLocalSlashSubmit, handleSlashCommandSelect } =
    useLocalSlashActions({
      appendLocalMessage,
      models,
      openSettings,
      sessionId: sessionMetadata.sessionId,
      sessionFile: sessionMetadata.sessionFile,
      setModelKey,
      setModelPickerOpen,
      startNewSession,
    })

  const modelCatalog = useMemo(
    () => modelCatalogData?.models.map(toModelOption) ?? models,
    [modelCatalogData, models]
  )

  const onDiscoverModels = useCallback(
    async (providerId: string) => {
      const response = await discoverModelsMutation.mutateAsync(providerId)
      return response.models.map(toModelOption)
    },
    [discoverModelsMutation]
  )

  const { chatPanelData, settingsActions, workspaceTreeContext } =
    useRightPanelContextValue({
      activityLabel,
      browseWorkspace,
      handleThemePreferenceChange,
      isLoadingProviders,
      isUpdatingProvider: isUpdatingProvider || isRemovingProvider,
      loadWorkspaceFile,
      modelKey,
      models,
      modelCatalog,
      onDiscoverModels,
      onRemoveProvider,
      onUpdateProvider,
      openWorkspacePath,
      planLabel,
      providers: providersData?.providers ?? [],
      queue,
      refreshResources,
      refreshWorkspace,
      resources,
      resourcesError,
      resourcesLoading,
      rightPanel,
      saveSettings,
      selectedWorkspacePath,
      setRightPanel,
      setSelectedWorkspacePath,
      setWorkspaceRoot,
      settings: settingsData ?? null,
      settingsError,
      settingsLoading: settingsLoading || updateSettings.isPending,
      status,
      themePreference,
      workspaceError,
      workspaceLoading,
      workspaceTree,
    })

  const header = useChatWorkspaceHeader({
    activeSessionId: sessionMetadata.sessionId,
    activeSessionLabel,
    sessions,
    onNewSession: () => void startNewSession(),
    onResumeSession: (metadata) => void resumeSession(metadata),
    onOpenSettings: () => openSettings(),
  })

  return (
    <>
      <ChatCommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onNewSession={() => void startNewSession()}
        onStop={stop}
        onResumeSession={(session) =>
          void resumeSession({
            sessionFile: session.path,
            sessionId: session.id,
          })
        }
        onSetRightPanel={setRightPanel}
        onThemeChange={handleThemePreferenceChange}
        sessions={sessions}
        isStreaming={status === "streaming"}
        themePreference={themePreference}
      />
      <RightPanelProvider
        chatPanelData={chatPanelData}
        settingsActions={settingsActions}
        workspaceTree={workspaceTreeContext}
      >
        <ChatWorkspaceLayout
          headerLeft={header.left}
          headerCenter={header.center}
          headerRight={header.right}
          panel={
            <UiErrorBoundary>
              <RightPanelShell
                handleResourceCanvasResizeStart={
                  handleResourceCanvasResizeStart
                }
                resourceCanvasWidth={resourceCanvasWidth}
              />
            </UiErrorBoundary>
          }
        >
          <ChatPanel
            messages={messages}
            status={status}
            error={error ?? undefined}
            inputSuggestionItems={inputSuggestionItems}
            suppressQuestionTool={!!pendingQuestionBar}
            inputBar={{
              modelKey,
              models,
              infoDescription,
              slashCommands,
              questionBar: pendingQuestionBar,
              onModelChange: setModelKey,
              onSlashCommandSelect: handleSlashCommandSelect,
              onLocalSlashSubmit: handleLocalSlashSubmit,
              modelPickerOpen,
              onModelPickerOpenChange: setModelPickerOpen,
            }}
            onSend={(text, altKey) => sendMessage({ text, altKey })}
            onOpenUIAction={(message) => sendMessage({ text: message, altKey: false })}
            onStop={stop}
            onQuestionAnswer={({ toolCallId, answer }) => {
              void answerQuestion({ toolCallId, answer }).catch(() => undefined)
            }}
          />
        </ChatWorkspaceLayout>
        <SettingsDialog
          open={settingsDialogOpen}
          onOpenChange={(open) => {
            setSettingsDialogOpen(open)
            if (!open) setSettingsInitialTab(undefined)
          }}
          initialTab={settingsInitialTab}
        />
      </RightPanelProvider>
    </>
  )
}

function Chat() {
  return <ChatWorkspaceShell />
}
