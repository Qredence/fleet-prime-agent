import type { ChatPiSettings, ChatResourcesResponse } from "@prime-agent/web-protocol/chat-protocol";
import type { ReactNode } from "react";
import { HarnessRuntimeSection } from "@/components/settings/harness-runtime-section";
import { CatalogValueList } from "@/components/settings/lists";
import { SettingsCommitActions, SettingsPane } from "@/components/settings/settings-pane";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";

export type ResourcesSectionScope = "skills" | "harness";

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
	updateDraft,
}: {
	draft: ChatPiSettings | null;
	onEnableSkillCommandsChange: (enabled: boolean) => void;
	onExtensionsChange: (extensions: Array<string>) => void;
	onPackageRowsChange: (rows: Array<string>) => void;
	onPromptsChange: (prompts: Array<string>) => void;
	onRevert: () => void;
	onSave: () => void;
	onSkillsChange: (skills: Array<string>) => void;
	onThemesChange: (themes: Array<string>) => void;
	packageError?: string;
	packageRows: Array<string>;
	resourceDirty: boolean;
	resources: ChatResourcesResponse | null;
	resourceSummary: {
		total: number;
		reloadRequired: number;
	};
	saving: boolean;
	scope?: ResourcesSectionScope;
	settingsLoading: boolean;
	updateDraft: (updater: (current: ChatPiSettings) => ChatPiSettings) => void;
}) {
	const disabled = !draft || settingsLoading || !!packageError;
	const catalogSubtitle =
		resourceSummary.total === 0
			? "Empty"
			: resourceSummary.reloadRequired > 0
				? `${resourceSummary.total} · ${resourceSummary.reloadRequired} reload`
				: `${resourceSummary.total}`;

	const title = scope === "skills" ? "Skills" : "Pi Harness";
	const description =
		scope === "skills"
			? "Pick detected workspace skills and slash-command discovery."
			: "Runtime (compaction, retry, transport) plus packages, extensions, prompts, and themes.";

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
					<Item
						variant="outline"
						size="sm"
						className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
					>
						<ItemContent className="min-w-0 gap-0.5">
							<ItemTitle className="w-full truncate text-sm font-medium text-foreground">
								Skill slash commands
							</ItemTitle>
						</ItemContent>
						<ItemActions className="shrink-0">
							<Switch
								aria-label="Skill slash commands"
								checked={draft?.enableSkillCommands ?? true}
								disabled={!draft}
								onCheckedChange={onEnableSkillCommandsChange}
							/>
						</ItemActions>
					</Item>
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
					<HarnessRuntimeSection draft={draft} updateDraft={updateDraft} />
					<Item
						variant="outline"
						size="sm"
						className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
					>
						<ItemContent className="min-w-0 gap-0.5">
							<ItemTitle className="w-full truncate text-sm font-medium text-foreground">Catalog</ItemTitle>
							<ItemDescription className="truncate text-xs text-muted-foreground tabular-nums">
								{catalogSubtitle}
							</ItemDescription>
						</ItemContent>
					</Item>

					<ResourceGroup label="Packages" count={packageRows.length}>
						<CatalogValueList
							addLabel="Add package"
							catalog={resources?.packages ?? []}
							placeholder='npm:pi-skills or {"source":"npm:pkg"}'
							values={packageRows}
							onChange={onPackageRowsChange}
						/>
						{packageError ? <p className="px-1 text-xs text-destructive">{packageError}</p> : null}
					</ResourceGroup>

					<ResourceGroup label="Extensions" count={draft?.extensions.length ?? 0}>
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
	);
}

function ResourceGroup({ children, count, label }: { children: ReactNode; count: number; label: string }) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2 px-1">
				<p className="text-xs font-medium text-muted-foreground">{label}</p>
				<p className="text-xs text-muted-foreground tabular-nums">{count === 1 ? "1 item" : `${count} items`}</p>
			</div>
			{children}
		</div>
	);
}
