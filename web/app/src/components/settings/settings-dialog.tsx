import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import type { ChatPiSettings } from "@prime-agent/web-protocol/chat-protocol";
import type { ReactNode } from "react";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { McpConnectionsSection } from "@/components/connectors/mcp-connections-section";
import { type SettingsActionsContextValue, useSettingsActionsContext } from "@/components/layout/right-panel-context";
import { ComposerIntentSection } from "@/components/settings/composer-intent-section";
import { DashboardsSection } from "@/components/settings/dashboards-section";
import { ModelDefaultsSection } from "@/components/settings/providers/model-defaults-section";
import { ProviderCredentialsSection } from "@/components/settings/providers/provider-credentials-section";
import { ResourcesSection } from "@/components/settings/resources-section";
import { SandboxProviderSection } from "@/components/settings/sandbox-provider-section";
import { CatalogValueList } from "@/components/settings/lists";
import { HarnessRuntimeSection } from "@/components/settings/harness-runtime-section";
import { SettingsDraftProvider } from "@/components/settings/settings-draft-provider";
import { useSettingsDraftState } from "@/hooks/settings/use-settings-draft-state";
import { readKeybindings } from "@/hooks/layout/panel-keybindings";
import { SettingsCommitActions, SettingsPane } from "@/components/settings/settings-pane";
import { SettingsRow } from "@/components/settings/settings-row";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsForm } from "@/hooks/settings/use-settings-form";
import type { ThemePreference } from "@/lib/layout/canvas-utils";
import { notify as toast } from "@/lib/notify";
import { modelSettings } from "@/lib/settings/settings-mappers";
import {
	canonicalSettingsSection,
	SETTINGS_SEARCH_ENTRIES,
	isSettingsSectionId,
	SETTINGS_SECTION_GROUPS,
	SETTINGS_SECTIONS,
	type SettingsSectionId,
} from "@/lib/settings/settings-sections";
import {
	applyUiPreferencesToDocument,
	readUiPreferences,
	type UiPreferences,
	writeUiPreferences,
} from "@/lib/ui-preferences";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
] as const;

function SettingsNavItem({
	active,
	onClick,
	icon: Icon,
	label,
}: {
	active: boolean;
	onClick: () => void;
	icon: LucideIcon;
	label: string;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="compact"
			onClick={onClick}
			active={active}
			aria-current={active ? "true" : undefined}
			className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left"
		>
			<Icon data-icon="inline-start" />
			<span>{label}</span>
		</Button>
	);
}

type CloseAttemptDetails = { cancel: () => void };

export function SettingsDialog({
	open,
	onOpenChange,
	initialTab,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** When provided, selects this nav tab each time the dialog opens. */
	initialTab?: SettingsSectionId;
}) {
	useEffect(() => {
		applyUiPreferencesToDocument(readUiPreferences());
	}, []);

	return <SettingsDialogSession initialTab={initialTab} onOpenChange={onOpenChange} open={open} />;
}

function SettingsDialogSession({
	initialTab,
	onOpenChange,
	open,
}: {
	initialTab?: SettingsSectionId;
	onOpenChange: (open: boolean) => void;
	open: boolean;
}) {
	const onCloseAttemptRef = useRef<(eventDetails?: CloseAttemptDetails) => void>(() => {
		onOpenChange(false);
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen, eventDetails) => {
				if (nextOpen) {
					onOpenChange(true);
					return;
				}
				onCloseAttemptRef.current(eventDetails);
			}}
		>
			{open ? (
				<SettingsDraftProvider>
					<SettingsDialogBody
						initialTab={initialTab}
						onCloseAttemptRef={onCloseAttemptRef}
						onOpenChange={onOpenChange}
					/>
				</SettingsDraftProvider>
			) : null}
		</Dialog>
	);
}

type SettingsForm = ReturnType<typeof useSettingsForm>;
type UpdatePreference = <Key extends keyof UiPreferences>(key: Key, value: UiPreferences[Key]) => void;

