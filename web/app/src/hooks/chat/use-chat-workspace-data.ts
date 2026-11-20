import type { ProjectId } from "@prime-agent/web-protocol";
import type { ChatQuestionAnswer } from "@prime-agent/web-protocol/chat-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { derivePrimeAgentArtifactRuns } from "@/lib/artifacts/prime-agent-artifacts";
import { chatClient } from "@/lib/chat/chat-client";
import { notifyChatError, runWorkspaceAction } from "@/lib/chat/chat-error-notify";
import { queueLabel } from "@/lib/chat/chat-helpers";
import {
	useChatCommands,
	useChatModels,
	useChatProjects,
	useChatResources,
	useChatSettings,
	useWorkspaceTree,
} from "@/hooks/chat/chat-queries";
import { useChatWorkspaceComposerState } from "@/hooks/chat/chat-input-bar-props";
import { useComposerInlineCompletion } from "@/hooks/chat/composer-assistance";
import { useComposerIntentAvailability, useComposerIntentRouting } from "@/hooks/chat/composer-assistance";
import type { InlineCompletion } from "@/hooks/chat/inline-completion";
import type { SettingsSectionId } from "@/lib/settings/settings-sections";
import {
	canonicalCommandName,
	commandInsertsPrefix,
	commandSuggestions,
	isLocalUiCommand,
	isSessionTransportCommand,
	parseSlashInput,
	TUI_ONLY_COMMANDS,
} from "@/lib/chat/runtime-commands";
import { buildWorkspaceReferenceSuggestions } from "@/lib/chat/workspace-suggestions";
import { useSkipPendingQuestion } from "@/hooks/chat/use-skip-pending-question";
import { useChatStorage } from "@/hooks/chat/use-chat-storage";
import { useChatSuggestions } from "@/hooks/chat/use-chat-view";
import { useChatWorkspaceActions } from "@/hooks/chat/use-chat-workspace-actions";
import { usePiChat } from "@/hooks/chat/use-pi-chat";
import { useChatWorkspaceHeader } from "@/components/layout/chat-header";
import { useChatWorkspaceDialogs } from "@/components/layout/chat-workspace-dialogs";
import { useChatShellState } from "@/components/layout/use-chat-shell-state";
import { useSettingsActions } from "@/components/settings/use-settings-actions";
import { useThrottledTranscriptSummary, useThrottledWhileLive } from "@/hooks/chat/use-throttled-transcript-summary";
import type { RightPanelData, WorkspacePanelData } from "@/components/layout/right-panel-data";
import { useAgentTabs } from "@/hooks/sessions/use-agent-tabs";
import { useSessionTree } from "@/hooks/sessions/use-session-tree";
import { loadWorkspaceFile } from "@/lib/workspace/workspace-file";
import { notify } from "@/lib/notify";

/**
 * Provides coordinated state, data, and actions for the chat workspace, including projects, sessions, conversations, attachments, panels, dialogs, and settings.
 */
