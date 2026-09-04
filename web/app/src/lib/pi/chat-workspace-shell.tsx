import { UiErrorBoundary } from "@prime-agent/web-design/components/product/fleet-pi/ui-error-boundary";
import {
	agentTabPanelId,
	agentTabTriggerId,
} from "@prime-agent/web-design/components/product/fleet-pi/layout/agent-tab-bar";
import { RightPanelShell } from "@prime-agent/web-design/components/product/fleet-pi/layout/right-panel-shell";
import { RightPanelProvider } from "@prime-agent/web-design/components/product/fleet-pi/layout/right-panel-context";
import { ChatWorkspaceLayout } from "@prime-agent/web-design/components/product/fleet-pi/layout/chat-workspace-layout";
import { ChatApp } from "@prime-agent/web-design/components/registry/beui/agents/chat-app";
import { FleetSessionSidebar } from "@prime-agent/web-design/components/product/fleet-pi/session-sidebar";
import { AnimatedSidebarInset } from "@prime-agent/web-design/components/registry/beui/motion/animated-sidebar";
import { decodeOpenPanelActionMessage } from "@prime-agent/web-design/components/openui/open-panel-action-message";
import type { OpenUIArtifactCandidate } from "@prime-agent/web-design/components/openui/html-artifact";
import { notify } from "@prime-agent/web-design/lib/notify";
import { lazy, Suspense, useCallback } from "react";
import { ChatPanel } from "@/lib/pi/chat-panel";
import { buildChatInputBarProps } from "@/lib/pi/chat-input-bar-props";
import {
	ChatCommandPaletteOverlay,
	ChatWorkspaceOverlayDialogs,
} from "@/lib/pi/chat-workspace-dialogs";
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
	const activeProjectName = session.projects.find(
		(project) => project.projectId === session.activeProjectId,
	)?.name;
	const handleSend = useCallback(
		(text: string, altKey?: boolean) => {
			const attachments = [...composer.workspaceAttachments, ...composer.uploadedAttachments];
			composer.clearUploadedAttachments();
			composer.clearWorkspaceAttachments();
			void (async () => {
				await conversation.sendMessage({
					text,
					altKey,
					mode: composer.chatMode,
					openUI: true,
					attachments,
				});
			})();
		},
		[
			composer.chatMode,
			composer.clearUploadedAttachments,
			composer.clearWorkspaceAttachments,
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
	const activeTabIsMain = agentTabs.activeTabId === "main" || !agentTabs.selectedChild;
	const activeConversationPanel = activeTabIsMain ? (
		<ChatPanel
			messages={conversation.messages}
			status={conversation.status}
			error={conversation.error ?? undefined}
			workspaceName={activeProjectName}
			activityLabel={conversation.activityLabel}
			presentation={conversation.presentation}
			artifactRuns={conversation.artifactRuns}
			queue={conversation.queue}
			onDeleteQueuedMessage={conversation.deleteQueuedMessage}
			onOpenArtifact={conversation.openArtifact}
			onOpenUIArtifactReady={handleOpenUIArtifactReady}
			inputSuggestionItems={composer.inputSuggestionItems}
			suppressQuestionTool={!!composer.pendingQuestionBar}
			inputBar={buildChatInputBarProps(composer, session.activeSessionId)}
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
				<ChatApp className="h-svh min-h-0 rounded-none border-0" sidebarWidth="17.5rem">
					<FleetSessionSidebar
						data={{
							sessions: session.sessions,
							projects: session.projects,
							projectSessions: session.projectSessions,
							activeProjectId: session.activeProjectId,
							activeSessionId: session.activeSessionId,
						}}
						sessionActions={{
							onNewSession: () => void session.startNewSession(),
							onNewSessionInProject: session.startNewSessionInProject,
							onResumeSession: (sessionToResume) =>
								void session.resumeSession({ sessionId: sessionToResume.sessionId }),
							onRenameSession: (sessionId, title) => void session.renameSession(sessionId, title),
							onDeleteSession: (sessionId) => void session.deleteSession(sessionId),
						}}
						projectActions={{
							onProjectSelect: session.selectProject,
							onCreateProject: session.createProject,
							onRenameProject: session.renameProject,
							onUnregisterProject: session.unregisterProject,
							onForkSessionIntoProject: session.forkSessionIntoProject,
						}}
						navigationActions={{
							onOpenPanelAction: session.openPanelAction,
							onBrowseDirectories: session.browseProjectDirectories,
							onOpenSettings: () => dialogs.setSettingsDialogOpen(true),
						}}
						slots={{ accountMenu: chrome.header.accountMenu }}
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
