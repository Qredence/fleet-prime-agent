import type { LucideIcon } from "lucide-react";
import { Activity, Bot, Folder, GitBranch, LayoutDashboard, Library, Package, SquareTerminal } from "lucide-react";
import { lazy, Suspense } from "react";
import type { RightPanel } from "@/lib/layout/canvas-utils";
import type { RightPanelData, WorkspacePanelData } from "@/components/layout/right-panel-data";
import { Skeleton } from "@/components/ui/skeleton";

export type ActiveRightPanel = Exclude<RightPanel, null>;
type RightPanelBadgeSource = "resources" | "artifacts" | "repl";
type RightPanelLoadingSource = "resources" | "workspace";

export type RightPanelDefinition = {
	id: ActiveRightPanel;
	order: number;
	title: string;
	ariaLabel: string;
	commandLabel: string;
	commandKeywords: Array<string>;
	icon: LucideIcon;
	dataTestid: string;
	mobileDataTestid: string;
	badgeSource?: RightPanelBadgeSource;
	loadingSource?: RightPanelLoadingSource;
	refreshSource?: RightPanelLoadingSource;
};

export type RightPanelGroup = {
	id: "workspace" | "artifacts" | "dashboards" | "subagents" | "session";
	title: string;
	ariaLabel: string;
	icon: LucideIcon;
	defaultPanel: ActiveRightPanel;
	panels: ReadonlyArray<ActiveRightPanel>;
};

const LazyDashboardsPanel = lazy(() =>
	import("@/components/dashboards/dashboards-panel").then(({ DashboardsPanel }) => ({
		default: DashboardsPanel,
	})),
);

const LazyArtifactsPanel = lazy(() =>
	import("@/components/artifacts/artifacts-panel").then(({ ArtifactsPanelContent }) => ({
		default: ArtifactsPanelContent,
	})),
);
const LazyResourcesPanel = lazy(() =>
	import("@/components/workspace/resources-panel").then(({ ResourcesPanelContent }) => ({
		default: ResourcesPanelContent,
	})),
);
const LazySessionInsightsPanel = lazy(() =>
	import("@/components/sessions/session-insights-panel").then(({ SessionInsightsPanel }) => ({
		default: SessionInsightsPanel,
	})),
);
const LazyReplPanel = lazy(() =>
	import("@/components/workspace/repl-panel").then(({ ReplPanelContent }) => ({
		default: ReplPanelContent,
	})),
);
const LazySubagentsPanel = lazy(() =>
	import("@/components/chat/subagents/subagents-panel").then(({ SubagentsPanelContent }) => ({
		default: SubagentsPanelContent,
	})),
);
const LazyWorkspacePanel = lazy(() =>
	import("@/components/workspace/workspace-panel").then(({ WorkspacePanelContent }) => ({
		default: WorkspacePanelContent,
	})),
);
const LazySessionTreePanel = lazy(() =>
	import("@/components/sessions/session-tree-panel").then(({ SessionTreePanel }) => ({
		default: SessionTreePanel,
	})),
);

function PanelFallback() {
	return (
		<div className="flex min-h-32 flex-col gap-3 p-4" aria-label="Loading panel">
			<Skeleton className="h-5 w-32" />
			<Skeleton className="h-20 w-full" />
		</div>
	);
}

