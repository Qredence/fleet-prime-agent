import type { ChatPiSettings } from "@prime-agent/web-protocol/chat-protocol";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { McpConnectionsSection } from "@/components/connectors/mcp-connections-section";
import { ComposerIntentSection } from "@/components/settings/composer-intent-section";
import { DashboardsSection } from "@/components/settings/dashboards-section";
import { HarnessRuntimeSection } from "@/components/settings/harness-runtime-section";
import { CatalogValueList } from "@/components/settings/lists";
import { ModelDefaultsSection } from "@/components/settings/providers/model-defaults-section";
import { ProviderCredentialsSection } from "@/components/settings/providers/provider-credentials-section";
import { ResourcesSection } from "@/components/settings/resources-section";
import { SandboxProviderSection } from "@/components/settings/sandbox-provider-section";
import { SettingsRow } from "@/components/settings/settings-row";
import { SettingsCommitActions } from "@/components/settings/settings-pane";
import { SectionPanel as SettingsPane } from "@/components/ui/section-panel";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SettingsActions } from "@/components/settings/use-settings-actions";
import { readKeybindings } from "@/components/layout/panel-keybindings";
import { useSettingsDraftState } from "@/components/settings/use-settings-draft-state";
import { useSettingsForm } from "@/components/settings/use-settings-form";
import type { ThemePreference } from "@/lib/layout/canvas-utils";
import { modelSettings } from "@/lib/settings/settings-mappers";
import type { SettingsSectionId } from "@/lib/settings/settings-sections";
import type { UiPreferences } from "@/lib/ui-preferences";

const THEME_OPTIONS = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
] as const;

type SettingsForm = ReturnType<typeof useSettingsForm>;
type UpdatePreference = <Key extends keyof UiPreferences>(key: Key, value: UiPreferences[Key]) => void;

function fieldKeys(id: SettingsSectionId): Array<keyof ChatPiSettings> {
	return id === "skills"
		? ["skills", "enableSkillCommands"]
		: id === "context"
			? ["compaction"]
			: id === "retry-delivery"
				? ["retry", "steeringMode", "followUpMode"]
				: id === "prompts"
					? ["prompts"]
					: ["packages", "extensions"];
}

