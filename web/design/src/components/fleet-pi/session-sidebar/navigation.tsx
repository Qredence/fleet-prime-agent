import { BookOpenText, ChevronDown, CircleHelp, Folder, FolderPlus, Search, Settings, SquarePen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import type { AISidebarProps, SidebarResource } from "../../agents/ai-sidebar";
import { Popover } from "../../agents/input/popover";
import { ThreadSearch, type SearchableThread } from "../../elements/thread-search";
import { AnimatedSidebar, AnimatedSidebarFooter, AnimatedSidebarHeader, AnimatedSidebarRail } from "../../motion/animated-sidebar";
import { normalizeSessionLabel } from "../../../lib/pi/chat-helpers";
import { sortSessions } from "../session-sidebar-model";
import { FleetSessionSidebarProjectList } from "./project-list";
import type { SidebarStateView } from "./state";
import {
	DOCUMENTATION_URL,
	type FleetSessionSidebarProps,
	sessionDiscoveryMeta,
	sessionLabel,
	sessionSearchGroup,
} from "./types";

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
	setCreateOpen: SidebarStateView["setCreateOpen"];
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
	onCreateProject?: FleetSessionSidebarProps["onCreateProject"];
	onOpenSettings?: () => void;
	accountMenu?: ReactNode;
	resumeResource: (id: string) => void;
	toggleProjectResource: (id: string) => void;
	selectSearchResult: (value: string) => void;
	renderMenu: NonNullable<AISidebarProps["renderMenu"]>;
};

const MENU_ITEM_CLASS =
	"flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:bg-muted";

function SidebarMenuItem({
	icon: Icon,
	label,
	onClick,
	href,
}: {
	icon: LucideIcon;
	label: string;
	onClick?: () => void;
	href?: string;
}) {
	if (href) {
		return (
			<a href={href} target="_blank" rel="noreferrer" className={MENU_ITEM_CLASS}>
				<Icon className="size-3.5" />
				{label}
			</a>
		);
	}
	return (
		<button type="button" onClick={onClick} className={MENU_ITEM_CLASS}>
			<Icon className="size-3.5" />
			{label}
		</button>
	);
}

function KbdHint({ children }: { children: ReactNode }) {
	return (
		<kbd className="rounded border border-border/60 bg-muted/60 px-1 font-mono text-[10px] leading-4 text-muted-foreground">
			{children}
		</kbd>
	);
}

