import type {
	ChatProviderInfo,
	ChatProviderRemoveRequest,
	ChatProviderRemoveResponse,
	ChatProviderUpdateRequest,
	ChatProviderUpdateResponse,
	PiCustomProviderApi,
} from "@prime-agent/web-protocol/chat-protocol";
import {
	isCustomProviderId,
	isNamedOccInstanceId,
	isOccProviderId,
	OPENAI_CHAT_COMPLETIONS_PROVIDER_ID,
} from "@prime-agent/web-protocol/provider-catalog";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { isOAuthProvider, supportsOAuth } from "./provider-credentials-types";

export type UseProviderCredentialsControllerArgs = {
	onRemoveProvider?: (request: ChatProviderRemoveRequest) => Promise<ChatProviderRemoveResponse>;
	onUpdateProvider?: (request: ChatProviderUpdateRequest) => Promise<ChatProviderUpdateResponse>;
	providers: Array<ChatProviderInfo>;
};

/**
 * Template picker id for a brand-new general custom provider. It is not a
 * catalog provider — selecting it opens the custom-provider editor, and the
 * save request carries `createOccInstance: true` so the server allocates a
 * fresh `custom+<slug>` id.
 */
export const CUSTOM_PROVIDER_PICKER_ID = "custom";

const CUSTOM_PROVIDER_PICKER_ROW: ChatProviderInfo = {
	id: CUSTOM_PROVIDER_PICKER_ID,
	name: "Custom provider",
	isConfigured: false,
	envVarName: "CUSTOM_PROVIDER_API_KEY",
	displayName: "Custom provider",
};

