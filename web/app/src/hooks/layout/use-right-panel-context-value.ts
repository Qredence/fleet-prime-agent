import type { ProjectId } from "@prime-agent/web-protocol";
import type {
	ChatMode,
	ChatPiSettingsUpdate,
	ChatResourcesResponse,
	ChatSessionMetadata,
	ChatSessionResponse,
	ChatSettingsResponse,
	ChatThinkingLevel,
	PrimeAgentArtifactRun,
	PrimeAgentSessionPresentation,
	QueueState,
	SessionTreeSnapshot,
	WorkspaceFileResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useCallback, useMemo } from "react";
import { fetchJson } from "@/lib/chat/chat-fetch";
import { type ChatModelOption, toModelOption } from "@/lib/chat/chat-helpers";
import {
	useChatMcpConnections,
	useChatModelCatalog,
	useChatProviders,
	useDiscoverChatModels,
	useMcpOAuth,
	useRemoveChatProvider,
	useRemoveMcpConnection,
	useUpdateChatProvider,
	useUpdateChatSettings,
	useUpdateMcpConnection,
} from "@/hooks/chat/chat-queries";
import type { ComposerIntentAvailability } from "@/hooks/chat/composer-assistance";
import { useThrottledTranscriptSummary, useThrottledWhileLive } from "@/hooks/chat/use-throttled-transcript-summary";
import type {
	ChatPanelDataContextValue,
	SettingsActionsContextValue,
	WorkspaceTreeContextValue,
} from "@/components/layout/right-panel-context";
import type { RightPanel, ThemePreference } from "@/lib/layout/canvas-utils";

function resolveSavedModelKey(models: Array<ChatModelOption>, response: ChatSettingsResponse): string | undefined {
	const { defaultProvider, defaultModel } = response.effective;
	return (
		models.find((model) => model.provider === defaultProvider && model.modelId === defaultModel)?.id ??
		(defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : undefined)
	);
}

type UseRightPanelContextValueArgs = {
	activeProjectId?: ProjectId;
	activityLabel?: string;
	artifactRuns: Array<PrimeAgentArtifactRun>;
	chatMode: ChatMode;
	handleThemePreferenceChange: (preference: ThemePreference) => void;
	loadSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>;
	loadSubagentSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>;
	loadWorkspaceFile: (path: string, signal?: AbortSignal) => Promise<WorkspaceFileResponse>;
	messages: Array<ChatMessage>;
	onOpenSubagentTab?: (childId: string) => void;
	modelKey?: string;
	models: Array<ChatModelOption>;
	setModelKey: (key: string) => void;
	openWorkspacePath: (rawPath: string) => void;
	planLabel?: string;
	presentation: PrimeAgentSessionPresentation;
	/** Composer command-routing availability, for the Settings toggle. */
	composerIntent?: ComposerIntentAvailability & { refresh?: () => void };
	queue: QueueState;
	refreshResources: () => void;
	refreshWorkspace: () => void;
	resources: ChatResourcesResponse | null;
	resourcesError: Error | null;
	resourcesLoading: boolean;
	rightPanel: RightPanel;
	reopenRightPanel: () => void;
	selectedArtifactId?: string | null;
	openArtifact?: ChatPanelDataContextValue["openArtifact"];
	sessionId?: string;
	selectedWorkspacePath: string | null;
	setRightPanel: (panel: RightPanel) => void;
	setSelectedWorkspacePath: (path: string | null) => void;
	settings: ChatSettingsResponse | null;
	settingsDialogOpen?: boolean;
	settingsError: Error | null;
	settingsLoading: boolean;
	status: ChatStatus;
	thinkingLevel?: ChatThinkingLevel;
	themePreference: ThemePreference;
	workspaceError: Error | null;
	workspaceLoading: boolean;
	workspaceTree: WorkspaceTreeResponse | null;
	sessionTreeSnapshot: SessionTreeSnapshot | null;
	sessionTreeLoading: boolean;
	sessionTreeError: string | null;
	selectedSessionTreeEntryId: string | null;
	isSessionTreeStreaming: boolean;
	refreshSessionTree: () => void;
	selectSessionTreeEntry: (entryId: string, messageId?: string) => void;
	rewindSessionTree: (entryId: string, expectedLeafId: string | null) => Promise<void>;
};

