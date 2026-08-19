import { useEffect, useRef, useState, type MutableRefObject } from "react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../../alert-dialog"
import { ScrollArea } from "../../scroll-area"
import { Field, FieldDescription, FieldLabel } from "../../field"
import { Select } from "../../select"
import { Switch } from "../../switch"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../breadcrumb"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "../../sidebar"

import {
  useChatPanelDataContext,
  useSettingsActionsContext,
} from "../layout/right-panel-context"
import { DiscreteTabs } from "../primitives/discrete-tab"
import { PersonalizationSection } from "./config-panel/sections/personalization-section"
import { ProviderCredentialsSection } from "./config-panel/sections/provider-credentials-section"
import { ModelDefaultsSection } from "./config-panel/sections/model-defaults-section"
import { ResourcesSection } from "./config-panel/sections/resources-section"
import { SandboxProviderSection } from "./config-panel/sections/sandbox-provider-section"

import {
  harnessSettings,
  modelSettings,
  resourceSettings,
  sameJson,
  summarizeResources,
} from "./config-panel/shared/settings-mappers"
import { useModelDefaultsForm } from "./settings/use-model-defaults-form"
import { useResourcesForm } from "./settings/use-resources-form"
import type { ReactNode } from "react"
import type {
  ChatPiSettings,
  ChatPiSettingsUpdate,
} from "@prime-agent/web-protocol/chat-protocol"
import {
  isSettingsSectionId,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "./settings-sections"
import type { LucideIcon } from "lucide-react"
import {
  readUiPreferences,
  UI_PREFERENCES_KEY,
  type UiPreferences,
} from "../../../lib/ui-preferences"

function PreferenceRow({
  children,
  description,
  label,
}: {
  children: ReactNode
  description: string
  label: string
}) {
  return (
    <Field
      orientation="horizontal"
      className="items-center justify-between gap-6 rounded-xl border p-4"
    >
      <div className="min-w-0">
        <FieldLabel>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </div>
      <div className="shrink-0">{children}</div>
    </Field>
  )
}

/**
 * Thin composer over the per-section form hooks; keeps the dialog-level
 * draft core, tab state, saving orchestration, and the discard flow.
 */
function useSettingsForm() {
  const {
    isLoadingProviders,
    isUpdatingProvider,
    modelCatalog,
    onDiscoverModels,
    onOAuthLogin,
    onRemoveProvider,
    onThemePreferenceChange,
    onUpdateProvider,
    providers = [],
    saveSettings,
    settings,
    settingsLoading,
    themePreference,
  } = useSettingsActionsContext()
  const { models, resources } = useChatPanelDataContext()

  const [draft, setDraft] = useState<ChatPiSettings | null>(null)
  const [savingSection, setSavingSection] = useState<string | null>(null)

  const resourceSummary = summarizeResources(resources)

  const updateDraft = (
    updater: (current: ChatPiSettings) => ChatPiSettings
  ) => {
    setDraft((current: ChatPiSettings | null) =>
      current ? updater(current) : current
    )
  }

  const {
    packageRows,
    packageError,
    resourceDirty,
    handlePackageRowsChange,
    revertResourceDraft,
  } = useResourcesForm({ draft, settings, updateDraft })

  const {
    modelFilter,
    setModelFilter,
    modelOptions,
    modelDirty,
    addModels,
    removeModel,
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
  })

  const hasUnsavedChanges = modelDirty || resourceDirty

  const resetDraft = () => {
    if (!settings) return
    // Only the draft is owned here; package rows/error reconcile in
    // useResourcesForm's sync effect once draft settles.
    setDraft(settings.effective)
  }

  useEffect(() => {
    if (!settings) return

    const nextDraft = settings.effective

    if (draft && hasUnsavedChanges) return
    if (draft && sameJson(draft, nextDraft)) return

    setDraft(nextDraft)
  }, [draft, hasUnsavedChanges, settings])

  const saveSection = async (section: string, update: ChatPiSettingsUpdate) => {
    if (section === "models" && draft) {
      const saved = await commitModelSettings(draft)
      if (!saved) {
        throw new Error("Settings save failed")
      }
      return
    }

    setSavingSection(section)
    try {
      await saveSettings(update)
      toast.success("Pi settings saved")
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Settings save failed"
      )
      throw error
    } finally {
      setSavingSection(null)
    }
  }

  const requestCloseSettings = async (): Promise<
    "close" | "discard-prompt" | "wait"
  > => {
    if (savingSection === "models") return "wait"
    if (resourceDirty) return "discard-prompt"
    // modelDirty already requires a non-null draft
    if (modelDirty && draft) {
      return (await commitModelSettings(draft, { silent: true }))
        ? "close"
        : "discard-prompt"
    }
    return "close"
  }

  return {
    isLoadingProviders,
    isUpdatingProvider,
    onThemePreferenceChange,
    onOAuthLogin,
    onRemoveProvider,
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
    discoverProvider,
    discoveringProviderId,
    saveSection,
    requestCloseSettings,
    resetCommittedModelBaseline,
  }
}

