import { UiErrorBoundary } from "@prime-agent/web-design/components/product/fleet-pi/ui-error-boundary"
import { RightPanelShell } from "@prime-agent/web-design/components/product/fleet-pi/layout/right-panel-shell"
import { RightPanelProvider } from "@prime-agent/web-design/components/product/fleet-pi/layout/right-panel-context"
import { ChatWorkspaceLayout } from "@prime-agent/web-design/components/product/fleet-pi/layout/chat-workspace-layout"
import { ChatApp } from "@prime-agent/web-design/components/registry/beui/agents/chat-app"
import { FleetSessionSidebar } from "@prime-agent/web-design/components/product/fleet-pi/session-sidebar"
import { AnimatedSidebarInset } from "@prime-agent/web-design/components/registry/beui/motion/animated-sidebar"
import { decodeOpenPanelActionMessage } from "@prime-agent/web-design/components/openui/open-panel-action-message"
import type { OpenUIArtifactCandidate } from "@prime-agent/web-design/components/openui/html-artifact"
import { notify } from "@prime-agent/web-design/lib/notify"
import { lazy, Suspense, useCallback, useEffect, useEffectEvent } from "react"
import { ChatPanel } from "@/lib/pi/chat-panel"
import { resolveChatApiUrl } from "@/lib/pi/chat-runtime-url"
import { useChatWorkspaceData } from "@/lib/pi/use-chat-workspace-data"
import { usePanelKeybindings } from "@/lib/pi/panel-keybindings"

const LazyChatCommandPalette = lazy(() =>
  import("@prime-agent/web-design/components/product/fleet-pi/chat-command-palette").then(
    ({ ChatCommandPalette }) => ({ default: ChatCommandPalette })
  )
)
const LazySettingsDialog = lazy(() =>
  import("@prime-agent/web-design/components/product/fleet-pi/pi/settings-dialog").then(
    ({ SettingsDialog }) => ({ default: SettingsDialog })
  )
)
const LazyForkPickerDialog = lazy(() =>
  import("@prime-agent/web-design/components/product/fleet-pi/chat/fork-picker-dialog").then(
    ({ ForkPickerDialog }) => ({ default: ForkPickerDialog })
  )
)

export function ChatWorkspaceShell() {
  const {
    session: {
    activeSessionId,
    browseProjectDirectories,
    createProject,
    deleteSession,
    forkSessionIntoProject,
    activeProjectId,
    projects,
    projectSessions,
    selectProject,
    renameProject,
    unregisterProject,
    renameSession,
    resumeSession,
    sessions,
    startNewSession,
    startNewSessionInProject,
    },
    conversation: {
      activityLabel,
      artifactRuns,
      error,
      messages,
      openArtifact,
      openPanelAction,
      persistOpenUIArtifact,
      presentation,
      sendMessage,
      status,
      stop,
    },
    composer: {
    chatMode,
    clearUploadedAttachments,
    clearWorkspaceAttachments,
    effortPickerOpen,
    handleLocalSlashSubmit,
    handleAttach,
    handleQuestionAnswer,
    handleSlashCommandSelect,
    infoDescription,
    inputSuggestionItems,
    workspaceReferenceSuggestions,
    modelKey,
    modelPickerOpen,
    models,
    uploadedAttachments,
    workspaceAttachments,
    addWorkspaceAttachment,
    removeUploadedAttachment,
    removeWorkspaceAttachment,
    pendingQuestionBar,
    setChatMode,
    setEffortPickerOpen,
    setModelKey,
    setModelPickerOpen,
    setThinkingLevel,
    slashCommands,
    thinkingLevel,
    },
    panels: {
    chatPanelData,
    handleResourceCanvasResizeStart,
    resourceCanvasWidth,
    rightPanel,
    setRightPanel,
    settingsActions,
    workspaceTreeContext,
    },
    dialogs: {
    commandPaletteOpen,
    forkFromEntry,
    forkPickerEntries,
    setCommandPaletteOpen,
    setForkPickerEntries,
    setSettingsDialogOpen,
    setSettingsInitialTab,
    settingsDialogOpen,
    settingsInitialTab,
    },
    chrome: {
    handleThemePreferenceChange,
    header,
    themePreference,
    },
  } = useChatWorkspaceData()
  const onCommandPaletteKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault()
      setCommandPaletteOpen(!commandPaletteOpen)
    }
  })
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => onCommandPaletteKeyDown(event)
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])
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
	const handleOpenUIArtifactReady = useCallback(
		async (candidate: OpenUIArtifactCandidate) => {
			try {
				return await persistOpenUIArtifact(candidate)
			} catch (error) {
				notify.error(`Artifact persistence failed: ${error instanceof Error ? error.message : String(error)}`)
				return undefined
			}
		},
		[persistOpenUIArtifact],
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
      {commandPaletteOpen ? (
        <Suspense fallback={null}>
          <LazyChatCommandPalette
            open
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
        </Suspense>
      ) : null}
      <RightPanelProvider
        chatPanelData={chatPanelData}
        onOpenUIAction={handleOpenUIAction}
        settingsActions={settingsActions}
        workspaceTree={workspaceTreeContext}
      >
        <ChatApp className="h-svh min-h-0 rounded-none border-0" sidebarWidth="17.5rem">
          <FleetSessionSidebar
            data={{
              sessions,
              projects,
              projectSessions,
              activeProjectId,
              activeSessionId,
            }}
            sessionActions={{
              onNewSession: () => void startNewSession(),
              onNewSessionInProject: startNewSessionInProject,
              onResumeSession: (session) =>
                void resumeSession({ sessionId: session.sessionId }),
              onRenameSession: (sessionId, title) => void renameSession(sessionId, title),
              onDeleteSession: (sessionId) => void deleteSession(sessionId),
            }}
            projectActions={{
              onProjectSelect: selectProject,
              onCreateProject: createProject,
              onRenameProject: renameProject,
              onUnregisterProject: unregisterProject,
              onForkSessionIntoProject: forkSessionIntoProject,
            }}
            navigationActions={{
              onOpenPanelAction: openPanelAction,
              onBrowseDirectories: browseProjectDirectories,
              onOpenSettings: () => setSettingsDialogOpen(true),
            }}
            slots={{ accountMenu: header.accountMenu }}
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
				onOpenUIArtifactReady={handleOpenUIArtifactReady}
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
        {settingsDialogOpen ? (
          <Suspense fallback={null}>
            <LazySettingsDialog
              open
              onOpenChange={handleSettingsOpenChange}
              initialTab={settingsInitialTab}
            />
          </Suspense>
        ) : null}
        {forkPickerEntries ? (
          <Suspense fallback={null}>
            <LazyForkPickerDialog
              entries={forkPickerEntries}
              onOpenChange={(open) => {
                if (!open) setForkPickerEntries(null)
              }}
              onPick={forkFromEntry}
            />
          </Suspense>
        ) : null}
      </RightPanelProvider>
    </>
  )
}