type RightPanelContextSlices = {
	chatPanelData: ChatPanelDataContextValue;
	settingsActions: SettingsActionsContextValue;
	workspaceTreeContext: WorkspaceTreeContextValue;
};

/**
 * Assembles the memoized context values used by the right panel and settings dialog.
 *
 * @returns The chat panel, workspace tree, and settings action context slices
 */
export function useRightPanelContextValue({
	activeProjectId,
	activityLabel,
	artifactRuns,
	chatMode,
	composerIntent,
	handleThemePreferenceChange,
	loadSession,
	loadSubagentSession,
	loadWorkspaceFile,
	messages,
	onOpenSubagentTab,
	modelKey,
	models,
	setModelKey,
	openWorkspacePath,
	planLabel,
	presentation,
	queue,
	refreshResources,
	refreshWorkspace,
	resources,
	resourcesError,
	resourcesLoading,
	rightPanel,
	reopenRightPanel,
	selectedArtifactId,
	openArtifact,
	sessionId,
	selectedWorkspacePath,
	setRightPanel,
	setSelectedWorkspacePath,
	settings,
	settingsDialogOpen = false,
	settingsError,
	settingsLoading,
	status,
	thinkingLevel,
	themePreference,
	workspaceError,
	workspaceLoading,
	workspaceTree,
	sessionTreeSnapshot,
	sessionTreeLoading,
	sessionTreeError,
	selectedSessionTreeEntryId,
	isSessionTreeStreaming,
	refreshSessionTree,
	selectSessionTreeEntry,
	rewindSessionTree,
}: UseRightPanelContextValueArgs): RightPanelContextSlices {
	const { data: providersData, isLoading: isLoadingProviders } = useChatProviders({
		enabled: settingsDialogOpen,
	});
	const { data: mcpData, isLoading: isLoadingMcp } = useChatMcpConnections({
		enabled: settingsDialogOpen,
	});
	const { mutateAsync: onUpdateProvider, isPending: isUpdatingProvider } = useUpdateChatProvider();
	const { mutateAsync: onRemoveProvider, isPending: isRemovingProvider } = useRemoveChatProvider();
	const { mutateAsync: onUpdateMcp, isPending: isUpdatingMcp } = useUpdateMcpConnection();
	const { mutateAsync: onRemoveMcp, isPending: isRemovingMcp } = useRemoveMcpConnection();
	const { mutateAsync: onMcpOAuth } = useMcpOAuth();
	const { data: modelCatalogData } = useChatModelCatalog({
		enabled: settingsDialogOpen,
		projectId: activeProjectId,
	});
	const discoverModelsMutation = useDiscoverChatModels();
	const updateSettings = useUpdateChatSettings();

	const saveSettings = useCallback(
		async (nextSettings: ChatPiSettingsUpdate) => {
			const response = await updateSettings.mutateAsync({
				request: { settings: nextSettings },
				projectId: activeProjectId,
			});
			const nextModelKey = resolveSavedModelKey(models, response);
			if (nextModelKey) setModelKey(nextModelKey);
			return response;
		},
		[activeProjectId, models, setModelKey, updateSettings],
	);

	const onDiscoverModels = useCallback(
		async (providerId: string) => {
			const response = await discoverModelsMutation.mutateAsync(providerId);
			if (response.error) throw new Error(response.error);
			return response.models.map(toModelOption);
		},
		[discoverModelsMutation],
	);

	const onComposerIntentChange = useCallback(
		async (enabled: boolean) => {
			try {
				await fetchJson<{ success?: boolean }>("/api/chat/intent", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ enabled }),
				});
			} finally {
				composerIntent?.refresh?.();
			}
		},
		[composerIntent],
	);

	const onComposerIntentKeyChange = useCallback(
		async (apiKey: string | null) => {
			try {
				await fetchJson<{ success?: boolean }>("/api/chat/intent", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ apiKey }),
				});
			} finally {
				composerIntent?.refresh?.();
			}
		},
		[composerIntent],
	);

	const modelCatalog = useMemo(
		() => modelCatalogData?.models.map(toModelOption) ?? models,
		[modelCatalogData, models],
	);
	const mcpConnections = useMemo(() => mcpData?.connections ?? [], [mcpData?.connections]);
	const providers = useMemo(() => providersData?.providers ?? [], [providersData?.providers]);
	const isUpdatingMcpCombined = isUpdatingMcp || isRemovingMcp;
	const isUpdatingProviderCombined = isUpdatingProvider || isRemovingProvider;
	const settingsLoadingCombined = settingsLoading || updateSettings.isPending;

	const transcriptSummary = useThrottledTranscriptSummary(messages, status, sessionId ?? "");
	const publishedArtifactRuns = useThrottledWhileLive(artifactRuns, status, sessionId ?? "");
	const chatPanelData = useMemo<ChatPanelDataContextValue>(
		() => ({
			activityLabel,
			artifactRuns: publishedArtifactRuns,
			chatMode,
			loadSession,
			loadSubagentSession,
			transcriptSummary,
			onOpenSubagentTab,
			models,
			planLabel,
			presentation,
			queue,
			refreshResources,
			resources,
			resourcesError,
			resourcesLoading,
			reopenRightPanel,
			rightPanel,
			selectedModelKey: modelKey,
			selectedArtifactId,
			openArtifact,
			sessionId,
			setRightPanel,
			status,
			thinkingLevel,
			sessionTreeSnapshot,
			sessionTreeLoading,
			sessionTreeError,
			selectedSessionTreeEntryId,
			isSessionTreeStreaming,
			refreshSessionTree,
			selectSessionTreeEntry,
			rewindSessionTree,
		}),
		[
			activityLabel,
			publishedArtifactRuns,
			chatMode,
			loadSession,
			loadSubagentSession,
			transcriptSummary,
			onOpenSubagentTab,
			models,
			planLabel,
			presentation,
			queue,
			refreshResources,
			resources,
			resourcesError,
			resourcesLoading,
			reopenRightPanel,
			rightPanel,
			modelKey,
			selectedArtifactId,
			openArtifact,
			sessionId,
			setRightPanel,
			status,
			thinkingLevel,
			sessionTreeSnapshot,
			sessionTreeLoading,
			sessionTreeError,
			selectedSessionTreeEntryId,
			isSessionTreeStreaming,
			refreshSessionTree,
			selectSessionTreeEntry,
			rewindSessionTree,
		],
	);

	const workspaceTreeContext = useMemo<WorkspaceTreeContextValue>(
		() => ({
			loadWorkspaceFile,
			openWorkspacePath,
			refreshWorkspace,
			selectedWorkspacePath,
			setSelectedWorkspacePath,
			workspaceError,
			workspaceLoading,
			workspaceTree,
		}),
		[
			loadWorkspaceFile,
			openWorkspacePath,
			refreshWorkspace,
			selectedWorkspacePath,
			setSelectedWorkspacePath,
			workspaceError,
			workspaceLoading,
			workspaceTree,
		],
	);

	const settingsActions = useMemo<SettingsActionsContextValue>(
		() => ({
			composerIntent: composerIntent
				? {
						enabled: composerIntent.enabled,
						keySource: composerIntent.keySource,
						// "loading" is a browser-only state; the Settings row shows
						// "checking" until the first probe resolves.
						status: composerIntent.status === "loading" ? "unverified" : composerIntent.status,
					}
				: undefined,
			isLoadingMcp,
			isLoadingProviders,
			isUpdatingMcp: isUpdatingMcpCombined,
			isUpdatingProvider: isUpdatingProviderCombined,
			mcpConnections,
			modelCatalog,
			onComposerIntentChange,
			onComposerIntentKeyChange,
			onDiscoverModels,
			onMcpOAuth,
			onRemoveMcp,
			onRemoveProvider,
			onThemePreferenceChange: handleThemePreferenceChange,
			onUpdateMcp,
			onUpdateProvider,
			providers,
			saveSettings,
			settings,
			settingsError,
			settingsLoading: settingsLoadingCombined,
			themePreference,
		}),
		[
			composerIntent,
			handleThemePreferenceChange,
			isLoadingMcp,
			isLoadingProviders,
			isUpdatingMcpCombined,
			isUpdatingProviderCombined,
			mcpConnections,
			modelCatalog,
			onComposerIntentChange,
			onComposerIntentKeyChange,
			onDiscoverModels,
			onMcpOAuth,
			onRemoveMcp,
			onRemoveProvider,
			onUpdateMcp,
			onUpdateProvider,
			providers,
			saveSettings,
			settings,
			settingsError,
			settingsLoadingCombined,
			themePreference,
		],
	);

	return { chatPanelData, settingsActions, workspaceTreeContext };
}