function SidebarNavItem({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  label: string
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} onClick={onClick}>
        <Icon />
        <span>{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

type CloseAttemptDetails = { cancel: () => void }

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, selects this nav tab each time the dialog opens. */
  initialTab?: SettingsSectionId
}) {
  useEffect(() => {
    const preferences = readUiPreferences()
    document.documentElement.dataset.density = preferences.density
    document.documentElement.classList.toggle(
      "reduce-motion",
      preferences.motion === "reduced"
    )
  }, [])

  return (
    <SettingsDialogSession
      initialTab={initialTab}
      onOpenChange={onOpenChange}
      open={open}
    />
  )
}

function SettingsDialogSession({
  initialTab,
  onOpenChange,
  open,
}: {
  initialTab?: SettingsSectionId
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const onCloseAttemptRef = useRef<(eventDetails?: CloseAttemptDetails) => void>(
    () => {
      onOpenChange(false)
    }
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) {
          onOpenChange(true)
          return
        }
        onCloseAttemptRef.current(eventDetails)
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
  )
}

type SettingsForm = ReturnType<typeof useSettingsForm>
type UpdatePreference = <Key extends keyof UiPreferences>(
  key: Key,
  value: UiPreferences[Key],
) => void

function SettingsDialogPaneContent({
  activeTab,
  form,
  preferences,
  updatePreference,
}: {
  activeTab: SettingsSectionId
  form: SettingsForm
  preferences: UiPreferences
  updatePreference: UpdatePreference
}) {
  const {
    isLoadingProviders,
    isUpdatingProvider,
    onThemePreferenceChange,
    onOAuthLogin,
    onRemoveProvider,
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
    discoverProvider,
    discoveringProviderId,
    saveSection,
  } = form

  const resourcesPane = (scope: "skills" | "harness") => (
    <ResourcesSection
      scope={scope}
      draft={draft}
      updateDraft={updateDraft}
      onEnableSkillCommandsChange={(enableSkillCommands) =>
        updateDraft((current) => ({ ...current, enableSkillCommands }))
      }
      onExtensionsChange={(extensions) =>
        updateDraft((current) => ({ ...current, extensions }))
      }
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
  )

  const panes: Record<SettingsSectionId, () => ReactNode> = {
    appearance: () => (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-medium">Appearance</h3>
          <p className="text-sm text-muted-foreground">
            Customize the look and feel of the interface.
          </p>
        </div>
        <PersonalizationSection
          onThemePreferenceChange={onThemePreferenceChange}
          themePreference={themePreference}
        />
        <PreferenceRow label="Density" description="Adjust spacing across chat and panels.">
          <Select
            value={preferences.density}
            onValueChange={(value) =>
              updatePreference("density", value as UiPreferences["density"])
            }
            options={[
              { label: "Comfortable", value: "comfortable" },
              { label: "Compact", value: "compact" },
            ]}
          />
        </PreferenceRow>
        <PreferenceRow label="Motion" description="Respect the system setting or reduce UI motion.">
          <Select
            value={preferences.motion}
            onValueChange={(value) =>
              updatePreference("motion", value as UiPreferences["motion"])
            }
            options={[
              { label: "System", value: "system" },
              { label: "Reduced", value: "reduced" },
            ]}
          />
        </PreferenceRow>
      </div>
    ),
    chat: () => (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-medium">Chat</h3>
          <p className="text-sm text-muted-foreground">Control transcript behavior.</p>
        </div>
        <PreferenceRow
          label="Streaming transcript"
          description="Follow new output or preserve the reading position."
        >
          <Select
            value={preferences.transcript}
            onValueChange={(value) =>
              updatePreference("transcript", value as UiPreferences["transcript"])
            }
            options={[
              { label: "Follow output", value: "follow" },
              { label: "Manual", value: "manual" },
            ]}
          />
        </PreferenceRow>
      </div>
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
        onOAuthLogin={onOAuthLogin}
        onRemoveProvider={onRemoveProvider}
        onUpdateProvider={onUpdateProvider}
      />
    ),
    "llm-models": () => (
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
        providers={providers}
        onRevert={revertModelDraft}
        onSave={() => draft && saveSection("models", modelSettings(draft))}
        saving={savingSection === "models"}
        settingsLoading={settingsLoading}
      />
    ),
    skills: () => resourcesPane("skills"),
    "pi-harness": () => resourcesPane("harness"),
    keybindings: () => (
      <div className="flex flex-col gap-4 text-sm">
        <div>
          <h3 className="text-lg font-medium">Keybindings</h3>
          <p className="text-sm text-muted-foreground">
            Every shortcut also has a visible control in the header, panel, or composer.
          </p>
        </div>
        <div className="rounded-xl border p-4 font-mono text-xs leading-7">
          <div>Command palette: Ctrl/Command K</div>
          <div>Conversation sidebar: Ctrl/Command B</div>
          <div>Toggle Resources: Ctrl/Command Shift 1</div>
          <div>Toggle Workspace: Ctrl/Command Shift 2</div>
          <div>Toggle Artifacts: Ctrl/Command Shift 3</div>
          <div>Focus active panel: Ctrl/Command Shift P</div>
          <div>Return focus to chat: Ctrl/Command Shift C</div>
          <div>Close active panel: Escape</div>
        </div>
      </div>
    ),
    sessions: () => (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-medium">Sessions</h3>
          <p className="text-sm text-muted-foreground">
            Set local conversation preferences. Provider and workspace configuration remains Fleet Prime-owned.
          </p>
        </div>
        <PreferenceRow
          label="Confirm session deletion"
          description="Require confirmation before deleting a saved conversation."
        >
          <Switch
            checked={preferences.confirmSessionDelete}
            onCheckedChange={(checked) => updatePreference("confirmSessionDelete", checked)}
            aria-label="Confirm session deletion"
          />
        </PreferenceRow>
        <p className="text-xs text-muted-foreground">
          Provider credentials, OAuth, models, sandbox configuration, and workspace selection are managed by Fleet Prime and its CLI.
        </p>
      </div>
    ),
  }

  return panes[activeTab]()
}

