import type { ChatPiSettings, ChatPiSettingsUpdate } from "@prime-agent/web-protocol/chat-protocol";
import { useState } from "react";
import type { SettingsActions } from "@/components/settings/use-settings-actions";
import type { ChatResourcesResponse } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatModelOption } from "@/lib/chat/chat-helpers";
import { useModelDefaultsForm } from "@/components/settings/use-model-defaults-form";
import { useResourcesForm } from "@/components/settings/use-resources-form";
import { notify as toast } from "@/lib/notify";
import { sameJson, summarizeResources } from "@/lib/settings/settings-mappers";

/**
 * Thin composer over the per-section form hooks; keeps the dialog-level
 * draft core, saving orchestration, and the discard flow.
 */
export type SettingsResources = {
	models: ChatModelOption[];
	resources: ChatResourcesResponse | null;
	resourcesLoading: boolean;
	resourcesError: Error | null;
	refreshResources: () => void;
};

export function useSettingsForm(actions: SettingsActions, source: SettingsResources) {
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
	} = actions;
	const { models, resources, resourcesLoading, resourcesError, refreshResources } = source;

	const [saveScope, setSaveScopeState] = useState<"global" | "project">("project");
	const sourceSettings =
		settings && saveScope === "global" && settings.globalEffective
			? { ...settings, effective: settings.globalEffective, project: {} }
			: settings;
	const scopedSaveSettings = async (update: ChatPiSettingsUpdate) => {
		const response = await saveSettings(update, saveScope);
		return saveScope === "global" && response.globalEffective
			? { ...response, effective: response.globalEffective, project: {} }
			: response;
	};
	const [draft, setDraft] = useState<ChatPiSettings | null>(() => sourceSettings?.effective ?? null);
	const [savingSection, setSavingSection] = useState<string | null>(null);
	const [syncedSettingsSource, setSyncedSettingsSource] = useState(settings);

	const resourceSummary = summarizeResources(resources);

	const updateDraft = (updater: (current: ChatPiSettings) => ChatPiSettings) => {
		setDraft((current: ChatPiSettings | null) => (current ? updater(current) : current));
	};

	const { packageRows, packageError, resourceDirty, handlePackageRowsChange, revertResourceDraft, resetPackageRows } =
		useResourcesForm({
			draft,
			settings: sourceSettings,
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
		settings: sourceSettings,
		providers,
		models,
		modelCatalog,
		onDiscoverModels,
		saveSettings: scopedSaveSettings,
		setSavingSection,
	});

	const hasUnsavedChanges =
		modelDirty || resourceDirty || (!!draft && !!sourceSettings && !sameJson(draft, sourceSettings.effective));

	if (settings !== syncedSettingsSource) {
		const previous =
			saveScope === "global"
				? (syncedSettingsSource?.globalEffective ?? syncedSettingsSource?.effective)
				: syncedSettingsSource?.effective;
		setSyncedSettingsSource(settings);
		if (sourceSettings) {
			const nextDraft = { ...sourceSettings.effective };
			if (draft && previous) {
				for (const key of Object.keys({ ...draft, ...nextDraft }) as Array<keyof ChatPiSettings>) {
					if (!sameJson(draft[key], previous[key])) Object.assign(nextDraft, { [key]: draft[key] });
				}
			}
			resetCommittedModelBaseline();
			if (!sameJson(draft, nextDraft)) setDraft(nextDraft);
		}
	}

	const resetDraft = () => {
		if (!settings) return;
		// Only the draft is owned here; package rows/error reconcile in
		// useResourcesForm's sync effect once draft settles.
		if (sourceSettings) setDraft(sourceSettings.effective);
	};

	const saveSection = async (section: string, update: ChatPiSettingsUpdate) => {
		if (savingSection) return;
		if (section === "models" && draft) {
			const saved = await commitModelSettings(draft);
			if (!saved) {
				return;
			}
			return;
		}

		setSavingSection(section);
		try {
			const response = await scopedSaveSettings(update);
			if (response.updateImpact.resourceReloadRequired) toast.message("Saved. Resource reload is required.");
			if (response.updateImpact.newSessionRecommended)
				toast.message("Saved. Start a new session to apply runtime changes.");
			response.diagnostics.forEach((message) => toast.message(message));
			toast.success("Prime Agent settings saved");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Settings save failed");
			return;
		} finally {
			setSavingSection(null);
		}
	};

	const requestCloseSettings = async (): Promise<"close" | "discard-prompt" | "wait"> => {
		if (savingSection) return "wait";
		if (hasUnsavedChanges) return "discard-prompt";
		return "close";
	};

	const setSaveScope = (scope: "global" | "project") => {
		if (hasUnsavedChanges || savingSection) return;
		setSaveScopeState(scope);
		resetPackageRows();
		const next = scope === "global" ? (settings?.globalEffective ?? settings?.effective) : settings?.effective;
		if (next) setDraft(next);
		resetCommittedModelBaseline();
	};
	const sectionDirty = (keys: Array<keyof ChatPiSettings>) =>
		!!draft && !!sourceSettings && keys.some((key) => !sameJson(draft[key], sourceSettings.effective[key]));
	const revertFields = (keys: Array<keyof ChatPiSettings>) => {
		if (!sourceSettings) return;
		updateDraft((current) => {
			const next = { ...current };
			for (const key of keys) Object.assign(next, { [key]: sourceSettings.effective[key] });
			return next;
		});
	};
	return {
		resourcesLoading,
		resourcesError,
		refreshResources,
		resetPackageRows,
		settings: sourceSettings,
		projectOverrides: Object.keys(settings?.project ?? {}),
		projectPath: settings?.projectPath,
		sectionDirty,
		revertFields,
		hasUnsavedChanges,
		saveScope,
		setSaveScope,
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
