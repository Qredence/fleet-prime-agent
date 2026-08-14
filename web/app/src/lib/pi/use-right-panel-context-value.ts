import type {
	ChatPanelDataContextValue,
	SettingsActionsContextValue,
	WorkspaceTreeContextValue,
} from "@prime-agent/web-design/components/fleet-pi/layout/right-panel-context";
import type { RightPanel, ThemePreference } from "@prime-agent/web-design/lib/canvas-utils";
import type { ChatModelOption } from "@prime-agent/web-design/lib/pi/chat-helpers";
import type {
	ChatPiSettingsUpdate,
	ChatProviderInfo,
	ChatProviderOAuthLoginRequest,
	ChatProviderOAuthLoginResponse,
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
	ChatResourcesResponse,
	ChatSettingsResponse,
	QueueState,
	WorkspaceBrowseResponse,
	WorkspaceFileResponse,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { useMemo } from "react";

type UseRightPanelContextValueArgs = {
	activityLabel?: string;
	browseWorkspace: (path?: string) => Promise<WorkspaceBrowseResponse>;
	handleThemePreferenceChange: (preference: ThemePreference) => void;
	isLoadingProviders?: boolean;
	isUpdatingProvider?: boolean;
	loadWorkspaceFile: (path: string) => Promise<WorkspaceFileResponse>;
	modelKey?: string;
	models: Array<ChatModelOption>;
	modelCatalog?: Array<ChatModelOption>;
	onDiscoverModels?: (providerId: string) => Promise<Array<ChatModelOption>>;
	onOAuthLogin?: (request: ChatProviderOAuthLoginRequest) => Promise<ChatProviderOAuthLoginResponse>;
	onRemoveProvider?: (request: ChatProviderRemoveRequest) => Promise<ChatProviderRemoveResponse>;
	onUpdateProvider?: (request: ChatProviderUpdateRequest) => Promise<ChatProviderUpdateResponse>;
	openWorkspacePath: (rawPath: string) => void;
	planLabel?: string;
	providers?: Array<ChatProviderInfo>;
	queue: QueueState;
	refreshResources: () => void;
	refreshWorkspace: () => void;
	resources: ChatResourcesResponse | null;
	resourcesError: Error | null;
	resourcesLoading: boolean;
	rightPanel: RightPanel;
	saveSettings: (settings: ChatPiSettingsUpdate) => Promise<ChatSettingsResponse>;
	selectedWorkspacePath: string | null;
	setRightPanel: (panel: RightPanel) => void;
	setSelectedWorkspacePath: (path: string | null) => void;
	setWorkspaceRoot: (path: string) => Promise<void>;
	settings: ChatSettingsResponse | null;
	settingsError: Error | null;
	settingsLoading: boolean;
	status: ChatStatus;
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
	browseWorkspace,
	handleThemePreferenceChange,
	isLoadingProviders,
	isUpdatingProvider,
	loadWorkspaceFile,
	modelKey,
	models,
	modelCatalog,
	onDiscoverModels,
	onOAuthLogin,
	onRemoveProvider,
	onUpdateProvider,
	openWorkspacePath,
	planLabel,
	providers,
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
	setWorkspaceRoot,
	settings,
	settingsError,
	settingsLoading,
	status,
	themePreference,
	workspaceError,
	workspaceLoading,
	workspaceTree,
}: UseRightPanelContextValueArgs): RightPanelContextSlices {
	const chatPanelData = useMemo<ChatPanelDataContextValue>(
		() => ({
			activityLabel,
			models,
			planLabel,
			queue,
			refreshResources,
			resources,
			resourcesError,
			resourcesLoading,
			rightPanel,
			selectedModelKey: modelKey,
			setRightPanel,
			status,
		}),
		[
			activityLabel,
			models,
			planLabel,
			queue,
			refreshResources,
			resources,
			resourcesError,
			resourcesLoading,
			rightPanel,
			modelKey,
			setRightPanel,
			status,
		],
	);

	const workspaceTreeContext = useMemo<WorkspaceTreeContextValue>(
		() => ({
			browseWorkspace,
			loadWorkspaceFile,
			openWorkspacePath,
			refreshWorkspace,
			selectedWorkspacePath,
			setSelectedWorkspacePath,
			setWorkspaceRoot,
			workspaceError,
			workspaceLoading,
			workspaceTree,
		}),
		[
			browseWorkspace,
			loadWorkspaceFile,
			openWorkspacePath,
			refreshWorkspace,
			selectedWorkspacePath,
			setSelectedWorkspacePath,
			setWorkspaceRoot,
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
