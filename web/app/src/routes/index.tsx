import { createFileRoute } from "@tanstack/react-router"
import { ChatCommandPalette } from "@prime-agent/web-design/components/fleet-pi/chat-command-palette"
import { UiErrorBoundary } from "@prime-agent/web-design/components/fleet-pi/ui-error-boundary"
import { RightPanelShell } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-shell"
import { RightPanelProvider } from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-context"
import { ChatWorkspaceLayout } from "@prime-agent/web-design/components/fleet-pi/layout/chat-workspace-layout"
import { SettingsDialog } from "@prime-agent/web-design/components/fleet-pi/pi/settings-dialog"
import { ForkPickerDialog } from "@prime-agent/web-design/components/fleet-pi/chat/fork-picker-dialog"
import { ChatApp } from "@prime-agent/web-design/components/agents/chat-app"
import { FleetSessionSidebar } from "@prime-agent/web-design/components/fleet-pi/session-sidebar"
import { AnimatedSidebarInset } from "@prime-agent/web-design/components/motion/animated-sidebar"
import { decodeOpenPanelActionMessage } from "@prime-agent/web-design/components/openui/openui-renderer"
import { useCallback } from "react"
import { ChatPanel } from "@/lib/pi/chat-panel"
import { resolveChatApiUrl } from "@/lib/pi/chat-runtime-url"
import { useChatWorkspaceData } from "@/lib/pi/use-chat-workspace-data"
import { usePanelKeybindings } from "@/lib/pi/panel-keybindings"

export const Route = createFileRoute("/")({ component: Chat })

function ChatWorkspaceShell() {
  const {
    activeSessionId,
    chatMode,
    chatPanelData,
    commandPaletteOpen,
    clearUploadedAttachments,
    clearWorkspaceAttachments,
    browseProjectDirectories,
    createProject,
    deleteSession,
    error,
    forkFromEntry,
    forkSessionIntoProject,
    forkPickerEntries,
    handleLocalSlashSubmit,
    handleAttach,
    handleQuestionAnswer,
    handleResourceCanvasResizeStart,
    handleSlashCommandSelect,
    handleThemePreferenceChange,
    header,
    infoDescription,
    inputSuggestionItems,
    workspaceReferenceSuggestions,
		messages,
		artifactRuns,
		effortPickerOpen,
    modelKey,
    modelPickerOpen,
    models,
    openPanelAction,
    openArtifact,
    uploadedAttachments,
    workspaceAttachments,
    addWorkspaceAttachment,
    removeWorkspaceAttachment,
		pendingQuestionBar,
		presentation,
		activeProjectId,
	    activityLabel,
    projects,
    projectSessions,
    resourceCanvasWidth,
    rightPanel,
    selectProject,
    renameProject,
    unregisterProject,
    renameSession,
    removeUploadedAttachment,
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
    startNewSessionInProject,
    status,
    stop,
    themePreference,
    thinkingLevel,
    workspaceTreeContext,
  } = useChatWorkspaceData()
  usePanelKeybindings({ rightPanel, setRightPanel })
  const activeProjectName = projects.find(
    (project) => project.projectId === activeProjectId,
  )?.name
  const handleSend = useCallback(
    (text: string, altKey?: boolean) => {
      const attachments = [...workspaceAttachments, ...uploadedAttachments]
      clearUploadedAttachments()
      clearWorkspaceAttachments()
      void (async () => {
        await sendMessage({
          text,
          altKey,
          mode: chatMode,
          openUI: true,
          attachments,
        })
      })()
    },
    [chatMode, clearUploadedAttachments, clearWorkspaceAttachments, sendMessage, uploadedAttachments, workspaceAttachments],
  )
  const handleOpenUIAction = useCallback(
    (message: string) => {
      const panelAction = decodeOpenPanelActionMessage(message)
      if (panelAction) {
        openPanelAction(panelAction)
        return
      }
      void sendMessage({ text: message, altKey: false, mode: chatMode, openUI: true })
    },
    [chatMode, openPanelAction, sendMessage],
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
          void resumeSession({ sessionId: session.sessionId })
        }
        onSetRightPanel={setRightPanel}
        onThemeChange={handleThemePreferenceChange}
        sessions={sessions}
        isStreaming={status === "streaming"}
        themePreference={themePreference}
      />
      <RightPanelProvider
        chatPanelData={chatPanelData}
        onOpenUIAction={handleOpenUIAction}
        settingsActions={settingsActions}
        workspaceTree={workspaceTreeContext}
      >
        <ChatApp className="h-svh min-h-0 rounded-none border-0" sidebarWidth="17.5rem">
          <FleetSessionSidebar
            accountMenu={header.accountMenu}
            sessions={sessions}
            projects={projects}
            projectSessions={projectSessions}
            activeProjectId={activeProjectId}
            activeSessionId={activeSessionId}
            onNewSession={() => void startNewSession()}
            onNewSessionInProject={startNewSessionInProject}
            onResumeSession={(session) =>
              void resumeSession({ sessionId: session.sessionId })
            }
            onRenameSession={(sessionId, title) => void renameSession(sessionId, title)}
            onDeleteSession={(sessionId) => void deleteSession(sessionId)}
            onProjectSelect={selectProject}
            onCreateProject={createProject}
            onRenameProject={renameProject}
            onUnregisterProject={unregisterProject}
            onForkSessionIntoProject={forkSessionIntoProject}
            onOpenPanelAction={openPanelAction}
            onBrowseDirectories={browseProjectDirectories}
            onOpenSettings={() => setSettingsDialogOpen(true)}
          />
          <AnimatedSidebarInset className="h-svh min-h-0 overflow-hidden">
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
                workspaceName={activeProjectName}
                activityLabel={activityLabel}
                presentation={presentation}
                artifactRuns={artifactRuns}
                onOpenArtifact={openArtifact}
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
                  attachments: {
                    onAttach: handleAttach,
                    images: uploadedAttachments.flatMap((attachment) =>
                      attachment.mimeType.startsWith("image/")
                        ? [
                            {
                              id: attachment.attachmentId,
                              filename: attachment.name,
                              size: attachment.size,
                              url: resolveChatApiUrl(
                                `/api/chat/session?sessionId=${encodeURIComponent(activeSessionId ?? "")}&attachmentId=${encodeURIComponent(attachment.attachmentId)}`,
                              ),
                            },
                          ]
                        : [],
                    ),
                    files: uploadedAttachments.flatMap((attachment) =>
                      attachment.mimeType.startsWith("image/")
                        ? []
                        : [
                            {
                              id: attachment.attachmentId,
                              filename: attachment.name,
                              size: attachment.size,
                            },
                          ],
                    ),
                    onRemoveImage: removeUploadedAttachment,
                    onRemoveFile: removeUploadedAttachment,
                  },
                  workspaceReferences: workspaceAttachments,
                  workspaceSuggestions: workspaceReferenceSuggestions,
                  onWorkspaceReferenceSelect: addWorkspaceAttachment,
                  onRemoveWorkspaceReference: removeWorkspaceAttachment,
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
          </AnimatedSidebarInset>
        </ChatApp>
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