export function SettingsPaneContent({
	focusTarget,
	onFocusComplete,
	activeTab,
	composerIntent,
	form,
	onComposerIntentChange,
	onComposerIntentKeyChange,
	preferences,
	updatePreference,
}: {
	focusTarget?: string | null;
	onFocusComplete?: () => void;
	activeTab: SettingsSectionId;
	composerIntent?: SettingsActions["composerIntent"];
	form: SettingsForm;
	onComposerIntentChange?: (enabled: boolean) => Promise<void> | void;
	onComposerIntentKeyChange?: (apiKey: string | null) => Promise<void> | void;
	preferences: UiPreferences;
	updatePreference: UpdatePreference;
}) {
	const sectionDrafts = useSettingsDraftState();
	const {
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
		modelOptions,
		modelDirty,
		revertModelDraft,
		updateDraft,
		handlePackageRowsChange,
		addModels,
		removeModel,
		setDefaultModel,
		discoverProvider,
		discoveringProviderId,
		saveSection,
	} = form;

	const actionsFor = (id: SettingsSectionId) => (
		<SettingsCommitActions
			dirty={
				form.sectionDirty(fieldKeys(id)) ||
				sectionDrafts.dirtySections.includes(id) ||
				(id === "extensions-packages" && !!packageError)
			}
			disabled={settingsLoading || !draft || !!savingSection}
			saveDisabled={sectionDrafts.dirtySections.includes(id) || (id === "extensions-packages" && !!packageError)}
			saving={savingSection === id}
			onRevert={() => {
				sectionDrafts.cancelSection?.(id);
				form.revertFields(fieldKeys(id));
				if (id === "extensions-packages") form.resetPackageRows();
			}}
			onSave={() => {
				if (!draft) return;
				const patch = Object.fromEntries(fieldKeys(id).map((key) => [key, draft[key]]));
				void saveSection(id, patch);
			}}
		/>
	);
	const runtimePane = (id: "context" | "retry-delivery") => (
		<SettingsPane
			title={id === "context" ? "Context & compaction" : "Retry & delivery"}
			description="Prime Agent runtime settings. A new session may be needed after saving."
			actions={actionsFor(id)}
		>
			<HarnessRuntimeSection draft={draft} updateDraft={updateDraft} section={id} />
		</SettingsPane>
	);
	const skillPane = () => (
		<ResourcesSection
			resourcesLoading={form.resourcesLoading}
			resourcesError={form.resourcesError}
			onRefresh={form.refreshResources}
			draft={draft}
			onEnableSkillCommandsChange={(enableSkillCommands) =>
				updateDraft((current) => ({ ...current, enableSkillCommands }))
			}
			onRevert={() => {
				sectionDrafts.cancelSection?.("skills");
				form.revertFields(fieldKeys("skills"));
			}}
			onSave={() => {
				if (draft)
					void saveSection("skills", { skills: draft.skills, enableSkillCommands: draft.enableSkillCommands });
			}}
			onSkillsChange={(skills) => updateDraft((current) => ({ ...current, skills }))}
			resourceDirty={form.sectionDirty(fieldKeys("skills")) || sectionDrafts.dirtySections.includes("skills")}
			resources={resources}
			saving={savingSection === "skills"}
			settingsLoading={settingsLoading || !!savingSection}
		/>
	);
	const servicesPane = () => (
		<SettingsPane
			title="Optional services"
			description="Optional Fleet services use server-side credentials and separate service models."
		>
			<ComposerIntentSection
				enabled={composerIntent?.enabled ?? false}
				keySource={composerIntent?.keySource ?? "none"}
				status={composerIntent?.status ?? "unconfigured"}
				onClearKey={() => onComposerIntentKeyChange?.(null)}
				onEnabledChange={onComposerIntentChange}
				onSaveKey={(key) => onComposerIntentKeyChange?.(key)}
			/>
			<DashboardsSection />
		</SettingsPane>
	);

	const panes: Record<SettingsSectionId, () => ReactNode> = {
		appearance: () => (
			<SettingsPane title="Appearance" description="Customize the look and feel of the interface.">
				<SettingsRow label="Theme" description="Match the system theme or pick light or dark.">
					<Select
						aria-label="Theme"
						className="w-[160px]"
						onValueChange={(value) => onThemePreferenceChange(value as ThemePreference)}
						options={[...THEME_OPTIONS]}
						value={themePreference}
					/>
				</SettingsRow>
				<SettingsRow label="Density" description="Adjust spacing across chat and panels.">
					<Select
						aria-label="Density"
						value={preferences.density}
						onValueChange={(value) => updatePreference("density", value as UiPreferences["density"])}
						options={[
							{ label: "Comfortable", value: "comfortable" },
							{ label: "Compact", value: "compact" },
						]}
					/>
				</SettingsRow>
				<SettingsRow label="Motion" description="Respect the system setting or reduce UI motion.">
					<Select
						aria-label="Motion"
						value={preferences.motion}
						onValueChange={(value) => updatePreference("motion", value as UiPreferences["motion"])}
						options={[
							{ label: "System", value: "system" },
							{ label: "Reduced", value: "reduced" },
						]}
					/>
				</SettingsRow>
			</SettingsPane>
		),
		dashboards: () => (
			<SettingsPane
				title="Dashboards"
				description="Without a key, the assistant writes the dashboard and Fleet draws it in the Dashboards tab. With a Thesys key, OpenUI Cloud builds it, using a model separate from the one you chat with."
			>
				<DashboardsSection />
			</SettingsPane>
		),
		chat: () => (
			<SettingsPane title="Chat" description="Control transcript behavior.">
				<SettingsRow label="Streaming transcript" description="Follow new output or preserve the reading position.">
					<Select
						aria-label="Streaming transcript"
						value={preferences.transcript}
						onValueChange={(value) => updatePreference("transcript", value as UiPreferences["transcript"])}
						options={[
							{ label: "Follow output", value: "follow" },
							{ label: "Manual", value: "manual" },
						]}
					/>
				</SettingsRow>
			</SettingsPane>
		),
		mcp: () => (
			<McpConnectionsSection
				connections={mcpConnections}
				isLoading={isLoadingMcp ?? false}
				isPending={isUpdatingMcp ?? false}
				onOAuth={onMcpOAuth}
				onRemove={onRemoveMcp}
				onUpsert={onUpdateMcp}
			/>
		),
		sandbox: () => (
			<SandboxProviderSection
				focusField={
					activeTab === "sandbox" && (focusTarget === "Daytona API key" || focusTarget === "Region / target")
						? focusTarget
						: undefined
				}
				onFocusComplete={onFocusComplete}
				isLoading={isLoadingProviders ?? false}
				isPending={isUpdatingProvider ?? false}
				providers={providers}
				onUpdateProvider={onUpdateProvider}
			/>
		),
		providers: () => (
			<ProviderCredentialsSection
				isLoading={isLoadingProviders ?? false}
				isPending={isUpdatingProvider ?? false}
				providers={providers}
				onRemoveProvider={onRemoveProvider}
				onUpdateProvider={onUpdateProvider}
			/>
		),
		"llm-models": () => (
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">
					Saving writes the same settings file Prime Agent reads. If you change these settings in the Prime Agent
					terminal at the same moment, the later save wins.
				</p>
				<SettingsPane
					title="Provider inference transport"
					description="Advanced provider connection settings."
					actions={
						<SettingsCommitActions
							dirty={form.sectionDirty(["transport"])}
							disabled={!draft || !!savingSection}
							saving={savingSection === "transport"}
							onRevert={() => form.revertFields(["transport"])}
							onSave={() => {
								if (draft) void saveSection("transport", { transport: draft.transport });
							}}
						/>
					}
				>
					<HarnessRuntimeSection draft={draft} updateDraft={updateDraft} section="transport" />
				</SettingsPane>
				<ModelDefaultsSection
					draft={draft}
					discoveringProviderId={discoveringProviderId}
					modelDirty={modelDirty}
					modelFilter={modelFilter}
					modelOptions={modelOptions}
					onAddModels={addModels}
					onDiscoverProvider={discoverProvider}
					onModelFilterChange={setModelFilter}
					onRemoveModel={removeModel}
					onSetDefaultModel={setDefaultModel}
					providers={providers}
					onRevert={revertModelDraft}
					onSave={() => draft && saveSection("models", modelSettings(draft))}
					saving={savingSection === "models"}
					settingsLoading={settingsLoading}
				/>
			</div>
		),
		skills: skillPane,
		context: () => runtimePane("context"),
		"retry-delivery": () => runtimePane("retry-delivery"),
		services: servicesPane,
		prompts: () => (
			<SettingsPane
				title="Prompt templates"
				description="Additional prompt template search paths for Prime Agent."
				actions={actionsFor("prompts")}
			>
				<CatalogValueList
					sectionId="prompts"
					addLabel="Add prompt"
					catalog={resources?.prompts ?? []}
					values={draft?.prompts ?? []}
					onChange={(prompts) => updateDraft((current) => ({ ...current, prompts }))}
				/>
			</SettingsPane>
		),
		"extensions-packages": () => (
			<SettingsPane
				title="Extensions & packages"
				description="Additional resource sources for Prime Agent. Resource changes require a successful reload."
				actions={actionsFor("extensions-packages")}
			>
				<h4 className="text-sm font-medium">Packages</h4>
				<CatalogValueList
					sectionId="extensions-packages"
					addLabel="Add package"
					catalog={resources?.packages ?? []}
					values={packageRows}
					onChange={handlePackageRowsChange}
				/>
				{packageError ? (
					<p role="alert" className="text-sm text-destructive">
						{packageError}
					</p>
				) : null}
				<h4 className="text-sm font-medium">Extensions</h4>
				<CatalogValueList
					sectionId="extensions-packages"
					addLabel="Add extension"
					catalog={resources?.extensions ?? []}
					values={draft?.extensions ?? []}
					onChange={(extensions) => updateDraft((current) => ({ ...current, extensions }))}
				/>
				<p className="text-xs text-muted-foreground">
					Terminal theme resources are not supported by the native runtime. Fleet appearance is configured
					separately.
				</p>
			</SettingsPane>
		),
		"pi-harness": () => runtimePane("context"),
		keybindings: () => (
			<SettingsPane
				title="Keybindings"
				description="Every shortcut also has a visible control in the header, panel, or composer."
			>
				<dl className="flex flex-col gap-2 text-sm">
					{Object.entries(readKeybindings()).map(([action, binding]) => (
						<div key={action} className="flex flex-wrap justify-between gap-2">
							<dt>{action.replace(/([A-Z])/g, " $1")}</dt>
							<dd className="font-mono text-xs">
								{[
									binding.ctrlOrMeta ? "Ctrl/Command" : "",
									binding.shift ? "Shift" : "",
									binding.alt ? "Alt" : "",
									binding.code.replace(/^Key|^Digit/, ""),
								]
									.filter(Boolean)
									.join(" + ")}
							</dd>
						</div>
					))}
				</dl>
			</SettingsPane>
		),
		sessions: () => (
			<SettingsPane
				title="Sessions"
				description="Set local conversation preferences. Provider and workspace configuration remains Fleet Prime-owned."
			>
				<SettingsRow
					label="Confirm session deletion"
					description="Require confirmation before deleting a saved conversation."
				>
					<Switch
						checked={preferences.confirmSessionDelete}
						onCheckedChange={(checked) => updatePreference("confirmSessionDelete", checked)}
					/>
				</SettingsRow>
				<p className="text-xs text-muted-foreground">
					Provider credentials, OAuth, models, sandbox configuration, and workspace selection are managed by Fleet
					Prime and its CLI.
				</p>
			</SettingsPane>
		),
	};

	return panes[activeTab]();
}
