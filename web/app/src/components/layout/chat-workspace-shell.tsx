import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { lazy, Suspense, useCallback, useMemo } from "react";
import { ChatPanel } from "@/components/chat/agent-chat";
import { notifyChatError, runWorkspaceAction } from "@/lib/chat/chat-error-notify";
import { useChatInputBarProps } from "@/hooks/chat/chat-input-bar-props";
import { PlanDecisionContext } from "@/hooks/chat/use-pi-chat-plan-decisions";
import { useChatWorkspaceData } from "@/hooks/chat/use-chat-workspace-data";
import { AnimatedSidebarInset, ChatApp } from "@/components/layout/animated-sidebar";
import { ChatCommandPaletteOverlay, ChatWorkspaceOverlayDialogs } from "@/components/layout/chat-workspace-dialogs";
import { focusChatComposer, usePanelKeybindings } from "@/hooks/layout/panel-keybindings";
import { RightPanelProvider } from "@/components/layout/right-panel-context";
import { RightPanelShell } from "@/components/layout/right-panel-shell";
import { UiErrorBoundary } from "@/components/layout/ui-error-boundary";
import type { OpenUIArtifactCandidate } from "@/components/openui/html-artifact";
import { OpenUISessionContext } from "@/components/openui/openui-session-context";
import { agentTabPanelId, agentTabTriggerId } from "@/components/sessions/agent-tab-bar";
import { SessionSidebar } from "@/components/sessions/session-sidebar";
import { notify } from "@/lib/notify";

const LazySubagentChatPanel = lazy(() =>
	import("@/components/chat/subagents/subagent-chat-panel").then(({ SubagentChatPanel }) => ({
		default: SubagentChatPanel,
	})),
);
const LazySessionActivityPanel = lazy(() =>
	import("@/components/sessions/session-activity-panel").then(({ SessionActivityPanel }) => ({
		default: SessionActivityPanel,
	})),
);

/**
 * Renders the chat workspace with session navigation, the active conversation, panels, dialogs, and workspace actions.
 */
export function ChatWorkspaceShell() {
	const { session, conversation, composer, panels, dialogs, chrome, agentTabs } = useChatWorkspaceData();
	const toggleCommandPalette = useCallback(() => {
		dialogs.setCommandPaletteOpen((open) => !open);
	}, [dialogs]);
	const closeRightPanel = useCallback(() => {
		panels.setRightPanel(null);
		window.requestAnimationFrame(() => focusChatComposer());
	}, [panels]);
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
		[conversation, composer],
	);
	const handleOpenUIAction = useCallback(
		(message: string) => {
			void conversation.sendMessage({ text: message, altKey: false, mode: composer.chatMode, openUI: true });
		},
		[conversation, composer],
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
		[conversation],
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
	const onNewSession = useCallback(() => runWorkspaceAction(() => session.startNewSession()), [session]);
	const onResumeSession = useCallback(
		(sessionToResume: ChatSessionInfo) => {
			void session.resumeSession({ sessionId: sessionToResume.sessionId });
		},
		[session],
	);
	const onRenameSession = useCallback(
		(sessionId: string, title: string) => {
			void session.renameSession(sessionId, title);
		},
		[session],
	);
	const onDeleteSession = useCallback(
		(sessionId: string) => {
			void session.deleteSession(sessionId);
		},
		[session],
	);
	const onOpenSettings = useCallback(() => {
		dialogs.setSettingsDialogOpen(true);
	}, [dialogs]);
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
		}),
		[session.selectProject, session.createProject, session.renameProject, session.unregisterProject],
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
	const activeConversationPanel =
		agentTabs.activeTabId === "activity" ? (
			<Suspense
				fallback={
					<div className="flex min-h-32 flex-1 items-center justify-center text-xs text-foreground/45">
						Loading session activity…
					</div>
				}
			>
				<LazySessionActivityPanel
					artifactRuns={conversation.artifactRuns}
					childAgents={conversation.presentation.rlmChildren}
					messages={conversation.messages}
					onOpenArtifact={conversation.openArtifact}
					onSelectChild={agentTabs.openChildTab}
					streaming={conversation.status === "streaming" || conversation.status === "submitted"}
				/>
			</Suspense>
		) : agentTabs.activeTabId === "main" || !agentTabs.selectedChild ? (
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
				inputBar={inputBar}
				onSend={handleSend}
				onOpenUIAction={handleOpenUIAction}
				onStop={conversation.stop}
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
				<PlanDecisionContext value={conversation.answerQuestion}>
					<OpenUISessionContext
						value={{
							sessionId: session.activeSessionId,
							projectId: session.activeProjectId,
							onOpenPanelAction: conversation.openPanelAction,
						}}
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
								<div className="flex h-svh min-w-0 overflow-hidden" data-testid="chat-shell">
									<div
										className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
										data-testid="chat-column"
									>
										<header
											className="relative z-10 grid h-[var(--chat-header-height)] min-h-[var(--chat-header-height)] shrink-0 grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 overflow-visible border-b border-border/70 px-[var(--density-pad-x)] py-1 min-[960px]:grid-cols-[auto_minmax(0,1fr)_auto]"
											data-testid="chat-header"
										>
											<div className="min-w-0 justify-self-start">{chrome.header.left}</div>
											<div className="flex min-w-0 items-center justify-start gap-1 overflow-visible justify-self-stretch">
												{chrome.header.center}
											</div>
											{/* Below the panel breakpoint the right slot holds the panel launcher, so it
											    gets a definite share of the row: an auto column would size to the
											    launcher's tabs, never let it switch to its dropdown, and push the
											    center tabs' New chat button over it. */}
											<div className="min-w-0 justify-self-stretch min-[960px]:justify-self-end">
												{chrome.header.right}
											</div>
										</header>
										<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
											<div
												aria-labelledby={agentTabTriggerId(agentTabs.activeTabId)}
												className="flex min-h-0 min-w-0 flex-1 flex-col"
												data-testid="agent-tab-panel"
												id={agentTabPanelId(agentTabs.activeTabId)}
												role="tabpanel"
											>
												{activeConversationPanel}
											</div>
										</div>
									</div>
									<UiErrorBoundary>
										<RightPanelShell
											handleResourceCanvasResizeStart={panels.handleResourceCanvasResizeStart}
											onClose={closeRightPanel}
											onResourceCanvasWidthChange={panels.handleResourceCanvasWidthChange}
											resourceCanvasWidth={panels.resourceCanvasWidth}
										/>
									</UiErrorBoundary>
								</div>
							</AnimatedSidebarInset>
						</ChatApp>
					</OpenUISessionContext>
				</PlanDecisionContext>
				<ChatWorkspaceOverlayDialogs dialogs={dialogs} />
			</RightPanelProvider>
		</>
	);
}
