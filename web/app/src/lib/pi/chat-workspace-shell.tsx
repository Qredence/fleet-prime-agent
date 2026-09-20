import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { lazy, Suspense, useCallback, useMemo } from "react";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
import { decodeOpenPanelActionMessage } from "@/components/openui/open-panel-action-message";
import { agentTabPanelId, agentTabTriggerId } from "@/components/qredence-ui/layout/agent-tab-ids";
import { AnimatedSidebarInset } from "@/components/qredence-ui/layout/animated-sidebar";
import { ChatApp } from "@/components/qredence-ui/layout/chat-app";
import { ChatWorkspaceLayout } from "@/components/qredence-ui/layout/chat-workspace-layout";
import { RightPanelProvider } from "@/components/qredence-ui/layout/right-panel-context";
import { RightPanelShell } from "@/components/qredence-ui/layout/right-panel-shell";
import { SessionSidebar } from "@/components/qredence-ui/layout/session-sidebar";
import { UiErrorBoundary } from "@/components/qredence-ui/layout/ui-error-boundary";
import { notify } from "@/lib/notify";
import { notifyChatError, runWorkspaceAction } from "@/lib/pi/chat-error-notify";
import { useChatInputBarProps } from "@/lib/pi/chat-input-bar-props";
import { ChatPanel } from "@/lib/pi/chat-panel";
import { ChatCommandPaletteOverlay, ChatWorkspaceOverlayDialogs } from "@/lib/pi/chat-workspace-dialogs";
import { focusChatComposer, usePanelKeybindings } from "@/lib/pi/panel-keybindings";
import { useChatWorkspaceData } from "@/lib/pi/use-chat-workspace-data";

const LazySubagentChatPanel = lazy(() =>
	import("@/lib/pi/subagent-chat-panel").then(({ SubagentChatPanel }) => ({
		default: SubagentChatPanel,
	})),
);

/**
 * Renders the chat workspace with session navigation, the active conversation, panels, dialogs, and workspace actions.
 */
