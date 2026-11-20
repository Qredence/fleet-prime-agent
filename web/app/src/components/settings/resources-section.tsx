import type { ChatPiSettings, ChatResourcesResponse } from "@prime-agent/web-protocol/chat-protocol";
import { useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsDraftState } from "@/components/settings/use-settings-draft-state";
import { Input } from "@/components/ui/input";
import { CatalogValueList } from "@/components/settings/lists";
import { SettingsCommitActions } from "@/components/settings/settings-pane";
import { SectionPanel as SettingsPane } from "@/components/ui/section-panel";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";

export function ResourcesSection({
	resourcesLoading,
	resourcesError,
	onRefresh,
	draft,
	onEnableSkillCommandsChange,
	onSkillsChange,
	onRevert,
	onSave,
	resourceDirty,
	resources,
	saving,
	settingsLoading,
}: {
	resourcesLoading?: boolean;
	resourcesError?: Error | null;
	onRefresh?: () => void;
	draft: ChatPiSettings | null;
	onEnableSkillCommandsChange: (enabled: boolean) => void;
	onSkillsChange: (skills: string[]) => void;
	onRevert: () => void;
	onSave: () => void;
	resourceDirty: boolean;
	resources: ChatResourcesResponse | null;
	saving: boolean;
	settingsLoading: boolean;
}) {
	const localDrafts = useSettingsDraftState();
	const [skillSearch, setSkillSearch] = useState("");
	const visibleSkills = (resources?.skills ?? []).filter((skill) =>
		`${skill.name} ${skill.description ?? ""} ${skill.path ?? ""} ${skill.scope ?? ""} ${skill.source ?? ""}`
			.toLowerCase()
			.includes(skillSearch.toLowerCase()),
	);
	const disabled = !draft || settingsLoading;
	return (
		<SettingsPane
			title="Skills"
			description="Browse discovered skills and configure additional skill paths."
			actions={
				<SettingsCommitActions
					dirty={resourceDirty}
					saveDisabled={localDrafts.dirtySections.includes("skills")}
					disabled={disabled}
					onRevert={onRevert}
					onSave={onSave}
					saving={saving}
				/>
			}
		>
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
			<div className="flex items-center gap-2">
				<Button variant="outline" size="compact" disabled={resourcesLoading || !onRefresh} onClick={onRefresh}>
					Refresh discovered skills
				</Button>
			</div>
			{resourcesError ? (
				<Alert variant="destructive">
					<AlertDescription>Could not load skill discovery. Refresh to try again.</AlertDescription>
				</Alert>
			) : null}
			{resourcesLoading ? <Skeleton className="h-12 w-full" aria-label="Loading skills" /> : null}
			<p className="text-sm text-muted-foreground">
				Additional search paths supplement Prime Agent’s default discovery. Removing a path does not uninstall a
				skill.
			</p>
			<ResourceGroup label="Additional skill paths" count={draft?.skills.length ?? 0}>
				<CatalogValueList
					sectionId="skills"
					addLabel="Add skill"
					catalog={resources?.skills ?? []}
					placeholder="../agent-workspace/pi/skills"
					values={draft?.skills ?? []}
					onChange={onSkillsChange}
				/>
			</ResourceGroup>
			<Input
				aria-label="Search discovered skills"
				placeholder="Search discovered skills"
				value={skillSearch}
				onChange={(event) => setSkillSearch(event.target.value)}
			/>
			<p className="text-xs text-muted-foreground">
				{resources?.snapshotState === "available"
					? "Loaded in session marks skills reported by the active Prime Agent daemon. Other results come from configuration discovery."
					: resources?.snapshotState === "empty"
						? "The session snapshot is empty. Prime Agent initializes resources lazily; discovered skills below are not confirmed as loaded."
						: "Showing configuration discovery. Session loading status is unavailable."}
			</p>
			<ResourceGroup label="Discovered skills" count={visibleSkills.length}>
				{visibleSkills.map((skill) => (
					<Collapsible key={skill.path ?? skill.name}>
						<Item variant="outline">
							<ItemContent>
								<ItemTitle>{skill.name}</ItemTitle>
								<ItemDescription>
									{skill.loadedInSession ? "Loaded in session · Daemon snapshot" : "Configuration discovery"}
								</ItemDescription>
								{skill.description ? (
									<ItemDescription className="line-clamp-2">{skill.description}</ItemDescription>
								) : null}
								<ItemDescription>
									{skill.scope === "user"
										? "User account"
										: skill.scope === "project"
											? "Project"
											: skill.scope === "temporary"
												? "Temporary"
												: "Scope unavailable"}
									{skill.origin === "package"
										? " · Package"
										: skill.origin === "top-level"
											? " · Directory"
											: ""}
									{skill.source ? ` · ${skill.source}` : ""}
								</ItemDescription>
							</ItemContent>
							<CollapsibleTrigger
								render={
									<Button variant="ghost" size="compact" aria-label={`Details for skill ${skill.name}`} />
								}
							>
								Details
							</CollapsibleTrigger>
						</Item>
						<CollapsibleContent className="flex flex-col gap-2 p-3 text-sm">
							<p>{skill.description}</p>
							<p className="break-all text-xs text-muted-foreground">{skill.path ?? "Path unavailable"}</p>
						</CollapsibleContent>
					</Collapsible>
				))}
				{visibleSkills.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{skillSearch ? "No matching discovered skills." : "No discovered skill metadata is available."}
					</p>
				) : null}
			</ResourceGroup>
			{resources?.diagnostics.length ? (
				<div role="status" className="rounded-md border p-3 text-sm">
					<p className="font-medium">Resource discovery diagnostics</p>
					<ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
						{resources.diagnostics.map((message, index) => (
							<li key={`${index}:${message}`}>{message}</li>
						))}
					</ul>
				</div>
			) : null}
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
