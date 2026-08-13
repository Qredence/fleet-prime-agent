import { createFileRoute } from "@tanstack/react-router"
import { ChatCommandPalette } from "@prime-agent/web-design/components/fleet-pi/chat-command-palette"
import { UiErrorBoundary } from "@prime-agent/web-design/components/fleet-pi/ui-error-boundary"
import { RightPanelShell } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-shell"
import { RightPanelProvider } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-context"
import { ChatWorkspaceLayout } from "@prime-agent/web-design/components/fleet-pi/layout/chat-workspace-layout"
import { SettingsDialog } from "@prime-agent/web-design/components/fleet-pi/pi/settings-dialog"
import { ChatPanel } from "@/lib/pi/chat-panel"
import { useChatWorkspaceData } from "@/lib/pi/use-chat-workspace-data"

export const Route = createFileRoute("/")({ component: Chat })

function ChatWorkspaceShell() {
  const {
    answerQuestion,
    chatPanelData,
    commandPaletteOpen,
    error,
    handleLocalSlashSubmit,
    handleResourceCanvasResizeStart,
    handleSlashCommandSelect,
    handleThemePreferenceChange,
    header,
    infoDescription,
    inputSuggestionItems,
    messages,
    modelKey,
    modelPickerOpen,
    models,
    pendingQuestionBar,
    resourceCanvasWidth,
    resumeSession,
    sendMessage,
    sessions,
    setCommandPaletteOpen,
    setModelKey,
    setModelPickerOpen,
    setRightPanel,
    setSettingsDialogOpen,
    setSettingsInitialTab,
    settingsActions,
    settingsDialogOpen,
    settingsInitialTab,
    slashCommands,
    startNewSession,
    status,
    stop,
    themePreference,
    workspaceTreeContext,
  } = useChatWorkspaceData()

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
            onOpenUIAction={(message) =>
              sendMessage({ text: message, altKey: false })
            }
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
