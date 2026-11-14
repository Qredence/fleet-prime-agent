import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	BookOpenText,
	ChevronDown,
	CircleHelp,
	Folder,
	FolderPlus,
	Library,
	Package,
	Pencil,
	Search,
	Settings,
	SquarePen,
	Trash2,
	Unplug,
} from "lucide-react";
import type { ReactNode, SVGProps } from "react";
import { lazy, Suspense, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	AnimatedSidebar,
	AnimatedSidebarFooter,
	AnimatedSidebarHeader,
	AnimatedSidebarRail,
} from "@/components/layout/animated-sidebar";
import { SessionSidebarProjectList } from "@/components/sessions/session-sidebar/project-list";
import type { SidebarResource } from "@/components/sessions/session-sidebar/resource-tree";
import { Button } from "@/components/ui/button";
import type { SidebarStateView } from "@/hooks/sessions/use-session-sidebar";
import { fleetVersion } from "@/lib/fleet-version";
import { SurfaceProvider } from "@/lib/fluid/surface-context";
import {
	DISCORD_URL,
	DOCUMENTATION_URL,
	idValue,
	SESSION_PREFIX,
	type SessionDialog,
	type SessionSidebarDependencies,
	TWITTER_URL,
} from "@/lib/sessions/sidebar-types";
import { cn } from "@/lib/utils";

const ThreadSearchPopover = lazy(() =>
	import("@/components/sessions/session-sidebar/thread-search-popover").then(({ ThreadSearchPopover: popover }) => ({
		default: popover,
	})),
);

type SidebarNavigationProps = {
	brandMenuOpen: SidebarStateView["brandMenuOpen"];
	setBrandMenuOpen: SidebarStateView["setBrandMenuOpen"];
	searchOpen: SidebarStateView["searchOpen"];
	setSearchOpen: SidebarStateView["setSearchOpen"];
	query: SidebarStateView["query"];
	setQuery: SidebarStateView["setQuery"];
	projectActionsOpen: SidebarStateView["projectActionsOpen"];
	setProjectActionsOpen: SidebarStateView["setProjectActionsOpen"];
	expandedProjectIds: SidebarStateView["expandedProjectIds"];
	setExpandedProjectIds: SidebarStateView["setExpandedProjectIds"];
	onOpenCreateProject: () => void;
	projects: Array<ProjectSummary>;
	projectSessions: Array<ChatSessionInfo>;
	sidebarItems: SidebarResource[];
	sortedProjects: Array<ProjectSummary>;
	projectById: Map<ProjectId, ProjectSummary>;
	activeProjectId?: ProjectId;
	activeSessionId?: string;
	onNewSession: () => void;
	onNewSessionInProject?: (projectId: ProjectId) => void | Promise<void>;
	onProjectSelect?: (projectId: ProjectId) => void | Promise<void>;
	onRenameSession: (sessionId: string, title: string) => void;
	onCreateProject?: SessionSidebarDependencies["onCreateProject"];
	onOpenSettings?: () => void;
	onOpenPanelAction?: SessionSidebarDependencies["onOpenPanelAction"];
	setActiveDialog: (dialog: SessionDialog) => void;
	accountMenu?: ReactNode;
	resumeResource: (id: string) => void;
	toggleProjectResource: (id: string) => void;
	selectSearchResult: (value: string) => void;
};

type MenuItemControls = { close: () => void };

const PANEL_ACTIONS = [
	["resources", "Open Resources", Library],
	["workspace", "Open Workspace", Folder],
	["artifacts", "Open Artifacts", Package],
] as const;

type SocialIconProps = SVGProps<SVGSVGElement>;

function XIcon({ className, ...props }: SocialIconProps) {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className} {...props}>
			<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
		</svg>
	);
}

function DiscordIcon({ className, ...props }: SocialIconProps) {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className} {...props}>
			<path d="M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.7 19.7 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.08.08 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14 14 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.8 19.8 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
		</svg>
	);
}

function VersionBadge() {
	const version = fleetVersion();
	return (
		<Badge
			variant="secondary"
			title={`Fleet ${version}`}
			aria-label={`Fleet version ${version}`}
			className="shrink-0 font-mono text-xs font-normal text-muted-foreground"
		>
			v{version}
		</Badge>
	);
}

function MenuItem({
	icon: Icon,
	label,
	destructive = false,
	onClick,
}: {
	icon: typeof Pencil;
	label: string;
	destructive?: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="compact"
			onClick={onClick}
			className={
				destructive
					? "w-full justify-start gap-2 rounded-lg px-2.5 text-left text-xs font-normal text-destructive shadow-none hover:bg-destructive/10 hover:text-destructive"
					: "w-full justify-start gap-2 rounded-lg px-2.5 text-left text-xs font-normal shadow-none hover:bg-muted"
			}
		>
			<Icon className="size-3.5" />
			{label}
		</Button>
	);
}

