import type { QuestionAnswer } from "@prime-agent/web-design/components/agents/question/question-prompt";
import type { ForkPickerEntry } from "@prime-agent/web-design/components/fleet-pi/chat/fork-picker-dialog";
import { notify } from "@prime-agent/web-design/lib/notify";
import { type ChatModelOption, queueLabel, toModelOption } from "@prime-agent/web-design/lib/pi/chat-helpers";
import type { ProjectId } from "@prime-agent/web-protocol";
import type {
	ChatMode,
	ChatPiSettingsUpdate,
	ChatSessionMetadata,
	ChatSettingsResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { UploadedAttachment, WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { useCallback, useEffect, useMemo, useState } from "react";
import { identifyAnalyticsUser } from "@/lib/analytics-stub";
import { useOptionalUser } from "@/lib/auth-stub";
import { chatClient } from "@/lib/pi/chat-client";
import {
	useChatCommands,
	useChatModelCatalog,
	useChatModels,
	useChatProjects,
	useChatProviders,
	useChatResources,
	useChatSettings,
	useDiscoverChatModels,
	useOAuthLoginProvider,
	useRemoveChatProvider,
	useUpdateChatProvider,
	useUpdateChatSettings,
	useWorkspaceTree,
} from "@/lib/pi/chat-queries";
import { assistantMessageHasPendingQuestion } from "@/lib/pi/question-pending";
import type { SettingsSlashTab } from "@/lib/pi/slash-commands";
import { buildSlashCommands } from "@/lib/pi/slash-commands";
import { useChatShellState } from "@/lib/pi/use-chat-shell-state";
import { useChatStorage } from "@/lib/pi/use-chat-storage";
import { useActiveSessionLabel, useChatSuggestions } from "@/lib/pi/use-chat-view";
import { useChatWorkspaceHeader } from "@/lib/pi/use-chat-workspace-header";
import { useLocalSlashActions } from "@/lib/pi/use-local-slash-actions";
import { usePendingQuestionBar } from "@/lib/pi/use-pending-question-bar";
import { usePiChat } from "@/lib/pi/use-pi-chat";
import { useResourceInstallRefresh } from "@/lib/pi/use-resource-install-refresh";
import { useRightPanelContextValue } from "@/lib/pi/use-right-panel-context-value";
import { buildWorkspaceReferenceSuggestions, workspacePathFromSuggestion } from "@/lib/pi/workspace-suggestions";
import { loadWorkspaceFile } from "@/lib/workspace-file";
import {
	shouldClearPendingAttachments,
	shouldClearPendingAttachmentsForNewSession,
} from "./pending-attachment-lifecycle";

function resolveSavedModelKey(models: Array<ChatModelOption>, response: ChatSettingsResponse): string | undefined {
	const { defaultProvider, defaultModel } = response.effective;
	return (
		models.find((model) => model.provider === defaultProvider && model.modelId === defaultModel)?.id ??
		(defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : undefined)
	);
}

export function useChatWorkspaceData() {
	const user = useOptionalUser();
	const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
	const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsSlashTab | undefined>(undefined);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [effortPickerOpen, setEffortPickerOpen] = useState(false);
	const [chatMode, setChatMode] = useState<ChatMode>("agent");
	const [uploadedAttachments, setUploadedAttachments] = useState<Array<UploadedAttachment>>([]);
	const [workspaceAttachments, setWorkspaceAttachments] = useState<Array<WorkspaceAttachment>>([]);
	const [forkPickerEntries, setForkPickerEntries] = useState<Array<ForkPickerEntry> | null>(null);
	const storage = useChatStorage();
	const [activeProjectId, setActiveProjectId] = useState<ProjectId | undefined>(
		storage.sessionMetadata.projectId ?? undefined,
	);

	useEffect(() => {
		if (user) identifyAnalyticsUser(user);
	}, [user]);
	const { data: providersData, isLoading: isLoadingProviders } = useChatProviders();
	const { data: projectsData, refetch: refetchProjects } = useChatProjects();
	const { mutateAsync: onUpdateProvider, isPending: isUpdatingProvider } = useUpdateChatProvider();
	const { mutateAsync: onOAuthLogin } = useOAuthLoginProvider();
	const { mutateAsync: onRemoveProvider, isPending: isRemovingProvider } = useRemoveChatProvider();
	const { data: modelsData } = useChatModels(activeProjectId);
	const { data: modelCatalogData } = useChatModelCatalog({
		enabled: settingsDialogOpen,
		projectId: activeProjectId,
	});
	const discoverModelsMutation = useDiscoverChatModels();
	const {
		commandPaletteOpen,
		handleResourceCanvasResizeStart,
		handleThemePreferenceChange,
		initialSessionMetadata,
		modelKey,
		modelSelection,
		models,
		openWorkspacePath,
		openPanelAction,
		persistSession,
		resourceCanvasWidth,
		rightPanel,
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
	const shouldLoadWorkspaceTree = true;
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
		deleteSession,
		error,
		getMessages,
		getSessionMetadata,
		messages,
		planLabel,
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
	const clearPendingAttachments = useCallback(() => {
		setUploadedAttachments([]);
		setWorkspaceAttachments([]);
	}, []);
	const startNewSessionForWorkspace = useCallback(
		async (options?: { projectId?: ProjectId; preserveRunning?: boolean }) => {
			const currentMetadata = getSessionMetadata();
			const targetProjectId = options?.projectId ?? activeProjectId;
			const currentWorkspaceMetadata = {
				...currentMetadata,
				projectId: currentMetadata.projectId ?? activeProjectId,
			};
			const shouldClear = shouldClearPendingAttachmentsForNewSession(currentWorkspaceMetadata, targetProjectId);
			await startNewSession(options);
			if (shouldClear) clearPendingAttachments();
		},
		[activeProjectId, clearPendingAttachments, getSessionMetadata, startNewSession],
	);
	const resumeSessionForWorkspaceWithResult = useCallback(
		async (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => {
			const currentMetadata = getSessionMetadata();
			const shouldClear = shouldClearPendingAttachments(currentMetadata, metadata);
			const resumed = await resumeSession(metadata, options);
			if (resumed && shouldClear) clearPendingAttachments();
			return resumed;
		},
		[clearPendingAttachments, getSessionMetadata, resumeSession],
	);
	const resumeSessionForWorkspace = useCallback(
		async (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => {
			await resumeSessionForWorkspaceWithResult(metadata, options);
		},
		[resumeSessionForWorkspaceWithResult],
	);

	const selectProject = useCallback(
		async (projectId: ProjectId) => {
			const targetSession = sessions
				.filter((session) => session.projectId === projectId)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
			const currentMetadata = getSessionMetadata();
			const shouldClear = shouldClearPendingAttachments(currentMetadata, {
				sessionId: targetSession?.sessionId,
				projectId,
			});
			setActiveProjectId(projectId);
			setSelectedWorkspacePath(null);
			const switched = await switchProject(projectId, targetSession?.sessionId);
			if (switched && shouldClear) clearPendingAttachments();
			await refetchProjects();
		},
		[clearPendingAttachments, getSessionMetadata, refetchProjects, setSelectedWorkspacePath, sessions, switchProject],
	);

	const startNewSessionInProject = useCallback(
		async (targetProjectId: ProjectId) => {
			setActiveProjectId(targetProjectId);
			setSelectedWorkspacePath(null);
			await startNewSessionForWorkspace({ projectId: targetProjectId });
			await refetchProjects();
		},
		[refetchProjects, setSelectedWorkspacePath, startNewSessionForWorkspace],
	);

	const deleteSessionForWorkspace = useCallback(
		async (sessionId: string) => {
			const deletingActiveSession = getSessionMetadata().sessionId === sessionId;
			await deleteSession(sessionId);
			if (deletingActiveSession) clearPendingAttachments();
		},
		[clearPendingAttachments, deleteSession, getSessionMetadata],
	);

	const createProject = useCallback(
		async (request: { path?: string; directoryToken?: string; name?: string }) => {
			const project = await chatClient.createProject(request);
			await refetchProjects();
			await selectProject(project.projectId);
		},
		[refetchProjects, selectProject],
	);

	const renameProject = useCallback(
		async (projectId: ProjectId, name: string) => {
			await chatClient.renameProject(projectId, name);
			await refetchProjects();
		},
		[refetchProjects],
	);

	const unregisterProject = useCallback(
		async (projectId: ProjectId) => {
			await chatClient.unregisterProject(projectId);
			const refreshed = await refetchProjects();
			if (activeProjectId === projectId) {
				const fallback = refreshed.data?.projects.find((project) => project.projectId !== projectId);
				if (fallback) await selectProject(fallback.projectId);
				else {
					setActiveProjectId(undefined);
					setSelectedWorkspacePath(null);
					const switched = await switchProject("", undefined);
					if (switched) clearPendingAttachments();
				}
			}
		},
		[
			activeProjectId,
			clearPendingAttachments,
			refetchProjects,
			selectProject,
			setSelectedWorkspacePath,
			switchProject,
		],
	);
	const browseProjectDirectories = useCallback(
		(input: { path?: string; token?: string }) => chatClient.browseProjectDirectories(input),
		[],
	);
	const forkSessionIntoProject = useCallback(
		async (sessionId: string, targetProjectId: ProjectId) => {
			await chatClient.forkSessionIntoProject(sessionId, targetProjectId);
			await refetchProjects();
		},
		[refetchProjects],
	);
	useEffect(() => {
		if (sessionMetadata.sessionId) void refetchProjects();
	}, [refetchProjects, sessionMetadata.sessionId]);

	useResourceInstallRefresh({
		messages,
		refreshResources,
		refreshWorkspace,
		sessionId: sessionMetadata.sessionId,
		shouldLoadWorkspaceTree,
		workspaceTree,
	});

	const infoDescription = queueLabel(queue) ?? activityLabel ?? planLabel;
	const handleAttach = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = "image/*,text/*,application/json,application/pdf";
		input.onchange = () => {
			void (async () => {
				const files = Array.from(input.files ?? []);
				if (files.length === 0) return;
				if (!getSessionMetadata().sessionId) await startNewSessionForWorkspace();
				const sessionId = getSessionMetadata().sessionId;
				if (!sessionId) throw new Error("Unable to create a session for attachments");
				const uploaded = await chatClient.uploadAttachments(sessionId, files);
				setUploadedAttachments((current) => [...current, ...uploaded]);
			})().catch((attachmentError) => {
				notify.error(attachmentError instanceof Error ? attachmentError.message : String(attachmentError));
			});
		};
		input.click();
	}, [getSessionMetadata, startNewSessionForWorkspace]);
	const removeUploadedAttachment = useCallback((attachmentId: string) => {
		setUploadedAttachments((current) => current.filter((attachment) => attachment.attachmentId !== attachmentId));
	}, []);
	const clearUploadedAttachments = useCallback(() => setUploadedAttachments([]), []);
	const clearWorkspaceAttachments = useCallback(() => setWorkspaceAttachments([]), []);
	const addWorkspaceAttachment = useCallback((item: Parameters<typeof workspacePathFromSuggestion>[0]) => {
		const relativePath = workspacePathFromSuggestion(item);
		if (!relativePath) return;
		setWorkspaceAttachments((current) => {
			if (current.some((attachment) => attachment.relativePath === relativePath)) return current;
			return [
				...current,
				{
					kind: "workspace",
					relativePath,
					name: relativePath.split("/").pop() || relativePath,
				},
			];
		});
	}, []);
	const removeWorkspaceAttachment = useCallback((relativePath: string) => {
		setWorkspaceAttachments((current) => current.filter((attachment) => attachment.relativePath !== relativePath));
	}, []);
	const handleQuestionAnswer = useCallback(
		({ toolCallId, answer }: { toolCallId?: string; answer: QuestionAnswer }) => {
			void answerQuestion({ toolCallId, answer }).catch((err) => {
				const message = err instanceof Error ? err.message : String(err);
				notify.error(message);
			});
		},
		[answerQuestion],
	);
	const pendingQuestionBar = usePendingQuestionBar({
		messages,
		answerQuestion: handleQuestionAnswer,
	});
	const activeSessionLabel = useActiveSessionLabel({
		activeSessionId: sessionMetadata.sessionId,
		messages,
		sessions,
	});
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

		return !assistantMessageHasPendingQuestion(lastMessage);
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

	const openSettings = useCallback((tab?: SettingsSlashTab) => {
		setSettingsInitialTab(tab);
		setSettingsDialogOpen(true);
	}, []);

	const { forkFromEntry, handleLocalSlashSubmit, handleSlashCommandSelect } = useLocalSlashActions({
		appendLocalMessage,
		getMessages,
		getSessionMetadata,
		modelKey,
		models,
		onForkPicker: setForkPickerEntries,
		openSettings,
		resumeSession: resumeSessionForWorkspace,
		sessions,
		setEffortPickerOpen,
		setModelKey,
		setModelPickerOpen,
		setThinkingLevel,
		startNewSession: startNewSessionForWorkspace,
	});

	const modelCatalog = useMemo(
		() => modelCatalogData?.models.map(toModelOption) ?? models,
		[modelCatalogData, models],
	);
	const loadProjectWorkspaceFile = useCallback(
		(path: string) => loadWorkspaceFile(path, activeProjectId),
		[activeProjectId],
	);

	const onDiscoverModels = useCallback(
		async (providerId: string) => {
			const response = await discoverModelsMutation.mutateAsync(providerId);
			return response.models.map(toModelOption);
		},
		[discoverModelsMutation],
	);

	const { chatPanelData, settingsActions, workspaceTreeContext } = useRightPanelContextValue({
		activityLabel,
		handleThemePreferenceChange,
		isLoadingProviders,
		isUpdatingProvider: isUpdatingProvider || isRemovingProvider,
		loadWorkspaceFile: loadProjectWorkspaceFile,
		modelKey,
		models,
		modelCatalog,
		onDiscoverModels,
		onOAuthLogin,
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
		settings: settingsData ?? null,
		settingsError,
		settingsLoading: settingsLoading || updateSettings.isPending,
		status,
		themePreference,
		workspaceError,
		workspaceLoading,
		workspaceTree,
	});

	const header = useChatWorkspaceHeader({
		activeSessionId: sessionMetadata.sessionId,
		activeSessionLabel,
		sessions,
		onNewSession: () => void startNewSessionForWorkspace(),
		onResumeSession: (metadata) => void resumeSessionForWorkspace(metadata),
		onOpenSettings: () => openSettings(),
	});

	return {
		activeSessionId: sessionMetadata.sessionId,
		activityLabel,
		activeProjectId,
		answerQuestion,
		chatMode,
		chatPanelData,
		commandPaletteOpen,
		deleteSession: deleteSessionForWorkspace,
		createProject,
		browseProjectDirectories,
		error,
		forkFromEntry,
		forkSessionIntoProject,
		forkPickerEntries,
		handleLocalSlashSubmit,
		handleQuestionAnswer,
		handleAttach,
		handleResourceCanvasResizeStart,
		handleSlashCommandSelect,
		handleThemePreferenceChange,
		header,
		infoDescription,
		inputSuggestionItems,
		workspaceReferenceSuggestions,
		messages,
		effortPickerOpen,
		modelKey,
		modelPickerOpen,
		models,
		openPanelAction: openProjectPanelAction,
		uploadedAttachments,
		workspaceAttachments,
		addWorkspaceAttachment,
		removeWorkspaceAttachment,
		clearWorkspaceAttachments,
		removeUploadedAttachment,
		projects: projectsData?.projects ?? [],
		projectSessions: sessions,
		selectProject,
		renameProject,
		unregisterProject,
		clearUploadedAttachments,
		pendingQuestionBar,
		resourceCanvasWidth,
		rightPanel,
		renameSession,
		resumeSession: resumeSessionForWorkspace,
		sendMessage,
		sessions,
		setForkPickerEntries,
		setChatMode,
		setCommandPaletteOpen,
		setEffortPickerOpen,
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
		startNewSession: startNewSessionForWorkspace,
		startNewSessionInProject,
		status,
		stop,
		themePreference,
		thinkingLevel,
		workspaceTreeContext,
	};
}
