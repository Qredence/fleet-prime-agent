import type { ChatPiSettings, ChatPiSettingsUpdate } from "@prime-agent/web-protocol/chat-protocol";
import { useState } from "react";
import { useChatPanelDataContext, useSettingsActionsContext } from "@/components/layout/right-panel-context";
import { useModelDefaultsForm } from "@/hooks/settings/use-model-defaults-form";
import { useResourcesForm } from "@/hooks/settings/use-resources-form";
import { notify as toast } from "@/lib/notify";
import { sameJson, summarizeResources } from "@/lib/settings/settings-mappers";

/**
 * Thin composer over the per-section form hooks; keeps the dialog-level
 * draft core, saving orchestration, and the discard flow.
 */
export function useSettingsForm() {
	const {
		isLoadingMcp,
		isLoadingProviders,
		isUpdatingMcp,
		isUpdatingProvider,
		mcpConnections = [],
		modelCatalog,
		onDiscoverModels,
		onMcpOAuth,
		onRemoveMcp,
		onRemoveProvider,
		onThemePreferenceChange,
		onUpdateMcp,
		onUpdateProvider,
		providers = [],
		saveSettings,
		settings,
		settingsLoading,
		themePreference,
	} = useSettingsActionsContext();
	const { models, resources } = useChatPanelDataContext();

	const [draft, setDraft] = useState<ChatPiSettings | null>(() => settings?.effective ?? null);
	const [savingSection, setSavingSection] = useState<string | null>(null);
	const [syncedSettingsSource, setSyncedSettingsSource] = useState(settings);

	const resourceSummary = summarizeResources(resources);

	const updateDraft = (updater: (current: ChatPiSettings) => ChatPiSettings) => {
		setDraft((current: ChatPiSettings | null) => (current ? updater(current) : current));
	};

	const { packageRows, packageError, resourceDirty, handlePackageRowsChange, revertResourceDraft } = useResourcesForm({
		draft,
		settings,
		updateDraft,
	});

	const {
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
	} = useModelDefaultsForm({
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
	});

	const hasUnsavedChanges = modelDirty || resourceDirty;

	if (settings !== syncedSettingsSource) {
		setSyncedSettingsSource(settings);
		if (settings && (!draft || !hasUnsavedChanges)) {
			const nextDraft: ChatPiSettings = {
				...settings.effective,
				enabledModels: settings.project.enabledModels ?? settings.effective.enabledModels,
				defaultProvider: settings.project.defaultProvider ?? settings.effective.defaultProvider,
				defaultModel: settings.project.defaultModel ?? settings.effective.defaultModel,
				defaultThinkingLevel: settings.project.defaultThinkingLevel ?? settings.effective.defaultThinkingLevel,
			};
			resetCommittedModelBaseline();
			if (!draft || !sameJson(draft, nextDraft)) {
				setDraft(nextDraft);
			}
		}
	}

	const resetDraft = () => {
		if (!settings) return;
		// Only the draft is owned here; package rows/error reconcile in
		// useResourcesForm's sync effect once draft settles.
		setDraft(settings.effective);
	};

	const saveSection = async (section: string, update: ChatPiSettingsUpdate) => {
		if (section === "models" && draft) {
			const saved = await commitModelSettings(draft);
			if (!saved) {
				throw new Error("Settings save failed");
			}
			return;
		}

		setSavingSection(section);
		try {
			await saveSettings(update);
			toast.success("Pi settings saved");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Settings save failed");
			throw error;
		} finally {
			setSavingSection(null);
		}
	};

	const requestCloseSettings = async (): Promise<"close" | "discard-prompt" | "wait"> => {
		if (savingSection === "models") return "wait";
		if (resourceDirty) return "discard-prompt";
		// modelDirty already requires a non-null draft
		if (modelDirty && draft) {
			return (await commitModelSettings(draft, { silent: true })) ? "close" : "discard-prompt";
		}
		return "close";
	};

	return {
		isLoadingMcp,
		isLoadingProviders,
		isUpdatingMcp,
		isUpdatingProvider,
		mcpConnections,
		onMcpOAuth,
		onRemoveMcp,
		onRemoveProvider,
		onThemePreferenceChange,
		onUpdateMcp,
		onUpdateProvider,
		providers,
		resources,
		settingsLoading,
		themePreference,
		draft,
		savingSection,
		packageRows,
		packageError,
		modelFilter,
		setModelFilter,
		resourceSummary,
		modelOptions,
		modelDirty,
		resourceDirty,
		revertResourceDraft,
		revertModelDraft,
		resetDraft,
		updateDraft,
		handlePackageRowsChange,
		addModels,
		removeModel,
		setDefaultModel,
		discoverProvider,
		discoveringProviderId,
		saveSection,
		requestCloseSettings,
		resetCommittedModelBaseline,
	};
}