function SettingsDialogPaneContent({
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
	composerIntent?: SettingsActionsContextValue["composerIntent"];
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

	const fieldKeys = (id: SettingsSectionId): Array<keyof ChatPiSettings> =>
		id === "skills"
			? ["skills", "enableSkillCommands"]
			: id === "context"
				? ["compaction"]
				: id === "retry-delivery"
					? ["retry", "steeringMode", "followUpMode"]
					: id === "prompts"
						? ["prompts"]
						: ["packages", "extensions"];
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
						aria-label="Confirm session deletion"
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

function SettingsDialogBody({
	initialTab,
	onCloseAttemptRef,
	onOpenChange,
}: {
	initialTab?: SettingsSectionId;
	onCloseAttemptRef: MutableRefObject<(eventDetails?: CloseAttemptDetails) => void>;
	onOpenChange: (open: boolean) => void;
}) {
	const form = useSettingsForm();
	const localDrafts = useSettingsDraftState();
	const { composerIntent, onComposerIntentChange, onComposerIntentKeyChange } = useSettingsActionsContext();
	const { revertResourceDraft, resetDraft, requestCloseSettings, resetCommittedModelBaseline } = form;

	const [activeTab, setActiveTab] = useState<SettingsSectionId>(() =>
		canonicalSettingsSection(initialTab ?? "appearance"),
	);
	const [search, setSearch] = useState("");
	const [focusTarget, setFocusTarget] = useState<string | null>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [visited, setVisited] = useState<SettingsSectionId[]>([canonicalSettingsSection(initialTab ?? "appearance")]);
	const navigateSection = (id: SettingsSectionId) => {
		setVisited((current) => (current.includes(id) ? current : [...current, id]));
		setActiveTab(id);
	};
	useEffect(() => {
		if (!focusTarget) return;
		const control = Array.from(contentRef.current?.querySelectorAll<HTMLElement>("[aria-label]") ?? []).find(
			(element) => element.getAttribute("aria-label") === focusTarget && !element.closest("[hidden]"),
		);
		if (control) {
			control.focus();
			control.scrollIntoView({ block: "center" });
			setFocusTarget(null);
		}
	}, [focusTarget, activeTab]);
	const searchResults = [
		...SETTINGS_SECTIONS.map((section) => ({ section: section.id, label: section.title, target: "" })),
		...SETTINGS_SEARCH_ENTRIES,
	].filter((entry) => entry.label.toLowerCase().includes(search.trim().toLowerCase()));
	const dirtySection = (id: SettingsSectionId) =>
		localDrafts.dirtySections.includes(id) ||
		(id === "llm-models" && (form.modelDirty || form.sectionDirty(["transport"]))) ||
		(id === "context" && form.sectionDirty(["compaction"])) ||
		(id === "retry-delivery" && form.sectionDirty(["retry", "steeringMode", "followUpMode"])) ||
		(id === "skills" && form.sectionDirty(["skills", "enableSkillCommands"])) ||
		(id === "prompts" && form.sectionDirty(["prompts"])) ||
		(id === "extensions-packages" && (form.sectionDirty(["extensions", "packages"]) || !!form.packageError));

	const [preferences, setPreferences] = useState(readUiPreferences);

	useEffect(() => {
		writeUiPreferences(preferences);
	}, [preferences]);

	const updatePreference = <Key extends keyof UiPreferences>(key: Key, value: UiPreferences[Key]) => {
		setPreferences((current) => ({ ...current, [key]: value }));
	};

	const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

	const activeSection = SETTINGS_SECTIONS.find((section) => section.id === activeTab) ?? SETTINGS_SECTIONS[0];

	const handleOpenChange = (nextOpen: boolean, eventDetails?: { cancel: () => void }) => {
		if (nextOpen) {
			onOpenChange(true);
			return;
		}

		eventDetails?.cancel();
		void (async () => {
			const result =
				localDrafts.busy || form.savingSection
					? "wait"
					: localDrafts.dirtySections.length
						? "discard-prompt"
						: await requestCloseSettings();
			if (result === "close") {
				onOpenChange(false);
				return;
			}
			if (result === "wait") {
				toast.message("Wait for the current save to finish.");
				return;
			}

			setDiscardDialogOpen(true);
		})();
	};

	useEffect(() => {
		onCloseAttemptRef.current = (eventDetails) => {
			handleOpenChange(false, eventDetails);
		};
	});

	const handleDiscardChanges = () => {
		revertResourceDraft();
		resetDraft();
		resetCommittedModelBaseline();
		setDiscardDialogOpen(false);
		onOpenChange(false);
	};

	useEffect(() => {
		resetCommittedModelBaseline();
	}, [resetCommittedModelBaseline]);

	const paneContent = (sectionId: SettingsSectionId) => (
		<SettingsDialogPaneContent
			focusTarget={focusTarget}
			onFocusComplete={() => setFocusTarget(null)}
			activeTab={sectionId}
			composerIntent={composerIntent}
			form={form}
			onComposerIntentChange={onComposerIntentChange}
			onComposerIntentKeyChange={onComposerIntentKeyChange}
			preferences={preferences}
			updatePreference={updatePreference}
		/>
	);
	return (
		// Nest AlertDialog under Dialog.Root so Base UI tracks nested open
		// dialogs (Esc / isTopmost). Sibling roots fight Esc and re-prompt.
		<>
			<DialogContent className="flex h-dvh w-full max-w-full sm:h-[min(760px,calc(100dvh-4rem))] overflow-hidden rounded-md p-0 sm:max-w-[min(1000px,calc(100%-2rem))]">
				<DialogTitle className="sr-only">Settings</DialogTitle>
				<DialogDescription className="sr-only">Customize your settings here.</DialogDescription>

				<div className="flex h-full w-full min-h-0 min-w-0 flex-1">
					<nav
						aria-label="Settings sections"
						className="hidden h-full w-52 shrink-0 flex-col border-r border-border bg-sidebar sm:flex"
					>
						<div className="px-4 pt-4 pb-2 text-sm font-semibold">Settings</div>
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-6">
							{SETTINGS_SECTION_GROUPS.map((group) => (
								<div key={group.id} className="py-2">
									<p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
										{group.label}
									</p>
									<div className="flex flex-col gap-0.5">
										{SETTINGS_SECTIONS.filter((section) => section.group === group.id).map((section) => (
											<SettingsNavItem
												key={section.id}
												active={activeTab === section.id}
												onClick={() => navigateSection(section.id)}
												icon={section.icon}
												label={`${section.title}${dirtySection(section.id) ? " · Unsaved" : ""}`}
											/>
										))}
									</div>
								</div>
							))}
						</div>
					</nav>

					<main className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
						<header className="flex h-[var(--density-header-height)] w-full shrink-0 items-center gap-2 border-b border-border/10 px-6">
							<div className="flex w-full flex-1 items-center justify-between">
								<Breadcrumb>
									<BreadcrumbList>
										<BreadcrumbItem className="hidden sm:block">Settings</BreadcrumbItem>
										<BreadcrumbSeparator className="hidden sm:block" />
										<BreadcrumbItem>
											<BreadcrumbPage>{activeSection.title}</BreadcrumbPage>
										</BreadcrumbItem>
									</BreadcrumbList>
								</Breadcrumb>
							</div>
						</header>

						<div className="w-full shrink-0 border-b border-border/10 bg-muted/5 px-4 py-2.5 sm:hidden">
							<Select
								aria-label="Settings sections"
								value={activeTab}
								onValueChange={(next) => {
									if (isSettingsSectionId(next)) navigateSection(next);
								}}
								options={SETTINGS_SECTIONS.map((section) => ({
									label: section.title,
									value: section.id,
								}))}
							/>
						</div>

						<div
							hidden={
								!(
									[
										"llm-models",
										"context",
										"retry-delivery",
										"skills",
										"prompts",
										"extensions-packages",
									] as string[]
								).includes(activeTab)
							}
							className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2"
						>
							<span className="text-xs text-muted-foreground">Prime Agent save destination</span>
							<Select
								disabled={
									form.hasUnsavedChanges ||
									!!form.savingSection ||
									localDrafts.busy ||
									!!localDrafts.dirtySections.length
								}
								aria-label="Save destination"
								value={form.saveScope}
								options={[
									{ value: "project", label: "Current project" },
									{ value: "global", label: "User defaults" },
								]}
								onValueChange={(value) => {
									if (value === "global" || value === "project") form.setSaveScope(value);
								}}
							/>
							<span className="text-xs text-muted-foreground">
								Project overrides take precedence. Save or cancel drafts before changing destination.
								{form.saveScope === "project" && form.projectPath
									? ` Project: ${form.projectPath}.`
									: " Editing user defaults; project overrides remain in effect."}
								{form.projectOverrides.length
									? ` Project overrides: ${form.projectOverrides.join(", ")}.`
									: " No project overrides."}
							</span>
						</div>
						<div className="px-4 py-2">
							<Input
								aria-label="Search settings"
								placeholder="Search settings and controls"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
							/>
						</div>
						{search.trim() ? (
							<div
								className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pb-4"
								aria-label="Settings search results"
							>
								{searchResults.length ? (
									searchResults.map((entry) => (
										<Button
											key={`${entry.section}:${entry.target}`}
											variant="ghost"
											className="justify-start"
											onClick={() => {
												navigateSection(entry.section);
												setSearch("");
												setFocusTarget(entry.target || null);
											}}
										>
											{entry.label}
										</Button>
									))
								) : (
									<p role="status" className="text-sm text-muted-foreground">
										No matching settings.
									</p>
								)}
							</div>
						) : null}
						<ScrollArea
							className={cn(search.trim() && "hidden", "min-h-0 min-w-0 w-full flex-1")}
							viewportClassName="overflow-x-hidden"
						>
							<div
								ref={contentRef}
								id={`panel-${activeTab}`}
								role="region"
								aria-label={activeSection.title}
								tabIndex={0}
								className="min-w-0 w-full max-w-full p-4 outline-none [overflow-wrap:anywhere] sm:p-6"
							>
								{visited.map((id) => (
									<div key={id} hidden={id !== activeTab}>
										{paneContent(id)}
									</div>
								))}
							</div>
						</ScrollArea>
					</main>
				</div>
			</DialogContent>

			<AlertDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
				<AlertDialogContent>
					<div className="flex flex-col gap-2">
						<AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
						<AlertDialogDescription>
							Your unsaved settings and credential drafts will be discarded. Saved changes and appearance
							preferences are kept.
						</AlertDialogDescription>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep editing</AlertDialogCancel>
						<AlertDialogAction onClick={handleDiscardChanges}>Discard changes</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