export function RightPanelContent({
	panel,
	data,
	workspace,
	onOpenUIAction,
}: {
	panel: ActiveRightPanel;
	data: RightPanelData;
	workspace: WorkspacePanelData;
	onOpenUIAction?: RightPanelData["onOpenUIAction"];
}) {
	return <Suspense fallback={<PanelFallback />}>{renderPanel(panel, data, workspace, onOpenUIAction)}</Suspense>;
}
function renderPanel(
	panel: ActiveRightPanel,
	data: RightPanelData,
	workspace: WorkspacePanelData,
	onOpenUIAction?: RightPanelData["onOpenUIAction"],
) {
	switch (panel) {
		case "dashboards":
			return (
				<LazyDashboardsPanel
					artifactRuns={data.artifactRuns}
					presentationRuns={data.presentation?.artifactRuns}
					selectedArtifactId={data.selectedArtifactId}
					sessionId={data.sessionId}
					onOpenUIAction={onOpenUIAction}
					onSelect={(artifactId) => data.openArtifact?.(artifactId, "dashboards")}
				/>
			);
		case "session-insights":
			return (
				<LazySessionInsightsPanel
					activityLabel={data.activityLabel}
					artifactRuns={data.artifactRuns}
					chatMode={data.chatMode}
					transcriptSummary={data.transcriptSummary}
					planLabel={data.planLabel}
					presentation={data.presentation}
					queue={data.queue}
					selectedModelKey={data.selectedModelKey}
					sessionId={data.sessionId}
					status={data.status}
					thinkingLevel={data.thinkingLevel}
				/>
			);
		case "resources":
			return (
				<LazyResourcesPanel
					error={data.resourcesError}
					loading={data.resourcesLoading}
					resources={data.resources}
					workspace={workspace.workspaceTree}
				/>
			);
		case "workspace":
			return (
				<LazyWorkspacePanel
					error={workspace.workspaceError}
					loadWorkspaceFile={workspace.loadWorkspaceFile}
					loading={workspace.workspaceLoading}
					onSelectedPathChange={workspace.setSelectedWorkspacePath}
					selectedPath={workspace.selectedWorkspacePath}
					workspace={workspace.workspaceTree}
				/>
			);
		case "artifacts":
			return (
				<LazyArtifactsPanel
					artifactRuns={data.artifactRuns}
					openUIBlocks={data.transcriptSummary.openUIBlocks}
					onOpenUIAction={onOpenUIAction}
					selectedArtifactId={data.selectedArtifactId}
					status={data.status}
				/>
			);
		case "repl":
			return (
				<LazyReplPanel
					artifactRuns={data.artifactRuns}
					selectedArtifactId={data.selectedArtifactId}
					kernelDiagnostics={data.presentation.kernelDiagnostics}
				/>
			);
		case "subagents":
			return (
				<LazySubagentsPanel
					agents={data.presentation.rlmChildren}
					loadSession={data.loadSubagentSession}
					onOpenTab={data.onOpenSubagentTab}
					parentSessionId={data.sessionId}
					tree={data.presentation.rlmTree}
				/>
			);
		case "session-tree":
			return (
				<LazySessionTreePanel
					sessionId={data.sessionId}
					snapshot={data.sessionTreeSnapshot}
					loading={data.sessionTreeLoading}
					error={data.sessionTreeError}
					isStreaming={data.isSessionTreeStreaming}
					selectedEntryId={data.selectedSessionTreeEntryId}
					onSelectEntry={data.selectSessionTreeEntry}
					onRefresh={data.refreshSessionTree}
					onRewind={data.rewindSessionTree}
				/>
			);
	}
}

