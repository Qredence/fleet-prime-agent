import { notify as toast } from "@prime-agent/web-design/lib/notify";
import type {
	ChatPiSettings,
	ChatPiSettingsUpdate,
	ChatProviderInfo,
	ChatSettingsResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ChatModelOption } from "../../../../../lib/pi/chat-helpers";
import { customModelKey, nextEnabledModelPatterns } from "../config-panel/shared/model-patterns";
import { comparableModelSettings, modelSettings, sameJson } from "../config-panel/shared/settings-mappers";
import type { ConfigModelInfo } from "../config-panel/shared/types";

/**
 * Owns the LLM-models slice of the settings form: filter, discovery, enabled
 * model curation (autosaved immediately), and the commit/baseline flow.
 */
export function useModelDefaultsForm({
	draft,
	setDraft,
	updateDraft,
	settings,
	providers,
	models,
	modelCatalog,
	onDiscoverModels,
	saveSettings,
	setSavingSection,
}: {
	draft: ChatPiSettings | null;
	setDraft: Dispatch<SetStateAction<ChatPiSettings | null>>;
	updateDraft: (updater: (current: ChatPiSettings) => ChatPiSettings) => void;
	settings: ChatSettingsResponse | null;
	providers: Array<ChatProviderInfo>;
	models: Array<ChatModelOption>;
	modelCatalog?: Array<ChatModelOption>;
	onDiscoverModels?: (providerId: string) => Promise<Array<ChatModelOption>>;
	saveSettings: (settings: ChatPiSettingsUpdate) => Promise<ChatSettingsResponse>;
	setSavingSection: Dispatch<SetStateAction<string | null>>;
}) {
	const [modelFilter, setModelFilter] = useState("");
	const [discoveredModels, setDiscoveredModels] = useState<Array<ConfigModelInfo>>([]);
	const [discoveringProviderId, setDiscoveringProviderId] = useState<string | null>(null);
	const lastCommittedModelSettings = useRef<ChatPiSettingsUpdate | null>(null);

	const configuredProviderIds = useMemo(() => {
		// Trust the server: the /api/chat/providers route is driven entirely by
		// prime-agent's ModelRegistry (built-ins ∪ models.json customs). Any
		// provider reported as configured is a candidate for model selection —
		// intersecting with a static CREDENTIAL_UI_PROVIDERS list would hide
		// prime-agent customs like `modal` (OCC UNC) that users legitimately
		// configure outside the legacy fleet-pi catalog.
		const ids = new Set<string>();
		for (const provider of providers) {
			if (provider.isConfigured) {
				ids.add(provider.id);
			}
		}
		return ids;
	}, [providers]);

	const catalogModels = modelCatalog ?? models;

	const modelOptions = useMemo(() => {
		const byId = new Map<string, ConfigModelInfo>();
		for (const model of catalogModels) {
			if (configuredProviderIds.has(model.provider)) {
				byId.set(model.id, model);
			}
		}
		for (const model of discoveredModels) {
			if (configuredProviderIds.has(model.provider)) {
				byId.set(model.id, model);
			}
		}
		const merged = [...byId.values()];
		if (!draft?.defaultProvider || !draft.defaultModel) return merged;
		if (merged.some((model) => model.provider === draft.defaultProvider && model.modelId === draft.defaultModel)) {
			return merged;
		}

		if (!configuredProviderIds.has(draft.defaultProvider)) return merged;

		return [
			{
				id: customModelKey(draft.defaultProvider, draft.defaultModel),
				name: draft.defaultModel,
				provider: draft.defaultProvider,
				modelId: draft.defaultModel,
				available: false,
			},
			...merged,
		];
	}, [catalogModels, configuredProviderIds, discoveredModels, draft]);

	const modelBaseline =
		lastCommittedModelSettings.current ?? (settings ? comparableModelSettings(settings.effective) : null);

	const modelDirty = !!draft && !!modelBaseline && !sameJson(comparableModelSettings(draft), modelBaseline);

	const resetCommittedModelBaseline = useCallback(() => {
		lastCommittedModelSettings.current = null;
	}, []);

	const commitModelSettings = async (nextDraft: ChatPiSettings, options?: { silent?: boolean }): Promise<boolean> => {
		setDraft(nextDraft);
		setSavingSection("models");
		try {
			const response = await saveSettings(modelSettings(nextDraft));
			const committed: ChatPiSettings = {
				...response.effective,
				enabledModels:
					response.project.enabledModels ?? nextDraft.enabledModels ?? response.effective.enabledModels,
				defaultProvider:
					response.project.defaultProvider ?? nextDraft.defaultProvider ?? response.effective.defaultProvider,
				defaultModel: response.project.defaultModel ?? nextDraft.defaultModel ?? response.effective.defaultModel,
				defaultThinkingLevel:
					response.project.defaultThinkingLevel ??
					nextDraft.defaultThinkingLevel ??
					response.effective.defaultThinkingLevel,
			};
			lastCommittedModelSettings.current = comparableModelSettings(committed);
			setDraft(committed);
			if (!options?.silent) {
				toast.success("Pi settings saved");
			}
			return true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Settings save failed");
			return false;
		} finally {
			setSavingSection(null);
		}
	};

	const persistModelSettings = (nextDraft: ChatPiSettings) => {
		void commitModelSettings(nextDraft);
	};

	const setModelEnabled = (model: ConfigModelInfo, enabled: boolean) => {
		if (!draft) return;
		const nextDraft: ChatPiSettings = {
			...draft,
			enabledModels: nextEnabledModelPatterns({
				currentPatterns: draft.enabledModels,
				enabled,
				model,
				models: modelOptions,
			}),
		};
		void persistModelSettings(nextDraft);
	};

	const addModels = (modelsToAdd: Array<ConfigModelInfo>) => {
		if (!draft || modelsToAdd.length === 0) return;
		let patterns = draft.enabledModels;
		for (const model of modelsToAdd) {
			patterns = nextEnabledModelPatterns({
				currentPatterns: patterns,
				enabled: true,
				model,
				models: modelOptions,
			});
		}
		void persistModelSettings({ ...draft, enabledModels: patterns });
	};

	const removeModel = (model: ConfigModelInfo) => {
		setModelEnabled(model, false);
	};

	/** Promote an enabled model to the session default (engine settings.json). */
	const setDefaultModel = (model: ConfigModelInfo) => {
		if (!draft) return;
		void commitModelSettings({
			...draft,
			defaultProvider: model.provider,
			defaultModel: model.modelId,
		});
	};

	const discoverProvider = async (providerId: string) => {
		if (!onDiscoverModels) return;
		setDiscoveringProviderId(providerId);
		try {
			const discovered = await onDiscoverModels(providerId);
			setDiscoveredModels((current) => {
				const byId = new Map(current.map((model) => [model.id, model]));
				for (const model of discovered) {
					byId.set(model.id, model);
				}
				return [...byId.values()];
			});
		} finally {
			setDiscoveringProviderId(null);
		}
	};

	const revertModelDraft = () => {
		if (!settings) return;
		updateDraft((current) => ({
			...current,
			defaultProvider: settings.effective.defaultProvider,
			defaultModel: settings.effective.defaultModel,
			defaultThinkingLevel: settings.effective.defaultThinkingLevel,
			enabledModels: settings.effective.enabledModels,
		}));
	};

	return {
		modelFilter,
		setModelFilter,
		modelOptions,
		modelDirty,
		addModels,
		removeModel,
		setDefaultModel,
		discoverProvider,
		discoveringProviderId,
		commitModelSettings,
		revertModelDraft,
		resetCommittedModelBaseline,
	};
}