/** Splits a comma-separated model id list into trimmed, non-empty ids. */
export function parseCustomProviderModels(raw: string): Array<string> {
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

export function useProviderCredentialsController({
	onRemoveProvider,
	onUpdateProvider,
	providers,
}: UseProviderCredentialsControllerArgs) {
	const [editingProvider, setEditingProvider] = useState<string | null>(null);
	const [editingIsNewOccInstance, setEditingIsNewOccInstance] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [modelId, setModelId] = useState("");
	const [models, setModels] = useState("");
	const [api, setApi] = useState<PiCustomProviderApi>("openai-completions");
	const [displayName, setDisplayName] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [attemptedSave, setAttemptedSave] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [addPickerOpen, setAddPickerOpen] = useState(false);
	const [addPickerQuery, setAddPickerQuery] = useState("");
	const [confirmRemoveProvider, setConfirmRemoveProvider] = useState<ChatProviderInfo | null>(null);

	// Named OCC instances (`openai-chat-completions+…`), general custom
	// providers (`custom+…`), the custom-provider template row, AND every
	// provider prime-agent's ModelRegistry reports (including built-ins and
	// models.json-defined custom providers like `modal`) are editable
	// credential entries. The server route (/api/chat/providers) is now fully
	// prime-agent-driven — anything it emits is a valid prime provider, so we
	// trust it wholesale rather than intersecting with a static catalog.
	const credentialProviders = useMemo(() => {
		const rows = providers.filter((provider) => provider.id !== CUSTOM_PROVIDER_PICKER_ROW.id);
		return [...rows, CUSTOM_PROVIDER_PICKER_ROW];
	}, [providers]);

	const activeProviders = useMemo(
		() => credentialProviders.filter((provider) => provider.isConfigured),
		[credentialProviders],
	);

	// The generic OCC entry stays "unconfigured" so users can add further named
	// instances even after configuring one. The custom template row is always
	// available (it never becomes configured).
	const unconfiguredProviders = useMemo(
		() =>
			credentialProviders.filter(
				(provider) =>
					!provider.isConfigured ||
					(provider.id === OPENAI_CHAT_COMPLETIONS_PROVIDER_ID && provider.providerFamily === undefined),
			),
		[credentialProviders],
	);

	const filteredActiveProviders = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return activeProviders;
		return activeProviders.filter((provider) => providerMatchesQuery(provider, query));
	}, [activeProviders, searchQuery]);

	const filteredPickerAvailable = useMemo(() => {
		const query = addPickerQuery.trim().toLowerCase();
		return unconfiguredProviders.filter((provider) => providerMatchesQuery(provider, query));
	}, [addPickerQuery, unconfiguredProviders]);

	const filteredPickerConfigured = useMemo(() => {
		const query = addPickerQuery.trim().toLowerCase();
		return activeProviders.filter((provider) => providerMatchesQuery(provider, query));
	}, [activeProviders, addPickerQuery]);

	const pickerHasResults = filteredPickerAvailable.length > 0 || filteredPickerConfigured.length > 0;

	const editingUnconfiguredProvider =
		editingProvider && !activeProviders.some((provider) => provider.id === editingProvider)
			? (credentialProviders.find((entry) => entry.id === editingProvider) ?? null)
			: null;

	const resetEditor = () => {
		setApiKey("");
		setBaseUrl("");
		setModelId("");
		setModels("");
		setApi("openai-completions");
		setDisplayName("");
		setShowPassword(false);
		setAttemptedSave(false);
	};

	const closeEditor = () => {
		setEditingProvider(null);
		setEditingIsNewOccInstance(false);
		resetEditor();
	};

	const openEditor = (providerId: string, opts?: { newOccInstance?: boolean }) => {
		setAddPickerOpen(false);
		setAddPickerQuery("");
		setEditingProvider(providerId);
		setEditingIsNewOccInstance(opts?.newOccInstance === true);
		resetEditor();
		const existing = providers.find((provider) => provider.id === providerId);
		setBaseUrl(existing?.baseUrl ?? "");
		setDisplayName(existing?.displayName ?? (isCustomProviderId(providerId) ? (existing?.name ?? "") : ""));
		setApi(existing?.api ?? "openai-completions");
		setModels((existing?.modelIds ?? []).join(", "));
		setModelId(existing?.modelIds?.[0] ?? "");
	};

	const openAddPicker = () => {
		closeEditor();
		setAddPickerQuery("");
		setAddPickerOpen(true);
	};

	const closeAddPicker = () => {
		setAddPickerOpen(false);
		setAddPickerQuery("");
	};

	const selectProviderFromPicker = (providerId: string) => {
		// Picker entries are templates; an OCC pick starts a new named instance.
		openEditor(providerId, {
			newOccInstance: isOccProviderId(providerId),
		});
	};

	const handleSave = async (providerId: string) => {
		if (!onUpdateProvider) return;

		setAttemptedSave(true);

		const isCustomEditor = providerId === CUSTOM_PROVIDER_PICKER_ID || isCustomProviderId(providerId);
		const openAiChat = isOccProviderId(providerId);

		if (isCustomEditor) {
			const modelList = parseCustomProviderModels(models);
			if (!apiKey.trim() || !baseUrl.trim() || !displayName.trim()) return;
			if (modelList.length === 0) return;

			try {
				await onUpdateProvider({
					providerId,
					apiKey: apiKey.trim(),
					baseUrl: baseUrl.trim(),
					displayName: displayName.trim(),
					api,
					models: modelList,
					...(providerId === CUSTOM_PROVIDER_PICKER_ID ? { createOccInstance: true } : {}),
				});
				toast.success("Provider credentials applied to your active sessions.");
				closeEditor();
				closeAddPicker();
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to update provider");
			}
			return;
		}

		const isNamedOcc = openAiChat && isNamedOccInstanceId(providerId);
		const isOccLike = openAiChat && (isNamedOcc || editingIsNewOccInstance);
		if (!apiKey.trim()) return;
		if (openAiChat && (!baseUrl.trim() || !modelId.trim())) return;
		if (isOccLike && !displayName.trim()) return;

		try {
			await onUpdateProvider({
				providerId,
				apiKey: apiKey.trim(),
				...(openAiChat
					? {
							baseUrl: baseUrl.trim(),
							modelId: modelId.trim(),
							// Name is only meaningful for a named instance (new or existing).
							...(isOccLike ? { displayName: displayName.trim() } : {}),
							...(editingIsNewOccInstance ? { createOccInstance: true } : {}),
						}
					: {}),
			});

			toast.success("Provider credentials applied to your active sessions.");
			closeEditor();
			closeAddPicker();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to update provider");
		}
	};

	const handleRemove = async (provider: ChatProviderInfo) => {
		if (!onRemoveProvider) return;

		try {
			await onRemoveProvider({ providerId: provider.id });
			if (editingProvider === provider.id) {
				closeEditor();
			}
			toast.success(`${provider.name} removed from your configured providers.`);
			setConfirmRemoveProvider(null);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to remove provider");
		}
	};

	const canSave = useMemo(() => {
		if (apiKey.trim().length === 0) return false;
		if (!editingProvider) return true;
		if (editingProvider === CUSTOM_PROVIDER_PICKER_ID || isCustomProviderId(editingProvider)) {
			if (baseUrl.trim().length === 0) return false;
			if (parseCustomProviderModels(models).length === 0) return false;
			return displayName.trim().length > 0;
		}
		if (!isOccProviderId(editingProvider)) return true;
		if (baseUrl.trim().length === 0 || modelId.trim().length === 0) return false;
		const isNamedOcc = isNamedOccInstanceId(editingProvider);
		if (isNamedOcc || editingIsNewOccInstance) {
			return displayName.trim().length > 0;
		}
		return true;
	}, [apiKey, baseUrl, modelId, models, displayName, editingProvider, editingIsNewOccInstance]);

	return {
		activeProviders,
		addPickerOpen,
		addPickerQuery,
		api,
		apiKey,
		attemptedSave,
		baseUrl,
		canSave,
		closeAddPicker,
		closeEditor,
		confirmRemoveProvider,
		credentialProviders,
		displayName,
		editingIsNewOccInstance,
		editingProvider,
		editingUnconfiguredProvider,
		filteredActiveProviders,
		filteredPickerAvailable,
		filteredPickerConfigured,
		handleRemove,
		handleSave,
		modelId,
		models,
		openAddPicker,
		openEditor,
		pickerHasResults,
		resetEditor,
		searchQuery,
		selectProviderFromPicker,
		setAddPickerOpen,
		setAddPickerQuery,
		setApi,
		setApiKey,
		setAttemptedSave,
		setBaseUrl,
		setConfirmRemoveProvider,
		setDisplayName,
		setEditingIsNewOccInstance,
		setEditingProvider,
		setModelId,
		setModels,
		setSearchQuery,
		setShowPassword,
		showPassword,
		unconfiguredProviders,
	};
}

function providerMatchesQuery(provider: ChatProviderInfo, query: string) {
	if (!query) return true;
	const keywords = supportsOAuth(provider)
		? isOAuthProvider(provider)
			? "oauth sign-in login"
			: "api key oauth sign-in login"
		: provider.id === CUSTOM_PROVIDER_PICKER_ID || isCustomProviderId(provider.id)
			? "custom provider endpoint openai anthropic google compatible"
			: isOccProviderId(provider.id)
				? "api key base url model name chat completions"
				: "";
	const haystack = [provider.name, provider.envVarName, provider.id, keywords].join(" ").toLowerCase();
	return haystack.includes(query);
}
