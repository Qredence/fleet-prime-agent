import type { LucideIcon } from "lucide-react";
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { useSettingsActionsContext } from "@/components/layout/right-panel-context";
import { SettingsDraftProvider } from "@/components/settings/settings-draft-provider";
import { useSettingsDraftState } from "@/hooks/settings/use-settings-draft-state";
import { SettingsPaneContent } from "@/components/settings/settings-pane-content";
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
import { useSettingsForm } from "@/hooks/settings/use-settings-form";
import { notify as toast } from "@/lib/notify";
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
		<SettingsPaneContent
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
