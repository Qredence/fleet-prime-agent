import type { ProjectId } from "@prime-agent/web-protocol";
import type {
	McpConnectionInfo,
	ChatMcpOAuthLoginRequest,
	ChatMcpOAuthLoginResponse,
	ChatMcpDeleteRequest,
	ChatMcpListResponse,
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatMcpUpsertRequest,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
	ChatProviderInfo,
	ChatPiSettingsUpdate,
	ChatSettingsResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ComposerIntentKeySource, ComposerIntentStatus } from "@prime-agent/web-protocol/composer-intent";
import { useCallback, useMemo } from "react";
import { fetchJson } from "@/lib/chat/chat-fetch";
import { type ChatModelOption, toModelOption } from "@/lib/chat/chat-helpers";
import type { ThemePreference } from "@/lib/layout/canvas-utils";
import type { ComposerIntentAvailability } from "@/hooks/chat/composer-assistance";
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

export type SettingsActions = {
	composerIntent?: { enabled: boolean; keySource: ComposerIntentKeySource; status: ComposerIntentStatus };
	isLoadingMcp?: boolean;
	isLoadingProviders?: boolean;
	isUpdatingMcp?: boolean;
	isUpdatingProvider?: boolean;
	mcpConnections?: Array<McpConnectionInfo>;
	modelCatalog?: Array<ChatModelOption>;
	onDiscoverModels?: (providerId: string) => Promise<Array<ChatModelOption>>;
	onMcpOAuth?: (request: ChatMcpOAuthLoginRequest) => Promise<ChatMcpOAuthLoginResponse>;
	onRemoveMcp?: (request: ChatMcpDeleteRequest) => Promise<ChatMcpListResponse>;
	onRemoveProvider?: (request: ChatProviderRemoveRequest) => Promise<ChatProviderRemoveResponse>;
	onComposerIntentChange?: (enabled: boolean) => Promise<void> | void;
	/** Stores the classifier key, or clears it with `null`. Write-only. */
	onComposerIntentKeyChange?: (apiKey: string | null) => Promise<void> | void;
	onThemePreferenceChange: (preference: ThemePreference) => void;
	onUpdateMcp?: (request: ChatMcpUpsertRequest) => Promise<ChatMcpListResponse>;
	onUpdateProvider?: (request: ChatProviderUpdateRequest) => Promise<ChatProviderUpdateResponse>;
	providers?: Array<ChatProviderInfo>;
	saveSettings: (settings: ChatPiSettingsUpdate, scope?: "global" | "project") => Promise<ChatSettingsResponse>;
	settings: ChatSettingsResponse | null;
	settingsError: Error | null;
	settingsLoading: boolean;
	themePreference: ThemePreference;
};

function resolveSavedModelKey(models: Array<ChatModelOption>, response: ChatSettingsResponse): string | undefined {
	const { defaultProvider, defaultModel } = response.effective;
	return (
		models.find((model) => model.provider === defaultProvider && model.modelId === defaultModel)?.id ??
		(defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : undefined)
	);
}

export function useSettingsActions({
	activeProjectId,
	composerIntent,
	handleThemePreferenceChange,
	models,
	setModelKey,
	settings,
	settingsDialogOpen = false,
	settingsError,
	settingsLoading,
	themePreference,
}: {
	activeProjectId?: ProjectId;
	composerIntent?: ComposerIntentAvailability & { refresh?: () => void };
	handleThemePreferenceChange: (preference: ThemePreference) => void;
	models: Array<ChatModelOption>;
	setModelKey: (key: string) => void;
	settings: ChatSettingsResponse | null;
	settingsDialogOpen?: boolean;
	settingsError: Error | null;
	settingsLoading: boolean;
	themePreference: ThemePreference;
}): SettingsActions {
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
		async (nextSettings: ChatPiSettingsUpdate, scope?: "global" | "project") => {
			const response = await updateSettings.mutateAsync({
				request: { settings: nextSettings, scope },
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

	return useMemo<SettingsActions>(
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
}