function SettingsDialogBody({
  initialTab,
  onCloseAttemptRef,
  onOpenChange,
}: {
  initialTab?: SettingsSectionId
  onCloseAttemptRef: MutableRefObject<
    (eventDetails?: CloseAttemptDetails) => void
  >
  onOpenChange: (open: boolean) => void
}) {
  const form = useSettingsForm()
  const {
    resourceDirty,
    revertResourceDraft,
    resetDraft,
    requestCloseSettings,
    resetCommittedModelBaseline,
  } = form

  const [activeTab, setActiveTab] = useState<SettingsSectionId>(
    () => initialTab ?? "appearance"
  )
  const [preferences, setPreferences] = useState(readUiPreferences)

  useEffect(() => {
    window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences))
    document.documentElement.dataset.density = preferences.density
    document.documentElement.classList.toggle(
      "reduce-motion",
      preferences.motion === "reduced"
    )
  }, [preferences])

  const updatePreference = <Key extends keyof UiPreferences>(
    key: Key,
    value: UiPreferences[Key]
  ) => {
    setPreferences((current) => ({ ...current, [key]: value }))
  }

  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const [discardReason, setDiscardReason] = useState<"resource" | "model">(
    "resource"
  )
  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.id === activeTab) ??
    SETTINGS_SECTIONS[0]

  const handleOpenChange = (
    nextOpen: boolean,
    eventDetails?: { cancel: () => void }
  ) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }

    eventDetails?.cancel()
    void (async () => {
      const result = await requestCloseSettings()
      if (result === "close") {
        onOpenChange(false)
        return
      }
      if (result === "wait") {
        toast.message("Saving model list…")
        return
      }
      setDiscardReason(resourceDirty ? "resource" : "model")
      setDiscardDialogOpen(true)
    })()
  }

  onCloseAttemptRef.current = (eventDetails) => {
    handleOpenChange(false, eventDetails)
  }

  const handleDiscardChanges = () => {
    revertResourceDraft()
    resetDraft()
    resetCommittedModelBaseline()
    setDiscardDialogOpen(false)
    onOpenChange(false)
  }

  useEffect(() => {
    resetCommittedModelBaseline()
  }, [resetCommittedModelBaseline])

  const paneContent = (
    <SettingsDialogPaneContent
      activeTab={activeTab}
      form={form}
      preferences={preferences}
      updatePreference={updatePreference}
    />
  )
  return (
    // Nest AlertDialog under Dialog.Root so Base UI tracks nested open
    // dialogs (Esc / isTopmost). Sibling roots fight Esc and re-prompt.
    <>
      <DialogContent className="w-full max-w-[calc(100%-2rem)] overflow-hidden p-0 sm:max-w-[650px] md:h-[650px] md:max-h-[85vh] md:max-w-[760px] lg:max-w-[860px]">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your settings here.
        </DialogDescription>

        <SidebarProvider
          className="h-full min-h-0"
          enableKeyboardShortcut={false}
          persistState={false}
        >
          {/* Left Sidebar */}
          <Sidebar
            collapsible="none"
            className="hidden h-full shrink-0 flex-col border-r border-border/40 bg-muted/20 md:flex md:w-[240px]"
          >
            <div className="flex h-14 shrink-0 items-center border-b border-border/40 p-4">
              {/* Visual only — DialogTitle (sr-only) is the accessible name */}
              <span className="text-sm font-semibold">Settings</span>
            </div>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SETTINGS_SECTIONS.map((section) => (
                      <SidebarNavItem
                        key={section.id}
                        active={activeTab === section.id}
                        onClick={() => setActiveTab(section.id)}
                        icon={section.icon}
                        label={section.title}
                      />
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>

          {/* Main Content Pane */}
          <main className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/10 bg-background px-6">
              <div className="flex flex-1 items-center justify-between">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      Settings
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeSection.title}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>

            <div className="flex min-w-0 shrink-0 overflow-x-auto overscroll-x-contain border-b border-border/10 bg-muted/5 px-4 py-2.5 md:hidden">
              <DiscreteTabs
                aria-label="Settings sections"
                className="min-w-max"
                size="compact"
                tabs={SETTINGS_SECTIONS}
                value={activeTab}
                onValueChange={(next) => {
                  if (isSettingsSectionId(next)) setActiveTab(next)
                }}
              />
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div
                id={`panel-${activeTab}`}
                role="tabpanel"
                aria-label={activeSection.title}
                tabIndex={0}
                className="p-6 outline-none"
              >
                {paneContent}
              </div>
            </ScrollArea>
          </main>
        </SidebarProvider>
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
            <AlertDialogAction onClick={handleDiscardChanges}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