export const RIGHT_PANEL_REGISTRY = {
	resources: {
		id: "resources",
		order: 0,
		title: "Resources",
		ariaLabel: "Resources",
		commandLabel: "Open Resources",
		commandKeywords: ["resources", "skills", "panels"],
		icon: Library,
		dataTestid: "pi-resources-canvas",
		mobileDataTestid: "pi-resources-mobile-panel",
		badgeSource: "resources",
		loadingSource: "resources",
		refreshSource: "resources",
	},
	workspace: {
		id: "workspace",
		order: 1,
		title: "Workspace",
		ariaLabel: "Workspace",
		commandLabel: "Open Workspace",
		commandKeywords: ["workspace", "files", "panels"],
		icon: Folder,
		dataTestid: "pi-workspace-canvas",
		mobileDataTestid: "pi-workspace-mobile-panel",
		badgeSource: undefined,
		loadingSource: "workspace",
		refreshSource: "workspace",
	},
	artifacts: {
		id: "artifacts",
		order: 2,
		title: "Artifacts",
		ariaLabel: "Artifacts",
		commandLabel: "Open Artifacts",
		commandKeywords: ["artifacts", "reports", "datasets", "panels"],
		icon: Package,
		dataTestid: "pi-artifacts-canvas",
		mobileDataTestid: "pi-artifacts-mobile-panel",
		badgeSource: "artifacts",
		loadingSource: undefined,
		refreshSource: undefined,
	},
	repl: {
		id: "repl",
		order: 3,
		title: "REPL",
		ariaLabel: "REPL runs",
		commandLabel: "Open REPL",
		commandKeywords: ["repl", "cpython", "ipython", "python", "cells", "panels"],
		icon: SquareTerminal,
		dataTestid: "pi-repl-canvas",
		mobileDataTestid: "pi-repl-mobile-panel",
		badgeSource: "repl",
		loadingSource: undefined,
		refreshSource: undefined,
	},
	subagents: {
		id: "subagents",
		order: 4,
		title: "Subagents",
		ariaLabel: "Subagents",
		commandLabel: "Open Subagents",
		commandKeywords: ["subagents", "agents", "threads", "delegation", "panels"],
		icon: Bot,
		dataTestid: "pi-subagents-canvas",
		mobileDataTestid: "pi-subagents-mobile-panel",
		badgeSource: undefined,
		loadingSource: undefined,
		refreshSource: undefined,
	},
	"session-insights": {
		id: "session-insights",
		order: 5,
		title: "Session insights",
		ariaLabel: "Session insights",
		commandLabel: "Open Session Insights",
		commandKeywords: ["session", "insights", "activity", "panels"],
		icon: Activity,
		dataTestid: "pi-session-insights-canvas",
		mobileDataTestid: "pi-session-insights-mobile-panel",
		badgeSource: undefined,
		loadingSource: undefined,
		refreshSource: undefined,
	},
	"session-tree": {
		id: "session-tree",
		order: 6,
		title: "Session tree",
		ariaLabel: "Session tree",
		commandLabel: "Open Session Tree",
		commandKeywords: ["session", "tree", "branch", "rewind", "history", "panels"],
		icon: GitBranch,
		dataTestid: "pi-session-tree-canvas",
		mobileDataTestid: "pi-session-tree-mobile-panel",
		badgeSource: undefined,
		loadingSource: undefined,
		refreshSource: undefined,
	},
	dashboards: {
		id: "dashboards",
		order: 7,
		title: "Dashboards",
		ariaLabel: "Dashboards",
		commandLabel: "Open Dashboards",
		commandKeywords: ["dashboards", "dashboard", "openui", "panels"],
		icon: LayoutDashboard,
		dataTestid: "pi-dashboards-canvas",
		mobileDataTestid: "pi-dashboards-mobile-panel",
		badgeSource: undefined,
		loadingSource: undefined,
		refreshSource: undefined,
	},
} satisfies Record<ActiveRightPanel, RightPanelDefinition>;

export const RIGHT_PANEL_DEFINITIONS = Object.values(RIGHT_PANEL_REGISTRY).sort(
	(left, right) => left.order - right.order,
);

/** Top-level panel destinations. Individual views remain addressable by their existing panel IDs. */
export const RIGHT_PANEL_GROUPS: ReadonlyArray<RightPanelGroup> = [
	{
		id: "workspace",
		title: "Workspace",
		ariaLabel: "Workspace",
		icon: Folder,
		defaultPanel: "workspace",
		panels: ["workspace"],
	},
	{
		id: "artifacts",
		title: "Artifacts",
		ariaLabel: "Artifacts",
		icon: Package,
		defaultPanel: "artifacts",
		panels: ["artifacts"],
	},
	{
		id: "dashboards",
		title: "Dashboards",
		ariaLabel: "Dashboards",
		icon: LayoutDashboard,
		defaultPanel: "dashboards",
		panels: ["dashboards"],
	},
	{
		id: "subagents",
		title: "Subagents",
		ariaLabel: "Subagents",
		icon: Bot,
		defaultPanel: "subagents",
		panels: ["subagents"],
	},
	{
		id: "session",
		title: "Session",
		ariaLabel: "Session",
		icon: Activity,
		defaultPanel: "session-insights",
		panels: ["resources", "session-insights", "session-tree"],
	},
];

export function getRightPanelGroup(panel: ActiveRightPanel) {
	return RIGHT_PANEL_GROUPS.find((group) => group.panels.includes(panel));
}

/**
 * Retrieves the registry definition for a right panel.
 *
 * @param panel - The active right panel identifier
 * @returns The definition associated with `panel`
 */
export function getRightPanelDefinition(panel: ActiveRightPanel) {
	return RIGHT_PANEL_REGISTRY[panel];
}