const MENU_ITEM_CLASS =
	"flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:bg-muted";

const SIDEBAR_ITEM_BUTTON_CLASS =
	"flex h-8 w-full items-center justify-start gap-2 rounded-lg px-2 text-sm font-normal text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring";

function SidebarMenuItem({
	icon: Icon,
	label,
	onClick,
	href,
	to,
}: {
	icon?: LucideIcon;
	label: string;
	onClick?: () => void;
	href?: string;
	to?: "/agents" | "/connectors";
}) {
	if (to) {
		// Internal navigation goes through the router: a raw <a href> forced a
		// full document reload and discarded in-flight client state.
		return (
			<Link to={to} className={MENU_ITEM_CLASS} onClick={onClick}>
				{Icon ? <Icon className="size-3.5" /> : null}
				{label}
			</Link>
		);
	}
	if (href) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={MENU_ITEM_CLASS}>
				{Icon ? <Icon className="size-3.5" /> : null}
				{label}
			</a>
		);
	}
	return (
		<Button
			type="button"
			variant="ghost"
			size="compact"
			onClick={onClick}
			className="w-full justify-start gap-2 rounded-md px-2 text-xs font-normal shadow-none hover:bg-muted"
		>
			{Icon ? <Icon className="size-3.5" /> : null}
			{label}
		</Button>
	);
}

