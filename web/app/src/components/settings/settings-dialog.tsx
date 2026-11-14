import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
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
import { SettingsPane } from "@/components/settings/settings-pane";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsForm } from "@/hooks/settings/use-settings-form";
import type { ThemePreference } from "@/lib/layout/canvas-utils";
import { notify as toast } from "@/lib/notify";
import { harnessSettings, modelSettings, resourceSettings } from "@/lib/settings/settings-mappers";
import {
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
			className={cn(
				"h-auto w-full justify-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-normal transition-colors",
				active
					? "bg-background text-foreground shadow-sm"
					: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Icon className="size-4 shrink-0" />
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
				<SettingsDialogBody
					initialTab={initialTab}
					onCloseAttemptRef={onCloseAttemptRef}
					onOpenChange={onOpenChange}
				/>
			) : null}
		</Dialog>
	);
}

type SettingsForm = ReturnType<typeof useSettingsForm>;
type UpdatePreference = <Key extends keyof UiPreferences>(key: Key, value: UiPreferences[Key]) => void;

function SettingsDialogPaneContent({
	activeTab,
	composerIntent,
	form,
	onComposerIntentChange,
	onComposerIntentKeyChange,
	preferences,
	updatePreference,
}: {
	activeTab: SettingsSectionId;
	composerIntent?: SettingsActionsContextValue["composerIntent"];
	form: SettingsForm;
	onComposerIntentChange?: (enabled: boolean) => void;
	onComposerIntentKeyChange?: (apiKey: string | null) => Promise<void> | void;
	preferences: UiPreferences;
	updatePreference: UpdatePreference;
}) {
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
		resourceSummary,
		modelOptions,
		modelDirty,
		resourceDirty,
		revertResourceDraft,
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

	const resourcesPane = (scope: "skills" | "harness") => (
		<ResourcesSection
			scope={scope}
			draft={draft}
			updateDraft={updateDraft}
			onEnableSkillCommandsChange={(enableSkillCommands) =>
				updateDraft((current) => ({ ...current, enableSkillCommands }))
			}
			onExtensionsChange={(extensions) => updateDraft((current) => ({ ...current, extensions }))}
			onPackageRowsChange={handlePackageRowsChange}
			onPromptsChange={(prompts) => updateDraft((current) => ({ ...current, prompts }))}
			onRevert={revertResourceDraft}
			onSave={() =>
				draft &&
				saveSection("resources", {
					...resourceSettings(draft),
					...(scope === "harness" ? harnessSettings(draft) : {}),
				})
			}
			onSkillsChange={(skills) => updateDraft((current) => ({ ...current, skills }))}
			onThemesChange={(themes) => updateDraft((current) => ({ ...current, themes }))}
			packageError={packageError}
			packageRows={packageRows}
			resourceDirty={resourceDirty}
			resources={resources}
			resourceSummary={resourceSummary}
			saving={savingSection === "resources"}
			settingsLoading={settingsLoading}
		/>
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
				<ComposerIntentSection
					enabled={composerIntent?.enabled ?? false}
					keySource={composerIntent?.keySource ?? "none"}
					status={composerIntent?.status ?? "unconfigured"}
					onClearKey={() => onComposerIntentKeyChange?.(null)}
					onEnabledChange={onComposerIntentChange}
					onSaveKey={(apiKey) => onComposerIntentKeyChange?.(apiKey)}
				/>
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
		skills: () => resourcesPane("skills"),
		"pi-harness": () => resourcesPane("harness"),
		keybindings: () => (
			<SettingsPane
				title="Keybindings"
				description="Every shortcut also has a visible control in the header, panel, or composer."
			>
				<div className="rounded-md border p-4 font-mono text-xs leading-7">
					<div>Command palette: Ctrl/Command K</div>
					<div>Conversation sidebar: Ctrl/Command B</div>
					<div>Toggle Resources: Ctrl/Command Shift 1</div>
					<div>Toggle Workspace: Ctrl/Command Shift 2</div>
					<div>Toggle Artifacts: Ctrl/Command Shift 3</div>
					<div>Focus active panel: Ctrl/Command Shift P</div>
					<div>Return focus to chat: Ctrl/Command Shift C</div>
					<div>Close active panel: Escape</div>
				</div>
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
	const { composerIntent, onComposerIntentChange, onComposerIntentKeyChange } = useSettingsActionsContext();
	const { resourceDirty, revertResourceDraft, resetDraft, requestCloseSettings, resetCommittedModelBaseline } = form;

	const [activeTab, setActiveTab] = useState<SettingsSectionId>(() => initialTab ?? "appearance");
	const [preferences, setPreferences] = useState(readUiPreferences);

	useEffect(() => {
		writeUiPreferences(preferences);
	}, [preferences]);

	const updatePreference = <Key extends keyof UiPreferences>(key: Key, value: UiPreferences[Key]) => {
		setPreferences((current) => ({ ...current, [key]: value }));
	};

	const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
	const [discardReason, setDiscardReason] = useState<"resource" | "model">("resource");
	const activeSection = SETTINGS_SECTIONS.find((section) => section.id === activeTab) ?? SETTINGS_SECTIONS[0];

	const handleOpenChange = (nextOpen: boolean, eventDetails?: { cancel: () => void }) => {
		if (nextOpen) {
			onOpenChange(true);
			return;
		}

		eventDetails?.cancel();
		void (async () => {
			const result = await requestCloseSettings();
			if (result === "close") {
				onOpenChange(false);
				return;
			}
			if (result === "wait") {
				toast.message("Saving model list…");
				return;
			}
			setDiscardReason(resourceDirty ? "resource" : "model");
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

	const paneContent = (
		<SettingsDialogPaneContent
			activeTab={activeTab}
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
			<DialogContent className="flex h-[min(640px,calc(100dvh-4rem))] w-full max-w-[calc(100%-2rem)] overflow-hidden rounded-md p-0 sm:max-w-[min(860px,calc(100%-2rem))]">
				<DialogTitle className="sr-only">Settings</DialogTitle>
				<DialogDescription className="sr-only">Customize your settings here.</DialogDescription>

				<div className="flex h-full w-full min-h-0 min-w-0 flex-1">
					<nav
						aria-label="Settings sections"
						className="hidden h-full w-52 shrink-0 flex-col border-r border-border bg-sidebar sm:flex"
					>
						<div className="px-6 pt-6 pb-2 text-xs font-semibold">Settings</div>
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
												onClick={() => setActiveTab(section.id)}
												icon={section.icon}
												label={section.title}
											/>
										))}
									</div>
								</div>
							))}
						</div>
					</nav>

					<main className="flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
						<header className="flex h-14 w-full shrink-0 items-center gap-2 border-b border-border/10 px-6">
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
									if (isSettingsSectionId(next)) setActiveTab(next);
								}}
								options={SETTINGS_SECTIONS.map((section) => ({
									label: section.title,
									value: section.id,
								}))}
							/>
						</div>

						<ScrollArea className="min-h-0 min-w-0 w-full flex-1" viewportClassName="overflow-x-hidden">
							<div
								id={`panel-${activeTab}`}
								role="tabpanel"
								aria-label={activeSection.title}
								tabIndex={0}
								className="min-w-0 w-full max-w-full p-4 outline-none [overflow-wrap:anywhere] sm:p-6"
							>
								{paneContent}
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
							{discardReason === "resource"
								? "Your resource changes have not been committed. If you leave settings now, those changes will be lost."
								: "Your model list could not be saved. If you leave settings now, those changes will be lost."}
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