export function FleetSessionSidebarNavigation({
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
	setCreateOpen,
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
	accountMenu,
	resumeResource,
	toggleProjectResource,
	selectSearchResult,
	renderMenu,
}: SidebarNavigationProps) {
	const searchThreads = useMemo<Array<SearchableThread>>(
		() =>
			sortSessions(projectSessions).map((session) => ({
				id: session.sessionId,
				title: sessionLabel(session),
				preview: sessionDiscoveryMeta(session, projectById),
				group: sessionSearchGroup(session.updatedAt),
				// Keep the initial prompt searchable; a renamed session no longer
				// matches its own first message otherwise (combobox keyword parity).
				keywords: session.firstMessage ? [normalizeSessionLabel(session.firstMessage)] : [],
			})),
		[projectById, projectSessions],
	);
	const matchingProjects = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return sortedProjects;
		return sortedProjects.filter((project) =>
			`${project.name} ${project.pathLabel}`.toLowerCase().includes(needle),
		);
	}, [query, sortedProjects]);
	return (
		<AnimatedSidebar
			ariaLabel="Fleet projects and sessions"
			collapsible="offcanvas"
			className="bg-sidebar text-sidebar-foreground"
			panelClassName="border-r border-sidebar-border bg-sidebar shadow-none"
		>
			<AnimatedSidebarHeader className="gap-2 border-0 px-2.5 pb-2 pt-2.5">
				<div className="relative flex h-9 min-w-0 items-center gap-1">
					<Popover
						open={brandMenuOpen}
						onOpenChange={setBrandMenuOpen}
						side="bottom"
						align="start"
						trigger={
							<button
								type="button"
								className="flex h-8 w-fit shrink-0 items-center gap-1 rounded-lg px-2 text-left text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
							>
								<span className="truncate">Qredence Fleet</span>
								<ChevronDown className="size-3.5 text-muted-foreground" />
							</button>
						}
						className="w-52 bg-popover p-1"
					>
						{onCreateProject ? (
							<SidebarMenuItem
								icon={FolderPlus}
								label="Add project"
								onClick={() => {
									setBrandMenuOpen(false);
									setCreateOpen(true);
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
						<SidebarMenuItem icon={BookOpenText} label="Documentation" href={DOCUMENTATION_URL} />
					</Popover>

					<Popover
						open={searchOpen}
						onOpenChange={setSearchOpen}
						side="bottom"
						align="end"
						className="w-64 bg-popover p-0"
						trigger={
							<button
								type="button"
								aria-label="Search projects and sessions"
								title="Search projects and sessions"
								className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
							>
								<Search className="size-4" />
							</button>
						}
					>
						<div className="max-h-[min(32rem,calc(100vh-5rem))] overflow-y-auto">
							<ThreadSearch
								threads={searchThreads}
								query={query}
								activeId={activeSessionId ?? ""}
								onQueryChange={setQuery}
								onSelect={(sessionId) => selectSearchResult(`search-session:${sessionId}`)}
								className="max-w-none rounded-none border-0 bg-transparent p-2 shadow-none"
							/>
							<div className="border-t border-border/60 px-2 pb-2 pt-1.5">
								<span className="px-2 pb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
									Projects
								</span>
								<div className="mt-1 flex flex-col gap-0.5">
									{matchingProjects.map((project) => (
										<button
											key={project.projectId}
											type="button"
											onClick={() => selectSearchResult(`search-project:${project.projectId}`)}
											className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs outline-none transition-colors hover:bg-foreground/[0.03] focus-visible:ring-2 focus-visible:ring-ring"
										>
											<Folder className="size-3.5 shrink-0 text-muted-foreground/60" />
											<span className="min-w-0 flex-1 truncate">{project.name}</span>
											<span className="max-w-24 truncate text-[10px] text-muted-foreground/55">{project.pathLabel}</span>
										</button>
									))}
									{matchingProjects.length === 0 ? (
										<span className="px-2 py-2 text-center text-[11px] text-muted-foreground/60">
											No project matches “{query}”
										</span>
									) : null}
								</div>
							</div>
							<div className="flex items-center justify-end gap-3 border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground/70">
								<span className="flex items-center gap-1">
									<KbdHint>↑</KbdHint>
									<KbdHint>↓</KbdHint>
									navigate
								</span>
								<span className="flex items-center gap-1">
									<KbdHint>↵</KbdHint>
									open
								</span>
								<span className="flex items-center gap-1">
									<KbdHint>esc</KbdHint>
									close
								</span>
							</div>
						</div>
					</Popover>
				</div>
				<button
					type="button"
					onClick={onNewSession}
					className="flex h-8 w-full items-center justify-start gap-2 rounded-lg px-2 text-[13px] font-normal text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
				>
					<SquarePen className="size-4 shrink-0 text-muted-foreground" />
					New chat
				</button>
			</AnimatedSidebarHeader>
			<FleetSessionSidebarProjectList
				projectActionsOpen={projectActionsOpen}
				setProjectActionsOpen={setProjectActionsOpen}
				expandedProjectIds={expandedProjectIds}
				setExpandedProjectIds={setExpandedProjectIds}
				setCreateOpen={setCreateOpen}
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
			<AnimatedSidebarFooter className="flex-row items-center gap-1 border-sidebar-border px-2.5 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
				<div className="min-w-0 flex-1">
					{accountMenu ?? <span className="flex h-8 items-center px-2 text-[13px]">Qredence</span>}
				</div>
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
			</AnimatedSidebarFooter>
			<AnimatedSidebarRail />
		</AnimatedSidebar>
	);
}
