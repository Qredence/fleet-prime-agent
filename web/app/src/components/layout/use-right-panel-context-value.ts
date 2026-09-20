import type {
	ChatMcpDeleteRequest,
	ChatMcpListResponse,
	ChatMcpOAuthLoginRequest,
	ChatMcpOAuthLoginResponse,
	ChatMcpUpsertRequest,
	ChatMode,
	ChatPiSettingsUpdate,
	ChatProviderInfo,
	ChatProviderOAuthLoginRequest,
	ChatProviderOAuthLoginResponse,
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
	ChatResourcesResponse,
	ChatSessionMetadata,
	ChatSessionResponse,
	ChatSettingsResponse,
	ChatThinkingLevel,
	McpConnectionInfo,
	PrimeAgentArtifactRun,
	PrimeAgentSessionPresentation,
	QueueState,
	SessionTreeSnapshot,
	WorkspaceFileResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useMemo } from "react";
import type { ChatModelOption } from "@/components/chat/chat-helpers";
import type { ComposerIntentAvailability } from "@/components/chat/composer/composer-intent";
import {
	useThrottledTranscriptSummary,
	useThrottledWhileLive,
} from "@/components/chat/transcript/use-throttled-transcript-summary";
import type { RightPanel, ThemePreference } from "@/components/layout/canvas-utils";
import type {
	ChatPanelDataContextValue,
	SettingsActionsContextValue,
	WorkspaceTreeContextValue,
} from "@/components/layout/right-panel-context";

type UseRightPanelContextValueArgs = {
	activityLabel?: string;
	artifactRuns: Array<PrimeAgentArtifactRun>;
	chatMode: ChatMode;
	handleThemePreferenceChange: (preference: ThemePreference) => void;
	isLoadingMcp?: boolean;
	isLoadingProviders?: boolean;
	isUpdatingMcp?: boolean;
	isUpdatingProvider?: boolean;
	loadSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>;
	loadSubagentSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>;
	loadWorkspaceFile: (path: string, signal?: AbortSignal) => Promise<WorkspaceFileResponse>;
	messages: Array<ChatMessage>;
	onOpenSubagentTab?: (childId: string) => void;
	modelKey?: string;
	models: Array<ChatModelOption>;
	mcpConnections?: Array<McpConnectionInfo>;
	modelCatalog?: Array<ChatModelOption>;
	onDiscoverModels?: (providerId: string) => Promise<Array<ChatModelOption>>;
	onMcpOAuth?: (request: ChatMcpOAuthLoginRequest) => Promise<ChatMcpOAuthLoginResponse>;
	onOAuthLogin?: (request: ChatProviderOAuthLoginRequest) => Promise<ChatProviderOAuthLoginResponse>;
	onRemoveMcp?: (request: ChatMcpDeleteRequest) => Promise<ChatMcpListResponse>;
	onRemoveProvider?: (request: ChatProviderRemoveRequest) => Promise<ChatProviderRemoveResponse>;
	onUpdateMcp?: (request: ChatMcpUpsertRequest) => Promise<ChatMcpListResponse>;
	onUpdateProvider?: (request: ChatProviderUpdateRequest) => Promise<ChatProviderUpdateResponse>;
	openWorkspacePath: (rawPath: string) => void;
	planLabel?: string;
	presentation: PrimeAgentSessionPresentation;
	providers?: Array<ChatProviderInfo>;
	/** Composer command-routing availability, for the Settings toggle. */
	composerIntent?: ComposerIntentAvailability;
	onComposerIntentChange?: (enabled: boolean) => void;
	/** Stores the classifier key, or clears it with `null`. */
	onComposerIntentKeyChange?: (apiKey: string | null) => Promise<void> | void;
	queue: QueueState;
	refreshResources: () => void;
	refreshWorkspace: () => void;
	resources: ChatResourcesResponse | null;
	resourcesError: Error | null;
	resourcesLoading: boolean;
	rightPanel: RightPanel;
	reopenRightPanel: () => void;
	saveSettings: (settings: ChatPiSettingsUpdate) => Promise<ChatSettingsResponse>;
	selectedArtifactId?: string | null;
	sessionId?: string;
	selectedWorkspacePath: string | null;
	setRightPanel: (panel: RightPanel) => void;
	setSelectedWorkspacePath: (path: string | null) => void;
	settings: ChatSettingsResponse | null;
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
 * Assembles the memoized context values used by the right panel.
 *
 * @returns The chat panel, workspace tree, and settings action context slices
 */
export function useRightPanelContextValue({
	activityLabel,
	artifactRuns,
	chatMode,
	composerIntent,
	onComposerIntentChange,
	onComposerIntentKeyChange,
	handleThemePreferenceChange,
	isLoadingMcp,
	isLoadingProviders,
	isUpdatingMcp,
	isUpdatingProvider,
	loadSession,
	loadSubagentSession,
	loadWorkspaceFile,
	messages,
	onOpenSubagentTab,
	modelKey,
	models,
	modelCatalog,
	onDiscoverModels,
	onMcpOAuth,
	onOAuthLogin,
	onRemoveMcp,
	onRemoveProvider,
	onUpdateMcp,
	onUpdateProvider,
	openWorkspacePath,
	planLabel,
	presentation,
	mcpConnections,
	providers,
	queue,
	refreshResources,
	refreshWorkspace,
	resources,
	resourcesError,
	resourcesLoading,
	rightPanel,
	reopenRightPanel,
	saveSettings,
	selectedArtifactId,
	sessionId,
	selectedWorkspacePath,
	setRightPanel,
	setSelectedWorkspacePath,
	settings,
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
			isUpdatingMcp,
			isUpdatingProvider,
			mcpConnections,
			modelCatalog,
			onComposerIntentChange,
			onComposerIntentKeyChange,
			onDiscoverModels,
			onMcpOAuth,
			onOAuthLogin,
			onRemoveMcp,
			onRemoveProvider,
			onThemePreferenceChange: handleThemePreferenceChange,
			onUpdateMcp,
			onUpdateProvider,
			providers,
			saveSettings,
			settings,
			settingsError,
			settingsLoading,
			themePreference,
		}),
		[
			composerIntent,
			handleThemePreferenceChange,
			isLoadingMcp,
			isLoadingProviders,
			isUpdatingMcp,
			isUpdatingProvider,
			mcpConnections,
			modelCatalog,
			onComposerIntentChange,
			onComposerIntentKeyChange,
			onDiscoverModels,
			onMcpOAuth,
			onOAuthLogin,
			onRemoveMcp,
			onRemoveProvider,
			onUpdateMcp,
			onUpdateProvider,
			providers,
			saveSettings,
			settings,
			settingsError,
			settingsLoading,
			themePreference,
		],
	);

	return { chatPanelData, settingsActions, workspaceTreeContext };
}
