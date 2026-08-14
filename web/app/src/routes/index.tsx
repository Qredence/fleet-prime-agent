import { createFileRoute } from "@tanstack/react-router"
import { ChatCommandPalette } from "@prime-agent/web-design/components/fleet-pi/chat-command-palette"
import { UiErrorBoundary } from "@prime-agent/web-design/components/fleet-pi/ui-error-boundary"
import { RightPanelShell } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-shell"
import { RightPanelProvider } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-context"
import { ChatWorkspaceLayout } from "@prime-agent/web-design/components/fleet-pi/layout/chat-workspace-layout"
import { SettingsDialog } from "@prime-agent/web-design/components/fleet-pi/pi/settings-dialog"
import { ForkPickerDialog } from "@prime-agent/web-design/components/fleet-pi/chat/fork-picker-dialog"
import { useCallback } from "react"
import { ChatPanel } from "@/lib/pi/chat-panel"
import { useChatWorkspaceData } from "@/lib/pi/use-chat-workspace-data"

export const Route = createFileRoute("/")({ component: Chat })

function ChatWorkspaceShell() {
  const {
    chatMode,
    chatPanelData,
    commandPaletteOpen,
    error,
    forkFromEntry,
    forkPickerEntries,
    handleLocalSlashSubmit,
    handleQuestionAnswer,
    handleResourceCanvasResizeStart,
    handleSlashCommandSelect,
    handleThemePreferenceChange,
    header,
    infoDescription,
    inputSuggestionItems,
    messages,
    effortPickerOpen,
    modelKey,
    modelPickerOpen,
    models,
    pendingQuestionBar,
    resourceCanvasWidth,
    resumeSession,
    sendMessage,
    sessions,
    setChatMode,
    setCommandPaletteOpen,
    setEffortPickerOpen,
    setForkPickerEntries,
    setModelKey,
    setModelPickerOpen,
    setRightPanel,
    setSettingsDialogOpen,
    setSettingsInitialTab,
    setThinkingLevel,
    settingsActions,
    settingsDialogOpen,
    settingsInitialTab,
    slashCommands,
    startNewSession,
    status,
    stop,
    themePreference,
    thinkingLevel,
    workspaceTreeContext,
  } = useChatWorkspaceData()
  const handleSend = useCallback(
    (text: string, altKey?: boolean) => {
      void sendMessage({ text, altKey, mode: chatMode })
    },
    [chatMode, sendMessage],
  )
  const handleOpenUIAction = useCallback(
    (message: string) => {
      void sendMessage({ text: message, altKey: false, mode: chatMode })
    },
    [chatMode, sendMessage],
  )
  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setSettingsDialogOpen(open)
      if (!open) setSettingsInitialTab(undefined)
    },
    [setSettingsDialogOpen, setSettingsInitialTab],
  )
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
              chatMode,
              onChatModeChange: setChatMode,
              onModelChange: setModelKey,
              thinkingLevel,
              onThinkingLevelChange: setThinkingLevel,
              onSlashCommandSelect: handleSlashCommandSelect,
              onLocalSlashSubmit: handleLocalSlashSubmit,
              modelPickerOpen,
              onModelPickerOpenChange: setModelPickerOpen,
              effortPickerOpen,
              onEffortPickerOpenChange: setEffortPickerOpen,
            }}
            onSend={handleSend}
            onOpenUIAction={handleOpenUIAction}
            onStop={stop}
            onQuestionAnswer={handleQuestionAnswer}
          />
        </ChatWorkspaceLayout>
        <SettingsDialog
          open={settingsDialogOpen}
          onOpenChange={handleSettingsOpenChange}
          initialTab={settingsInitialTab}
        />
        <ForkPickerDialog
          entries={forkPickerEntries}
          onOpenChange={(open) => {
            if (!open) setForkPickerEntries(null)
          }}
          onPick={forkFromEntry}
        />
      </RightPanelProvider>
    </>
  )
}

function Chat() {
  return <ChatWorkspaceShell />
}