export function ChatWorkspaceShell() {
	const { session, conversation, composer, panels, dialogs, chrome, agentTabs } = useChatWorkspaceData();
	const toggleCommandPalette = useCallback(() => {
		dialogs.setCommandPaletteOpen((open) => !open);
	}, [dialogs.setCommandPaletteOpen]);
	const closeRightPanel = useCallback(() => {
		panels.setRightPanel(null);
		window.requestAnimationFrame(() => focusChatComposer());
	}, [panels.setRightPanel]);
	usePanelKeybindings({
		onCommandPaletteToggle: toggleCommandPalette,
		onClosePanel: closeRightPanel,
		rightPanel: panels.rightPanel,
		setRightPanel: panels.setRightPanel,
	});
	const activeProjectName = session.projects.find((project) => project.projectId === session.activeProjectId)?.name;
	const handleSend = useCallback(
		(text: string, altKey?: boolean) => {
			const uploaded = [...composer.uploadedAttachments];
			const workspace = [...composer.workspaceAttachments];
			const attachments = [...workspace, ...uploaded];
			composer.clearUploadedAttachments();
			composer.clearWorkspaceAttachments();
			void (async () => {
				try {
					const sent = await conversation.sendMessage({
						text,
						altKey,
						mode: composer.chatMode,
						openUI: true,
						attachments,
					});
					if (!sent) composer.restoreAttachments(uploaded, workspace);
				} catch (error) {
					composer.restoreAttachments(uploaded, workspace);
					notifyChatError(error);
				}
			})();
		},
		[
			composer.chatMode,
			composer.clearUploadedAttachments,
			composer.clearWorkspaceAttachments,
			composer.restoreAttachments,
			composer.uploadedAttachments,
			composer.workspaceAttachments,
			conversation.sendMessage,
		],
	);
	const handleOpenUIAction = useCallback(
		(message: string) => {
			const panelAction = decodeOpenPanelActionMessage(message);
			if (panelAction) {
				conversation.openPanelAction(panelAction);
				return;
			}
			void conversation.sendMessage({ text: message, altKey: false, mode: composer.chatMode, openUI: true });
		},
		[composer.chatMode, conversation.openPanelAction, conversation.sendMessage],
	);
	const handleOpenUIArtifactReady = useCallback(
		async (candidate: OpenUIArtifactCandidate) => {
			try {
				return await conversation.persistOpenUIArtifact(candidate);
			} catch (error) {
				notify.error(`Artifact persistence failed: ${error instanceof Error ? error.message : String(error)}`);
				return undefined;
			}
		},
		[conversation.persistOpenUIArtifact],
	);

	const sidebarData = useMemo(
		() => ({
			sessions: session.sessions,
			projects: session.projects,
			projectSessions: session.projectSessions,
			activeProjectId: session.activeProjectId,
			activeSessionId: session.activeSessionId,
		}),
		[session.sessions, session.projects, session.projectSessions, session.activeProjectId, session.activeSessionId],
	);
	const onNewSession = useCallback(
		() => runWorkspaceAction(() => session.startNewSession()),
		[session.startNewSession],
	);
	const onResumeSession = useCallback(
		(sessionToResume: ChatSessionInfo) => {
			void session.resumeSession({ sessionId: sessionToResume.sessionId });
		},
		[session.resumeSession],
	);
	const onRenameSession = useCallback(
		(sessionId: string, title: string) => {
			void session.renameSession(sessionId, title);
		},
		[session.renameSession],
	);
	const onDeleteSession = useCallback(
		(sessionId: string) => {
			void session.deleteSession(sessionId);
		},
		[session.deleteSession],
	);
	const onOpenSettings = useCallback(() => {
		dialogs.setSettingsDialogOpen(true);
	}, [dialogs.setSettingsDialogOpen]);
	const sessionActions = useMemo(
		() => ({
			onNewSession,
			onNewSessionInProject: session.startNewSessionInProject,
			onResumeSession,
			onRenameSession,
			onDeleteSession,
		}),
		[onNewSession, session.startNewSessionInProject, onResumeSession, onRenameSession, onDeleteSession],
	);
	const projectActions = useMemo(
		() => ({
			onProjectSelect: session.selectProject,
			onCreateProject: session.createProject,
			onRenameProject: session.renameProject,
			onUnregisterProject: session.unregisterProject,
			onForkSessionIntoProject: session.forkSessionIntoProject,
		}),
		[
			session.selectProject,
			session.createProject,
			session.renameProject,
			session.unregisterProject,
			session.forkSessionIntoProject,
		],
	);
	const navigationActions = useMemo(
		() => ({
			onOpenPanelAction: session.openPanelAction,
			onBrowseDirectories: session.browseProjectDirectories,
			onOpenSettings,
		}),
		[session.openPanelAction, session.browseProjectDirectories, onOpenSettings],
	);
	const sidebarSlots = useMemo(() => ({ accountMenu: chrome.header.accountMenu }), [chrome.header.accountMenu]);

	const inputBar = useChatInputBarProps(composer, session.activeSessionId);
	const activeTabIsMain = agentTabs.activeTabId === "main" || !agentTabs.selectedChild;
	const activeConversationPanel = activeTabIsMain ? (
		<ChatPanel
			messages={conversation.messages}
			highlightedMessageId={conversation.highlightedTranscriptMessageId ?? undefined}
			status={conversation.status}
			error={conversation.error ?? undefined}
			workspaceName={activeProjectName}
			activityLabel={conversation.activityLabel}
			presentation={conversation.presentation}
			artifactRuns={conversation.artifactRuns}
			queue={conversation.queue}
			onDeleteQueuedMessage={conversation.deleteQueuedMessage}
			onEditQueuedMessage={conversation.editQueuedMessage}
			onOpenArtifact={conversation.openArtifact}
			onOpenUIArtifactReady={handleOpenUIArtifactReady}
			inputSuggestionItems={composer.inputSuggestionItems}
			suppressQuestionTool={!!composer.pendingQuestionBar}
			inputBar={inputBar}
			onSend={handleSend}
			onOpenUIAction={handleOpenUIAction}
			onStop={conversation.stop}
			onQuestionAnswer={composer.handleQuestionAnswer}
		/>
	) : (
		<Suspense
			fallback={
				<div className="flex min-h-32 flex-1 items-center justify-center text-xs text-foreground/45">
					Loading subagent thread…
				</div>
			}
		>
			<LazySubagentChatPanel
				child={agentTabs.selectedChild!}
				parentSessionId={session.activeSessionId}
				state={agentTabs.conversation}
			/>
		</Suspense>
	);
	return (
		<>
			<ChatCommandPaletteOverlay
				chrome={chrome}
				conversation={conversation}
				dialogs={dialogs}
				panels={panels}
				session={session}
			/>
			<RightPanelProvider
				chatPanelData={panels.chatPanelData}
				onOpenUIAction={handleOpenUIAction}
				settingsActions={panels.settingsActions}
				workspaceTree={panels.workspaceTreeContext}
			>
				<ChatApp className="h-svh min-h-0 rounded-none border-0">
					<SessionSidebar
						data={sidebarData}
						sessionActions={sessionActions}
						projectActions={projectActions}
						navigationActions={navigationActions}
						slots={sidebarSlots}
					/>
					<AnimatedSidebarInset className="h-svh min-h-0 overflow-hidden">
						<ChatWorkspaceLayout
							headerLeft={chrome.header.left}
							headerCenter={chrome.header.center}
							headerRight={chrome.header.right}
							panel={
								<UiErrorBoundary>
									<RightPanelShell
										handleResourceCanvasResizeStart={panels.handleResourceCanvasResizeStart}
										onClose={closeRightPanel}
										resourceCanvasWidth={panels.resourceCanvasWidth}
									/>
								</UiErrorBoundary>
							}
						>
							<div
								aria-labelledby={agentTabTriggerId(agentTabs.activeTabId)}
								className="flex min-h-0 min-w-0 flex-1 flex-col"
								data-testid="agent-tab-panel"
								id={agentTabPanelId(agentTabs.activeTabId)}
								role="tabpanel"
							>
								{activeConversationPanel}
							</div>
						</ChatWorkspaceLayout>
					</AnimatedSidebarInset>
				</ChatApp>
				<ChatWorkspaceOverlayDialogs dialogs={dialogs} />
			</RightPanelProvider>
		</>
	);
}