export function SessionSidebarNavigation({
	brandMenuOpen,
	setBrandMenuOpen,
	searchOpen,
	setSearchOpen,
	query,
	setQuery,
	projectActionsOpen,
	setProjectActionsOpen,
	expandedProjectIds,
	setExpandedProjectIds,
	onOpenCreateProject,
	projects,
	projectSessions,
	sidebarItems,
	sortedProjects,
	projectById,
	activeProjectId,
	activeSessionId,
	onNewSession,
	onNewSessionInProject,
	onProjectSelect,
	onRenameSession,
	onCreateProject,
	onOpenSettings,
	onOpenPanelAction,
	setActiveDialog,
	accountMenu,
	resumeResource,
	toggleProjectResource,
	selectSearchResult,
}: SidebarNavigationProps) {
	const renderMenu = useCallback(
		(item: SidebarResource, controls: MenuItemControls) => {
			const sessionId = idValue(item.id, SESSION_PREFIX);
			const projectId = idValue(item.id, "project:");
			if (sessionId) {
				const session = projectSessions.find((entry) => entry.sessionId === sessionId);
				if (!session) return null;
				const sessionProjectId = session.projectId ?? undefined;
				return (
					<>
						<MenuItem
							icon={Pencil}
							label="Rename"
							onClick={() => {
								controls.close();
								setActiveDialog({ kind: "rename-session", session });
							}}
						/>
						{onOpenPanelAction && sessionProjectId ? (
							<>
								<div className="my-1 border-t" />
								{PANEL_ACTIONS.map(([panel, label, Icon]) => (
									<MenuItem
										key={panel}
										icon={Icon}
										label={label}
										onClick={() => {
											controls.close();
											onOpenPanelAction({ panel, projectId: sessionProjectId, focus: true });
										}}
									/>
								))}
							</>
						) : null}
						<MenuItem
							icon={Trash2}
							label="Delete"
							destructive
							onClick={() => {
								controls.close();
								setActiveDialog({ kind: "delete-session", session });
							}}
						/>
					</>
				);
			}
			if (projectId && projectId !== "unassigned") {
				const project = projectById.get(projectId);
				if (!project) return null;
				return (
					<>
						<MenuItem
							icon={Pencil}
							label="Rename project"
							onClick={() => {
								controls.close();
								setActiveDialog({ kind: "rename-project", project });
							}}
						/>
						<MenuItem
							icon={Unplug}
							label="Unregister project"
							destructive
							onClick={() => {
								controls.close();
								setActiveDialog({ kind: "unregister-project", project });
							}}
						/>
						{onOpenPanelAction ? (
							<>
								<div className="my-1 border-t" />
								{PANEL_ACTIONS.map(([panel, label, Icon]) => (
									<MenuItem
										key={panel}
										icon={Icon}
										label={label}
										onClick={() => {
											controls.close();
											onOpenPanelAction({ panel, projectId, focus: true });
										}}
									/>
								))}
							</>
						) : null}
					</>
				);
			}
			return null;
		},
		[onOpenPanelAction, projectById, projectSessions, setActiveDialog],
	);

	return (
		<AnimatedSidebar
			ariaLabel="Fleet projects and sessions"
			collapsible="offcanvas"
			variant="floating"
			className="text-sidebar-foreground"
		>
			{/* The floating rail is a surface-2 card; menus opened inside lift from it. */}
			<SurfaceProvider value={2}>
				<AnimatedSidebarHeader className="gap-2 border-0 px-2.5 pb-2 pt-2.5">
					<div className="relative flex h-9 min-w-0 items-center justify-between gap-1">
						<Popover open={brandMenuOpen} onOpenChange={setBrandMenuOpen}>
							<PopoverTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="compact"
										className="w-fit shrink-0 justify-start gap-1 rounded-lg px-2 text-start text-sm font-medium shadow-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
									>
										<span className="truncate">Qredence Fleet</span>
										<ChevronDown className="size-3.5 text-muted-foreground" />
									</Button>
								}
							/>
							<PopoverContent side="bottom" align="start" sideOffset={6} className="w-52 gap-0 p-1">
								{onCreateProject ? (
									<SidebarMenuItem
										icon={FolderPlus}
										label="Add project"
										onClick={() => {
											setBrandMenuOpen(false);
											onOpenCreateProject();
										}}
									/>
								) : null}
								<SidebarMenuItem
									icon={Settings}
									label="Settings"
									onClick={() => {
										setBrandMenuOpen(false);
										onOpenSettings?.();
									}}
								/>
								<SidebarMenuItem label="Agents" to="/agents" />
								<SidebarMenuItem label="Connectors" to="/connectors" />
								<SidebarMenuItem icon={BookOpenText} label="Documentation" href={DOCUMENTATION_URL} />
							</PopoverContent>
						</Popover>

						<Popover open={searchOpen} onOpenChange={setSearchOpen}>
							<PopoverTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="Search projects and sessions"
										title="Search projects and sessions"
										className="shrink-0 text-muted-foreground hover:bg-sidebar-accent"
									>
										<Search data-icon="inline-start" className="size-4" />
									</Button>
								}
							/>
							<PopoverContent side="bottom" align="end" sideOffset={6} className="w-72 gap-0 p-0">
								{searchOpen ? (
									<Suspense
										fallback={
											<div
												data-slot="thread-search-loading"
												role="status"
												className="flex items-center justify-center bg-popover px-3 py-6 text-xs text-muted-foreground"
											>
												Loading search…
											</div>
										}
									>
										<ThreadSearchPopover
											activeSessionId={activeSessionId}
											projectById={projectById}
											projectSessions={projectSessions}
											query={query}
											selectSearchResult={selectSearchResult}
											setQuery={setQuery}
											sortedProjects={sortedProjects}
										/>
									</Suspense>
								) : null}
							</PopoverContent>
						</Popover>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="compact"
						onClick={onNewSession}
						className={cn(SIDEBAR_ITEM_BUTTON_CLASS, "shadow-none")}
					>
						<SquarePen className="size-4 shrink-0 text-muted-foreground" />
						New chat
					</Button>
				</AnimatedSidebarHeader>
				<SessionSidebarProjectList
					projectActionsOpen={projectActionsOpen}
					setProjectActionsOpen={setProjectActionsOpen}
					expandedProjectIds={expandedProjectIds}
					setExpandedProjectIds={setExpandedProjectIds}
					onOpenCreateProject={onOpenCreateProject}
					projects={projects}
					projectSessions={projectSessions}
					sidebarItems={sidebarItems}
					activeProjectId={activeProjectId}
					activeSessionId={activeSessionId}
					onNewSession={onNewSession}
					onNewSessionInProject={onNewSessionInProject}
					onProjectSelect={onProjectSelect}
					onRenameSession={onRenameSession}
					onCreateProject={onCreateProject}
					resumeResource={resumeResource}
					toggleProjectResource={toggleProjectResource}
					renderMenu={renderMenu}
				/>
				<AnimatedSidebarFooter className="flex-col gap-1 border-sidebar-border px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
					<a href={TWITTER_URL} target="_blank" rel="noreferrer" className={SIDEBAR_ITEM_BUTTON_CLASS}>
						<XIcon className="size-4 shrink-0 text-muted-foreground" />
						Twitter
					</a>
					<a href={DISCORD_URL} target="_blank" rel="noreferrer" className={SIDEBAR_ITEM_BUTTON_CLASS}>
						<DiscordIcon className="size-4 shrink-0 text-muted-foreground" />
						Discord
					</a>
					<div className="flex w-full flex-row items-center gap-1">
						<div className="min-w-0 flex-1">
							{accountMenu ?? <span className="flex h-8 items-center px-2 text-sm">Qredence</span>}
						</div>
						<VersionBadge />
						<a
							href={DOCUMENTATION_URL}
							target="_blank"
							rel="noreferrer"
							aria-label="Open Qredence documentation"
							title="Help"
							className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
						>
							<CircleHelp className="size-4" />
						</a>
					</div>
				</AnimatedSidebarFooter>
				<AnimatedSidebarRail />
			</SurfaceProvider>
		</AnimatedSidebar>
	);
}
