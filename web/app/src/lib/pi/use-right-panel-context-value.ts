import type {
	ChatPanelDataContextValue,
	SettingsActionsContextValue,
	WorkspaceTreeContextValue,
} from "@prime-agent/web-design/components/product/fleet-pi/layout/right-panel-context";
import type { RightPanel, ThemePreference } from "@prime-agent/web-design/lib/canvas-utils";
import type { ChatModelOption } from "@prime-agent/web-design/lib/pi/chat-helpers";
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
	WorkspaceFileResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useMemo } from "react";

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
}: UseRightPanelContextValueArgs): RightPanelContextSlices {
	const chatPanelData = useMemo<ChatPanelDataContextValue>(
		() => ({
			activityLabel,
			artifactRuns,
			chatMode,
			loadSession,
			loadSubagentSession,
			messages,
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
		}),
		[
			activityLabel,
			artifactRuns,
			chatMode,
			loadSession,
			loadSubagentSession,
			messages,
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
			isLoadingMcp,
			isLoadingProviders,
			isUpdatingMcp,
			isUpdatingProvider,
			mcpConnections,
			modelCatalog,
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
			handleThemePreferenceChange,
			isLoadingMcp,
			isLoadingProviders,
			isUpdatingMcp,
			isUpdatingProvider,
			mcpConnections,
			modelCatalog,
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
