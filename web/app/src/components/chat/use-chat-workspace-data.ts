import type { ProjectId } from "@prime-agent/web-protocol";
import type {
	ChatPiSettingsUpdate,
	ChatQuestionAnswer,
	ChatSettingsResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { derivePrimeAgentArtifactRuns } from "@/components/artifacts/prime-agent-artifacts";
import { chatClient } from "@/components/chat/chat-client";
import { notifyChatError, runWorkspaceAction } from "@/components/chat/chat-error-notify";
import { fetchJson } from "@/components/chat/chat-fetch";
import { type ChatModelOption, queueLabel, toModelOption } from "@/components/chat/chat-helpers";
import {
	useChatCommands,
	useChatMcpConnections,
	useChatModelCatalog,
	useChatModels,
	useChatProjects,
	useChatProviders,
	useChatResources,
	useChatSettings,
	useDiscoverChatModels,
	useMcpOAuth,
	useRemoveChatProvider,
	useRemoveMcpConnection,
	useUpdateChatProvider,
	useUpdateChatSettings,
	useUpdateMcpConnection,
	useWorkspaceTree,
} from "@/components/chat/chat-queries";
import { resolveChatApiUrl } from "@/components/chat/chat-runtime-url";
import { useChatWorkspaceComposerState } from "@/components/chat/composer/chat-input-bar-props";
import { useComposerInlineCompletion } from "@/components/chat/composer/composer-inline-completion";
import { useComposerIntentAvailability, useComposerIntentRouting } from "@/components/chat/composer/composer-intent";
import type { InlineCompletion } from "@/components/chat/composer/inline-completion";
import type { SettingsSlashTab } from "@/components/chat/composer/slash-commands";
import { buildSlashCommands } from "@/components/chat/composer/slash-commands";
import { buildWorkspaceReferenceSuggestions } from "@/components/chat/composer/workspace-suggestions";
import { useSkipPendingQuestion } from "@/components/chat/question/use-skip-pending-question";
import { useChatStorage } from "@/components/chat/use-chat-storage";
import { useChatSuggestions } from "@/components/chat/use-chat-view";
import { useChatWorkspaceActions } from "@/components/chat/use-chat-workspace-actions";
import { useLocalSlashActions } from "@/components/chat/use-local-slash-actions";
import { usePiChat } from "@/components/chat/use-pi-chat";
import { useChatWorkspaceHeader } from "@/components/layout/chat-header";
import { useChatWorkspaceDialogs } from "@/components/layout/chat-workspace-dialogs";
import { useChatShellState } from "@/components/layout/use-chat-shell-state";
import { useRightPanelContextValue } from "@/components/layout/use-right-panel-context-value";
import { useAgentTabs } from "@/components/sessions/use-agent-tabs";
import { useSessionTree } from "@/components/sessions/use-session-tree";
import { loadWorkspaceFile } from "@/components/workspace/workspace-file";
import { notify } from "@/lib/notify";

function resolveSavedModelKey(models: Array<ChatModelOption>, response: ChatSettingsResponse): string | undefined {
	const { defaultProvider, defaultModel } = response.effective;
	return (
		models.find((model) => model.provider === defaultProvider && model.modelId === defaultModel)?.id ??
		(defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : undefined)
	);
}

/**
 * Provides coordinated state, data, and actions for the chat workspace, including projects, sessions, conversations, attachments, panels, dialogs, and settings.
 */
export function useChatWorkspaceData() {
	const {
		forkPickerEntries,
		setForkPickerEntries,
		setSettingsDialogOpen,
		setSettingsInitialTab,
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
	const { data: providersData, isLoading: isLoadingProviders } = useChatProviders();
	const { data: mcpData, isLoading: isLoadingMcp } = useChatMcpConnections();
	const { data: projectsData, refetch: refetchProjects } = useChatProjects();
	const { mutateAsync: onUpdateProvider, isPending: isUpdatingProvider } = useUpdateChatProvider();
	const { mutateAsync: onRemoveProvider, isPending: isRemovingProvider } = useRemoveChatProvider();
	const { mutateAsync: onUpdateMcp, isPending: isUpdatingMcp } = useUpdateMcpConnection();
	const { mutateAsync: onRemoveMcp, isPending: isRemovingMcp } = useRemoveMcpConnection();
	const { mutateAsync: onMcpOAuth } = useMcpOAuth();
	const { data: modelsData } = useChatModels(activeProjectId);
	const { data: modelCatalogData } = useChatModelCatalog({
		enabled: settingsDialogOpen,
		projectId: activeProjectId,
	});
	const discoverModelsMutation = useDiscoverChatModels();
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
		openWorkspacePath,
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

	useEffect(() => {
		if (initialSessionMetadata.projectId && initialSessionMetadata.projectId !== activeProjectId) {
			setActiveProjectId(initialSessionMetadata.projectId);
			return;
		}
		if (!activeProjectId && projectsData?.projects[0]) {
			setActiveProjectId(projectsData.projects[0].projectId);
			persistSession({ projectId: projectsData.projects[0].projectId });
		}
	}, [activeProjectId, initialSessionMetadata.projectId, persistSession, projectsData?.projects]);

	const {
		data: resourcesData,
		isLoading: resourcesLoading,
		error: resourcesError,
		refetch: refetchResources,
	} = useChatResources(activeProjectId);
	const { data: commandsData } = useChatCommands(activeProjectId);
	const { data: settingsData, isLoading: settingsLoading, error: settingsError } = useChatSettings(activeProjectId);
	const updateSettings = useUpdateChatSettings();
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

	const saveSettings = useCallback(
		async (settings: ChatPiSettingsUpdate) => {
			const response = await updateSettings.mutateAsync({ request: { settings }, projectId: activeProjectId });
			const nextModelKey = resolveSavedModelKey(models, response);
			if (nextModelKey) setModelKey(nextModelKey);
			return response;
		},
		[activeProjectId, models, setModelKey, updateSettings],
	);

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
		getMessages,
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
	const slashCommands = useMemo(
		() => buildSlashCommands(resources, settingsData?.effective.enableSkillCommands ?? false, commandsData),
		[commandsData, resources, settingsData],
	);
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
		(tab?: SettingsSlashTab) => {
			setSettingsInitialTab(tab);
			setSettingsDialogOpen(true);
		},
		[setSettingsDialogOpen, setSettingsInitialTab],
	);
	const handleOpenUIRequest = useCallback(
		async (request: string) => {
			const attachments = [...workspaceAttachments, ...uploadedAttachments];
			clearUploadedAttachments();
			clearWorkspaceAttachments();
			const sent = await sendMessage({
				text: request,
				altKey: false,
				mode: chatMode,
				openUI: true,
				openUIArtifact: true,
				attachments,
			});
			if (!sent) restoreAttachments(uploadedAttachments, workspaceAttachments);
		},
		[
			chatMode,
			clearUploadedAttachments,
			clearWorkspaceAttachments,
			restoreAttachments,
			sendMessage,
			uploadedAttachments,
			workspaceAttachments,
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

	const { forkFromEntry, handleLocalSlashSubmit, handleSlashCommandSelect } = useLocalSlashActions({
		appendLocalMessage,
		getMessages,
		getSessionMetadata,
		modelKey,
		models,
		onForkPicker: setForkPickerEntries,
		onOpenUIRequest: handleOpenUIRequest,
		openSettings,
		resumeSession: resumeSessionForWorkspace,
		sessions,
		setEffortPickerOpen,
		setModelKey,
		setModelPickerOpen,
		setThinkingLevel,
		startNewSession: startNewSessionForWorkspace,
		takeCachedIntent,
	});

	const setComposerIntentEnabled = useCallback(
		async (enabled: boolean) => {
			try {
				await fetch(resolveChatApiUrl("/api/chat/intent"), {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ enabled }),
				});
			} finally {
				composerIntentAvailability.refresh();
			}
		},
		[composerIntentAvailability],
	);

	/**
	 * Stores the classifier key, or clears it with `null`.
	 *
	 * The key is write-only: it goes up and never comes back, and the refresh
	 * afterwards re-reads only whether a usable key exists and where it came from.
	 */
	const setComposerIntentKey = useCallback(
		async (apiKey: string | null) => {
			try {
				await fetchJson<{ success?: boolean }>("/api/chat/intent", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ apiKey }),
				});
			} finally {
				composerIntentAvailability.refresh();
			}
		},
		[composerIntentAvailability],
	);

	const modelCatalog = useMemo(
		() => modelCatalogData?.models.map(toModelOption) ?? models,
		[modelCatalogData, models],
	);
	const loadProjectWorkspaceFile = useCallback(
		(path: string, signal?: AbortSignal) => loadWorkspaceFile(path, activeProjectId, signal),
		[activeProjectId],
	);
	const loadChatSession = useCallback(
		(metadata: Parameters<typeof chatClient.loadSession>[0]) => chatClient.loadSession(metadata),
		[],
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

	const onDiscoverModels = useCallback(
		async (providerId: string) => {
			const response = await discoverModelsMutation.mutateAsync(providerId);
			return response.models.map(toModelOption);
		},
		[discoverModelsMutation],
	);
	const { chatPanelData, settingsActions, workspaceTreeContext } = useRightPanelContextValue({
		activityLabel,
		artifactRuns,
		chatMode,
		composerIntent: composerIntentAvailability,
		onComposerIntentChange: setComposerIntentEnabled,
		onComposerIntentKeyChange: setComposerIntentKey,
		handleThemePreferenceChange,
		isLoadingMcp,
		isLoadingProviders,
		isUpdatingMcp: isUpdatingMcp || isRemovingMcp,
		isUpdatingProvider: isUpdatingProvider || isRemovingProvider,
		loadSession: loadChatSession,
		loadSubagentSession,
		loadWorkspaceFile: loadProjectWorkspaceFile,
		messages,
		onOpenSubagentTab: agentTabs.openChildTab,
		modelKey,
		models,
		modelCatalog,
		onDiscoverModels,
		onMcpOAuth,
		onRemoveMcp,
		onRemoveProvider,
		onUpdateMcp,
		onUpdateProvider,
		openWorkspacePath,
		planLabel,
		presentation,
		mcpConnections: mcpData?.connections ?? [],
		providers: providersData?.providers ?? [],
		queue,
		refreshResources,
		refreshWorkspace,
		resources,
		resourcesError,
		resourcesLoading,
		reopenRightPanel,
		rightPanel,
		saveSettings,
		selectedArtifactId,
		sessionId: sessionMetadata.sessionId,
		selectedWorkspacePath,
		setRightPanel,
		setSelectedWorkspacePath,
		settings: settingsData ?? null,
		settingsError,
		settingsLoading: settingsLoading || updateSettings.isPending,
		status,
		thinkingLevel,
		themePreference,
		workspaceError,
		workspaceLoading,
		workspaceTree,
		sessionTreeSnapshot: sessionTree.sessionTreeSnapshot,
		sessionTreeLoading: sessionTree.sessionTreeLoading,
		sessionTreeError: sessionTree.sessionTreeError,
		selectedSessionTreeEntryId: sessionTree.selectedSessionTreeEntryId,
		isSessionTreeStreaming: sessionTree.isSessionTreeStreaming,
		refreshSessionTree: () => void sessionTree.refreshSessionTree(),
		selectSessionTreeEntry: sessionTree.selectSessionTreeEntry,
		rewindSessionTree: sessionTree.rewindSessionTree,
	});

	const header = useChatWorkspaceHeader({
		activeTabId: agentTabs.activeTabId,
		tabs: agentTabs.tabs,
		onCloseTab: agentTabs.closeTab,
		onNewSession: () => runWorkspaceAction(() => startNewSessionForWorkspace()),
		onSelectTab: agentTabs.selectTab,
		onOpenSettings: () => openSettings(),
	});

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
	};
}