export function useChatWorkspaceData() {
	const {
		forkPickerDialogEverOpened,
		forkPickerEntries,
		setForkPickerEntries,
		setSettingsDialogOpen,
		setSettingsInitialTab,
		settingsDialogEverOpened,
		settingsDialogOpen,
		settingsInitialTab,
	} = useChatWorkspaceDialogs();
	const {
		chatMode,
		effortPickerOpen,
		modelPickerOpen,
		setChatMode,
		setEffortPickerOpen,
		setModelPickerOpen,
		setUploadedAttachments,
		setWorkspaceAttachments,
		uploadedAttachments,
		workspaceAttachments,
	} = useChatWorkspaceComposerState();
	const storage = useChatStorage();
	const [activeProjectId, setActiveProjectId] = useState<ProjectId | undefined>(
		storage.sessionMetadata.projectId ?? undefined,
	);
	const defaultedProjectRef = useRef(false);
	const { data: projectsData, refetch: refetchProjects } = useChatProjects();
	const { data: modelsData } = useChatModels(activeProjectId);
	const {
		commandPaletteOpen,
		handleResourceCanvasResizeStart,
		handleResourceCanvasWidthChange,
		handleThemePreferenceChange,
		initialSessionMetadata,
		modelKey,
		modelSelection,
		models,
		openArtifact,
		openPanelAction,
		persistSession,
		reopenRightPanel,
		resourceCanvasWidth,
		rightPanel,
		selectedArtifactId,
		selectedWorkspacePath,
		setCommandPaletteOpen,
		setModelKey,
		setRightPanel,
		setSelectedWorkspacePath,
		setThinkingLevel,
		themePreference,
		thinkingLevel,
	} = useChatShellState(modelsData, storage);

	const storedProjectId = initialSessionMetadata.projectId;
	const firstProjectId = projectsData?.projects[0]?.projectId;
	const [syncedStoredProjectId, setSyncedStoredProjectId] = useState(storedProjectId);
	if (storedProjectId !== syncedStoredProjectId) {
		setSyncedStoredProjectId(storedProjectId);
		if (storedProjectId && storedProjectId !== activeProjectId) {
			setActiveProjectId(storedProjectId);
		}
	} else if (!activeProjectId && firstProjectId) {
		setActiveProjectId(firstProjectId);
	}

	useEffect(() => {
		if (storedProjectId || defaultedProjectRef.current) return;
		const firstId = projectsData?.projects[0]?.projectId;
		if (!activeProjectId || !firstId || activeProjectId !== firstId) return;
		defaultedProjectRef.current = true;
		persistSession({ projectId: activeProjectId });
	}, [activeProjectId, persistSession, projectsData?.projects, storedProjectId]);

	const {
		data: resourcesData,
		isLoading: resourcesLoading,
		error: resourcesError,
		refetch: refetchResources,
	} = useChatResources(activeProjectId, storage.sessionMetadata.sessionId ?? undefined);
	const { data: commandsData } = useChatCommands(activeProjectId, storage.sessionMetadata.sessionId ?? undefined);
	const { data: settingsData, isLoading: settingsLoading, error: settingsError } = useChatSettings(activeProjectId);
	const shouldLoadWorkspaceTree = rightPanel === "workspace" || rightPanel === "resources";
	const {
		data: workspaceData,
		isLoading: workspaceLoading,
		error: workspaceError,
		refetch: refetchWorkspace,
	} = useWorkspaceTree(activeProjectId, { enabled: shouldLoadWorkspaceTree });

	const resources = resourcesData ?? null;
	const workspaceTree = workspaceData ?? null;

	const refreshResources = useCallback(() => {
		void refetchResources();
	}, [refetchResources]);

	const refreshWorkspace = useCallback(() => {
		void refetchWorkspace();
	}, [refetchWorkspace]);

	const {
		activityLabel,
		answerQuestion,
		appendLocalMessage,
		deleteQueuedMessage,
		editQueuedMessage,
		deleteSession,
		error,
		getSessionMetadata,
		messages,
		planLabel,
		persistOpenUIArtifact,
		presentation,
		queue,
		renameSession,
		resumeSession,
		sendMessage,
		sessionMetadata,
		sessions,
		startNewSession,
		switchProject,
		status,
		stop,
	} = usePiChat(modelSelection, {
		initialSessionMetadata,
		projectId: activeProjectId,
		persistSession,
	});
	const artifactRuns = useMemo(
		() => derivePrimeAgentArtifactRuns(messages, presentation, status),
		[messages, presentation, status],
	);
	const appliedPresentationThinkingKeyRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!presentation.thinkingLevel) return;
		const key = `${sessionMetadata.sessionId}:${presentation.thinkingLevel}`;
		if (appliedPresentationThinkingKeyRef.current === key) return;
		appliedPresentationThinkingKeyRef.current = key;
		setThinkingLevel(presentation.thinkingLevel);
	}, [presentation.thinkingLevel, sessionMetadata.sessionId, setThinkingLevel]);

	const {
		addWorkspaceAttachment,
		browseProjectDirectories,
		clearUploadedAttachments,
		clearWorkspaceAttachments,
		createProject,
		deleteSessionForWorkspace,
		handleAttach,
		removeUploadedAttachment,
		removeWorkspaceAttachment,
		renameProject,
		restoreAttachments,
		resumeSessionForWorkspace,
		resumeSessionForWorkspaceWithResult,
		selectProject,
		startNewSessionForWorkspace,
		startNewSessionInProject,
		unregisterProject,
	} = useChatWorkspaceActions({
		activeProjectId,
		deleteSession,
		getSessionMetadata,
		refetchProjects,
		resumeSession,
		sessionId: sessionMetadata.sessionId,
		sessions,
		setActiveProjectId,
		setSelectedWorkspacePath,
		setUploadedAttachments,
		setWorkspaceAttachments,
		startNewSession,
		switchProject,
	});

	const infoDescription = queueLabel(queue) ?? activityLabel ?? planLabel;
	const skipPendingQuestion = useCallback(
		async ({ toolCallId, answer }: { toolCallId: string; answer: ChatQuestionAnswer }) => {
			const result = await answerQuestion({ toolCallId, answer });
			if (!result.ok) throw new Error(result.message ?? "Unable to skip the unsupported questionnaire.");
		},
		[answerQuestion],
	);
	const handleQuestionSkipError = useCallback(
		(error: unknown) => {
			stop();
			notifyChatError(error);
		},
		[stop],
	);
	useSkipPendingQuestion(messages, status, skipPendingQuestion, handleQuestionSkipError);
	const suggestions = useChatSuggestions({
		messages,
		resources,
		workspaceTree,
	});
	const shouldShowInputSuggestions = useMemo(() => {
		if (messages.length === 0) return false;
		if (status === "streaming" || status === "submitted") return false;

		const lastMessage = messages[messages.length - 1];
		if (lastMessage.role !== "assistant") return false;
		return true;
	}, [messages, status]);
	const inputSuggestionItems = useMemo(
		() => (shouldShowInputSuggestions ? suggestions : []),
		[shouldShowInputSuggestions, suggestions],
	);
	const slashCommands = useMemo(() => commandSuggestions(commandsData), [commandsData]);
	const workspaceReferenceSuggestions = useMemo(
		() => buildWorkspaceReferenceSuggestions(workspaceTree),
		[workspaceTree],
	);
	const openProjectPanelAction = useCallback(
		(action: Parameters<typeof openPanelAction>[0]) => {
			if (action.projectId && action.projectId !== activeProjectId) {
				notify.error("This panel action targets a different project.");
				return;
			}
			openPanelAction(action);
		},
		[activeProjectId, openPanelAction],
	);
	const openSidebarPanelAction = useCallback(
		(action: Parameters<typeof openPanelAction>[0]) => {
			if (!action.projectId || action.projectId === activeProjectId) {
				openPanelAction(action);
				return;
			}
			void selectProject(action.projectId)
				.then(() => openPanelAction(action))
				.catch((error) => notifyChatError(error));
		},
		[activeProjectId, openPanelAction, selectProject],
	);

	const openSettings = useCallback(
		(tab?: SettingsSectionId) => {
			setSettingsInitialTab(tab);
			setSettingsDialogOpen(true);
		},
		[setSettingsDialogOpen, setSettingsInitialTab],
	);
	const runRuntimeCommand = useCallback(
		(command: string, args: string) => {
			const name = canonicalCommandName(command);
			if (TUI_ONLY_COMMANDS.has(name) || TUI_ONLY_COMMANDS.has(command)) return true;
			if (name === "settings") {
				openSettings();
				return true;
			}
			if (name === "model") {
				setModelPickerOpen(true);
				return true;
			}
			if (name === "effort") {
				setEffortPickerOpen(true);
				return true;
			}
			if (name === "new") {
				void startNewSession();
				return true;
			}
			if (name === "openui") {
				if (args) {
					void sendMessage({ text: args, mode: chatMode, openUI: true, openUIArtifact: true });
				}
				return true;
			}
			if (isSessionTransportCommand(name)) return false;
			const sessionId = getSessionMetadata().sessionId;
			if (!sessionId) return false;
			void chatClient
				.runChatCommand({ sessionId, command: name, args })
				.then((payload) => {
					const message = typeof payload.message === "string" ? payload.message : `/${name} completed.`;
					appendLocalMessage(message);
				})
				.catch((error: unknown) => notifyChatError(error));
			return true;
		},
		[
			appendLocalMessage,
			chatMode,
			getSessionMetadata,
			openSettings,
			sendMessage,
			setEffortPickerOpen,
			setModelPickerOpen,
			startNewSession,
		],
	);
	const composerIntentAvailability = useComposerIntentAvailability();
	const {
		onDraftChange: onComposerDraftChange,
		takeCached: takeCachedIntent,
		command: offeredCommand,
		dismissCommand,
	} = useComposerIntentRouting(composerIntentAvailability.available);
	// History completions are local and need no opt-in; they never leave the
	// machine. A recognised command is coalesced over history in the host — the
	// history hook stays append-only.
	const { onDraftChange: onCompletionDraftChange, inlineCompletion: historyCompletion } = useComposerInlineCompletion({
		available: true,
		sessionId: sessionMetadata.sessionId,
	});

	const inlineCompletion = useMemo((): InlineCompletion | undefined => {
		if (offeredCommand) {
			return {
				forValue: offeredCommand.forValue,
				text: `/${offeredCommand.command}`,
				mode: "replace",
				onDismiss: () => {
					dismissCommand();
					historyCompletion?.onDismiss?.();
				},
			};
		}
		return historyCompletion;
	}, [dismissCommand, historyCompletion, offeredCommand]);

	// Both consumers share the composer's single debounced draft publication.
	const handleComposerDraftChange = useCallback(
		(text: string) => {
			onComposerDraftChange(text);
			onCompletionDraftChange(text);
		},
		[onComposerDraftChange, onCompletionDraftChange],
	);

	const handleLocalSlashSubmit = useCallback(
		(message: string) => {
			const parsed = parseSlashInput(message);
			if (parsed) return runRuntimeCommand(parsed.command, parsed.args);
			const intent = takeCachedIntent(message);
			if (!intent?.command || !isLocalUiCommand(intent.command)) return false;
			return runRuntimeCommand(intent.command, "");
		},
		[runRuntimeCommand, takeCachedIntent],
	);
	const handleSlashCommandSelect = useCallback(
		(item: { id: string; metadata?: Record<string, string | undefined>; value?: string }) => {
			if (commandInsertsPrefix(item)) return false;
			return runRuntimeCommand(item.id, "");
		},
		[runRuntimeCommand],
	);
	const forkFromEntry = useCallback(
		(entryId: string) => {
			runRuntimeCommand("fork", entryId);
		},
		[runRuntimeCommand],
	);

	const loadProjectWorkspaceFile = useCallback(
		(path: string, signal?: AbortSignal) => loadWorkspaceFile(path, activeProjectId, signal),
		[activeProjectId],
	);
	const loadSubagentSession = useCallback(
		(parentSessionId: string, childId: string) => chatClient.loadSubagentSession(parentSessionId, childId),
		[],
	);
	const agentTabs = useAgentTabs({
		activeProjectId,
		loadSubagentSession,
		presentation,
		rootSessionId: sessionMetadata.sessionId,
	});
	const sessionTree = useSessionTree({
		sessionMetadata: {
			sessionId: sessionMetadata.sessionId,
			projectId: sessionMetadata.projectId ?? activeProjectId,
		},
		status,
		resumeSession: resumeSessionForWorkspaceWithResult,
		rightPanel,
	});

	const settingsActions = useSettingsActions({
		activeProjectId,
		composerIntent: composerIntentAvailability,
		handleThemePreferenceChange,
		models,
		setModelKey,
		settings: settingsData ?? null,
		settingsDialogOpen: settingsDialogOpen || settingsDialogEverOpened,
		settingsError,
		settingsLoading,
		themePreference,
	});

	const header = useChatWorkspaceHeader({
		activeTabId: agentTabs.activeTabId,
		tabs: agentTabs.tabs,
		onCloseTab: agentTabs.closeTab,
		onNewSession: () => runWorkspaceAction(() => startNewSessionForWorkspace()),
		onSelectTab: agentTabs.selectTab,
		onOpenSettings: () => openSettings(),
	});

	const chatPanelData: RightPanelData = {
		activityLabel,
		artifactRuns: useThrottledWhileLive(artifactRuns, status, sessionMetadata.sessionId ?? ""),
		chatMode,
		loadSubagentSession,
		onOpenSubagentTab: agentTabs.openChildTab,
		selectedModelKey: modelKey,
		planLabel,
		presentation,
		queue,
		refreshResources,
		resources,
		resourcesError,
		resourcesLoading,
		reopenRightPanel,
		rightPanel,
		selectedArtifactId,
		openArtifact,
		sessionId: sessionMetadata.sessionId,
		setRightPanel,
		status,
		thinkingLevel,
		sessionTreeSnapshot: sessionTree.sessionTreeSnapshot,
		sessionTreeLoading: sessionTree.sessionTreeLoading,
		sessionTreeError: sessionTree.sessionTreeError,
		selectedSessionTreeEntryId: sessionTree.selectedSessionTreeEntryId,
		isSessionTreeStreaming: sessionTree.isSessionTreeStreaming,
		refreshSessionTree: () => void sessionTree.refreshSessionTree(),
		selectSessionTreeEntry: sessionTree.selectSessionTreeEntry,
		rewindSessionTree: sessionTree.rewindSessionTree,
		transcriptSummary: useThrottledTranscriptSummary(messages, status, sessionMetadata.sessionId ?? ""),
	};
	const workspacePanelData: WorkspacePanelData = {
		loadWorkspaceFile: loadProjectWorkspaceFile,
		refreshWorkspace,
		selectedWorkspacePath,
		setSelectedWorkspacePath,
		workspaceError,
		workspaceLoading,
		workspaceTree,
	};
	return {
		session: {
			activeSessionId: sessionMetadata.sessionId,
			activeProjectId,
			openPanelAction: openSidebarPanelAction,
			projects: projectsData?.projects ?? [],
			projectSessions: sessions,
			sessions,
			browseProjectDirectories,
			createProject,
			deleteSession: deleteSessionForWorkspace,
			renameProject,
			renameSession,
			resumeSession: resumeSessionForWorkspace,
			selectProject,
			startNewSession: startNewSessionForWorkspace,
			startNewSessionInProject,
			unregisterProject,
		},
		conversation: {
			activityLabel,
			answerQuestion,
			artifactRuns,
			deleteQueuedMessage,
			editQueuedMessage,
			error,
			highlightedTranscriptMessageId: sessionTree.highlightedTranscriptMessageId,
			messages,
			openArtifact,
			openPanelAction: openProjectPanelAction,
			persistOpenUIArtifact,
			presentation,
			queue,
			sendMessage,
			status,
			stop,
		},
		agentTabs,
		composer: {
			chatMode,
			clearUploadedAttachments,
			clearWorkspaceAttachments,
			effortPickerOpen,
			handleAttach,
			handleLocalSlashSubmit,
			handleSlashCommandSelect,
			infoDescription,
			inputSuggestionItems,
			inlineCompletion,
			onComposerDraftChange: handleComposerDraftChange,
			workspaceReferenceSuggestions,
			modelKey,
			modelPickerOpen,
			models,
			removeUploadedAttachment,
			removeWorkspaceAttachment,
			addWorkspaceAttachment,
			restoreAttachments,
			setChatMode,
			setEffortPickerOpen,
			setModelKey,
			setModelPickerOpen,
			setThinkingLevel,
			slashCommands,
			thinkingLevel,
			uploadedAttachments,
			workspaceAttachments,
		},
		panels: {
			chatPanelData,
			handleResourceCanvasResizeStart,
			handleResourceCanvasWidthChange,
			resourceCanvasWidth,
			rightPanel,
			setRightPanel,
			workspacePanelData,
		},
		dialogs: {
			settingsActions,
			settingsResources: { models, resources, resourcesLoading, resourcesError, refreshResources },
			commandPaletteOpen,
			forkFromEntry,
			forkPickerDialogEverOpened,
			forkPickerEntries,
			setCommandPaletteOpen,
			setForkPickerEntries,
			setSettingsDialogOpen,
			setSettingsInitialTab,
			settingsDialogEverOpened,
			settingsDialogOpen,
			settingsInitialTab,
		},
		chrome: {
			handleThemePreferenceChange,
			header,
			themePreference,
		},
	};
}
