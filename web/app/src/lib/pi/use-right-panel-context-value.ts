import type {
	ChatPanelDataContextValue,
	SettingsActionsContextValue,
	WorkspaceTreeContextValue,
} from "@prime-agent/web-design/components/product/fleet-pi/layout/right-panel-context";
import type { RightPanel, ThemePreference } from "@prime-agent/web-design/lib/canvas-utils";
import type { ChatModelOption } from "@prime-agent/web-design/lib/pi/chat-helpers";
import type {
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
	isLoadingProviders?: boolean;
	isUpdatingProvider?: boolean;
	loadSession: (metadata: ChatSessionMetadata) => Promise<ChatSessionResponse>;
	loadSubagentSession: (parentSessionId: string, childId: string) => Promise<ChatSessionResponse>;
	loadWorkspaceFile: (path: string) => Promise<WorkspaceFileResponse>;
	messages: Array<ChatMessage>;
	modelKey?: string;
	models: Array<ChatModelOption>;
	modelCatalog?: Array<ChatModelOption>;
	onDiscoverModels?: (providerId: string) => Promise<Array<ChatModelOption>>;
	onOAuthLogin?: (request: ChatProviderOAuthLoginRequest) => Promise<ChatProviderOAuthLoginResponse>;
	onRemoveProvider?: (request: ChatProviderRemoveRequest) => Promise<ChatProviderRemoveResponse>;
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

export function useRightPanelContextValue({
	activityLabel,
	artifactRuns,
	chatMode,
	handleThemePreferenceChange,
	isLoadingProviders,
	isUpdatingProvider,
	loadSession,
	loadSubagentSession,
	loadWorkspaceFile,
	messages,
	modelKey,
	models,
	modelCatalog,
	onDiscoverModels,
	onOAuthLogin,
	onRemoveProvider,
	onUpdateProvider,
	openWorkspacePath,
	planLabel,
	presentation,
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
			isLoadingProviders,
			isUpdatingProvider,
			modelCatalog,
			onDiscoverModels,
			onOAuthLogin,
			onRemoveProvider,
			onThemePreferenceChange: handleThemePreferenceChange,
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
			isLoadingProviders,
			isUpdatingProvider,
			modelCatalog,
			onDiscoverModels,
			onOAuthLogin,
			onRemoveProvider,
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
