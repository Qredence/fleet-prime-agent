import { Switch } from "../../../../switch"
import { ItemRow } from "../../../primitives/item-row"
import {
  SettingsCommitActions,
  SettingsPane,
} from "../../../primitives/settings-pane"
import { CatalogValueList } from "../shared/lists"
import type { ReactNode } from "react"
import type {
  ChatPiSettings,
  ChatResourcesResponse,
} from "@prime-agent/web-protocol/chat-protocol"

export type ResourcesSectionScope = "skills" | "harness"

export function ResourcesSection({
  draft,
  onEnableSkillCommandsChange,
  onExtensionsChange,
  onPackageRowsChange,
  onPromptsChange,
  onRevert,
  onSave,
  onSkillsChange,
  onThemesChange,
  packageError,
  packageRows,
  resourceDirty,
  resources,
  resourceSummary,
  saving,
  scope = "harness",
  settingsLoading,
}: {
  draft: ChatPiSettings | null
  onEnableSkillCommandsChange: (enabled: boolean) => void
  onExtensionsChange: (extensions: Array<string>) => void
  onPackageRowsChange: (rows: Array<string>) => void
  onPromptsChange: (prompts: Array<string>) => void
  onRevert: () => void
  onSave: () => void
  onSkillsChange: (skills: Array<string>) => void
  onThemesChange: (themes: Array<string>) => void
  packageError?: string
  packageRows: Array<string>
  resourceDirty: boolean
  resources: ChatResourcesResponse | null
  resourceSummary: {
    total: number
    reloadRequired: number
  }
  saving: boolean
  scope?: ResourcesSectionScope
  settingsLoading: boolean
}) {
  const disabled = !draft || settingsLoading || !!packageError
  const catalogSubtitle =
    resourceSummary.total === 0
      ? "Empty"
      : resourceSummary.reloadRequired > 0
        ? `${resourceSummary.total} · ${resourceSummary.reloadRequired} reload`
        : `${resourceSummary.total}`

  const title = scope === "skills" ? "Skills" : "Pi Harness"
  const description =
    scope === "skills"
      ? "Pick detected workspace skills and slash-command discovery."
      : "Manage packages, extensions, prompts, and themes."

  return (
    <SettingsPane
      title={title}
      description={description}
      actions={
        <SettingsCommitActions
          dirty={resourceDirty}
          disabled={disabled}
          onRevert={onRevert}
          onSave={onSave}
          saving={saving}
        />
      }
    >
      {scope === "skills" ? (
        <>
          <ItemRow
            title="Skill slash commands"
            trailing={
              <Switch
                aria-label="Skill slash commands"
                checked={draft?.enableSkillCommands ?? true}
                disabled={!draft}
                onCheckedChange={onEnableSkillCommandsChange}
              />
            }
          />
          <ResourceGroup label="Skills" count={draft?.skills.length ?? 0}>
            <CatalogValueList
              addLabel="Add skill"
              catalog={resources?.skills ?? []}
              placeholder="../agent-workspace/pi/skills"
              values={draft?.skills ?? []}
              onChange={onSkillsChange}
            />
          </ResourceGroup>
        </>
      ) : (
        <>
          <ItemRow
            interactive={false}
            title="Catalog"
            subtitle={<span className="tabular-nums">{catalogSubtitle}</span>}
          />

          <ResourceGroup label="Packages" count={packageRows.length}>
            <CatalogValueList
              addLabel="Add package"
              catalog={resources?.packages ?? []}
              placeholder='npm:pi-skills or {"source":"npm:pkg"}'
              values={packageRows}
              onChange={onPackageRowsChange}
            />
            {packageError ? (
              <p className="px-1 text-xs text-destructive">{packageError}</p>
            ) : null}
          </ResourceGroup>

          <ResourceGroup
            label="Extensions"
            count={draft?.extensions.length ?? 0}
          >
            <CatalogValueList
              addLabel="Add extension"
              catalog={resources?.extensions ?? []}
              placeholder="../agent-workspace/pi/extensions"
              values={draft?.extensions ?? []}
              onChange={onExtensionsChange}
            />
          </ResourceGroup>

          <ResourceGroup label="Prompts" count={draft?.prompts.length ?? 0}>
            <CatalogValueList
              addLabel="Add prompt"
              catalog={resources?.prompts ?? []}
              placeholder="../agent-workspace/pi/prompts"
              values={draft?.prompts ?? []}
              onChange={onPromptsChange}
            />
          </ResourceGroup>

          <ResourceGroup label="Themes" count={draft?.themes.length ?? 0}>
            <CatalogValueList
              addLabel="Add theme"
              catalog={resources?.themes ?? []}
              placeholder="../agent-workspace/pi/themes"
              values={draft?.themes ?? []}
              onChange={onThemesChange}
            />
          </ResourceGroup>
        </>
      )}
    </SettingsPane>
  )
}

function ResourceGroup({
  children,
  count,
  label,
}: {
  children: ReactNode
  count: number
  label: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {count === 1 ? "1 item" : `${count} items`}
        </p>
      </div>
      {children}
    </div>
  )
}
