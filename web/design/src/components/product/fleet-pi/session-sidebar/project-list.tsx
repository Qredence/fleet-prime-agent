import { ChevronDown, CircleStop, Folder, FolderPlus, LoaderCircle, MessageSquarePlus, MoreHorizontal, Plus, TriangleAlert } from "lucide-react";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import type { AISidebarProps, SidebarResource } from "../../../registry/beui/agents/ai-sidebar";
import { AISidebar } from "../../../registry/beui/agents/ai-sidebar";
import { Popover } from "../../../registry/beui/agents/input/input-popover";
import { ProjectFolder } from "../../../registry/beui/motion/project-folder";
import { Button } from "../../../ui/button";
import { AnimatedSidebarContent, AnimatedSidebarGroup, AnimatedSidebarGroupContent, AnimatedSidebarGroupLabel } from "../../../registry/beui/motion/animated-sidebar";
import type { SidebarStateView } from "./state";
import type { FleetSessionSidebarDependencies } from "./types";
import { PROJECT_PREFIX, SESSION_PREFIX, idValue, projectResourceId, sessionResourceId } from "./types";

type SidebarProjectListProps = {
	projectActionsOpen: SidebarStateView["projectActionsOpen"];
	setProjectActionsOpen: SidebarStateView["setProjectActionsOpen"];
	expandedProjectIds: SidebarStateView["expandedProjectIds"];
	setExpandedProjectIds: SidebarStateView["setExpandedProjectIds"];
	setCreateOpen: SidebarStateView["setCreateOpen"];
	projects: Array<ProjectSummary>;
	projectSessions: Array<ChatSessionInfo>;
	sidebarItems: SidebarResource[];
	activeProjectId?: ProjectId;
	activeSessionId?: string;
	onNewSession: () => void;
	onNewSessionInProject?: (projectId: ProjectId) => void | Promise<void>;
	onProjectSelect?: (projectId: ProjectId) => void | Promise<void>;
	onRenameSession: (sessionId: string, title: string) => void;
	onCreateProject?: FleetSessionSidebarDependencies["onCreateProject"];
	resumeResource: (id: string) => void;
	toggleProjectResource: (id: string) => void;
	renderMenu: NonNullable<AISidebarProps["renderMenu"]>;
};

function sessionStatusIcon(session: ChatSessionInfo | undefined) {
	if (session?.status === "running") {
		return <LoaderCircle className="size-3.5 animate-spin" />;
	}
	if (session?.status === "failed") {
		return <TriangleAlert className="size-3.5 text-destructive" />;
	}
	if (session?.status === "interrupted") {
		return <CircleStop className="size-3.5 text-muted-foreground" />;
	}
	return null;
}

export function FleetSessionSidebarProjectList({
	projectActionsOpen,
	setProjectActionsOpen,
	expandedProjectIds,
	setExpandedProjectIds,
	setCreateOpen,
	projects,
	projectSessions,
	sidebarItems,
	activeProjectId,
	activeSessionId,
	onNewSession,
	onNewSessionInProject,
	onProjectSelect,
	onRenameSession,
	onCreateProject,
	resumeResource,
	toggleProjectResource,
	renderMenu,
}: SidebarProjectListProps) {
	return (
		<AnimatedSidebarContent className="gap-0 px-2 pb-1 pt-2">
			<AnimatedSidebarGroup className="p-0">
				<div className="relative mb-1 h-8">
					<AnimatedSidebarGroupLabel className="mb-0 h-8 pr-16 text-xs font-normal normal-case tracking-normal text-muted-foreground">
						Projects
					</AnimatedSidebarGroupLabel>
					<div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
						<Popover
							open={projectActionsOpen}
							onOpenChange={setProjectActionsOpen}
							side="bottom"
							align="end"
							className="w-44 bg-popover p-1"
							trigger={
								<button
									type="button"
									aria-label="Project actions"
									title="Project actions"
									className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
								>
									<MoreHorizontal aria-hidden="true" className="size-3.5" />
								</button>
							}
						>
							{onCreateProject ? (
								<button
									type="button"
									onClick={() => {
										setProjectActionsOpen(false);
										setCreateOpen(true);
									}}
									className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted"
								>
									<FolderPlus aria-hidden="true" className="size-3.5" />
									Add project
								</button>
							) : null}
							<button
								type="button"
								onClick={() => {
									setProjectActionsOpen(false);
									setExpandedProjectIds([]);
								}}
								className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs outline-none hover:bg-muted focus-visible:bg-muted"
							>
								<ChevronDown aria-hidden="true" className="size-3.5" />
								Collapse all
							</button>
						</Popover>
						{onCreateProject ? (
							<button
								type="button"
								aria-label="Add project"
								title="Add project"
								onClick={() => setCreateOpen(true)}
								className="grid size-6 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
							>
								<Plus aria-hidden="true" className="size-3.5" />
							</button>
						) : null}
					</div>
				</div>
				<AnimatedSidebarGroupContent>
					{projects.length === 0 ? (
						<div className="px-2 py-4">
							<ProjectFolder
								title="Add a project"
								description="Choose a local directory for Fleet Prime."
								count={0}
								itemLabel="session"
								previews={[
									{
										id: "empty-project",
										content: <FolderPlus className="size-5 text-muted-foreground" />,
									},
								]}
								onClick={() => setCreateOpen(true)}
								ariaLabel="Add a project"
								className="w-full"
							/>
						</div>
					) : (
						<AISidebar
							items={sidebarItems}
							activeId={activeSessionId ? sessionResourceId(activeSessionId) : null}
							activeContainerId={activeProjectId ? projectResourceId(activeProjectId) : null}
							expandedIds={expandedProjectIds}
							onExpandedIdsChange={setExpandedProjectIds}
							onActiveChange={resumeResource}
							onContainerSelect={toggleProjectResource}
							onRename={(item, label) => {
								const sessionId = idValue(item.id, SESSION_PREFIX);
								if (sessionId) onRenameSession(sessionId, label);
							}}
							renderMenu={renderMenu}
							renderIcon={(item) => {
								const projectId = idValue(item.id, PROJECT_PREFIX);
								if (projectId) return <Folder className="size-4" />;
								if (item.kind === "action") return null;
								const sessionId = idValue(item.id, SESSION_PREFIX);
								const session = projectSessions.find((entry) => entry.sessionId === sessionId);
								return sessionStatusIcon(session);
							}}
							renderSecondaryAction={(item) => {
								const projectId = idValue(item.id, PROJECT_PREFIX);
								if (!projectId || projectId === "unassigned") return null;
								return (
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={`New chat in ${item.label}`}
										title={`New chat in ${item.label}`}
										onClick={(event) => {
											event.stopPropagation();
											if (onNewSessionInProject) {
												void onNewSessionInProject(projectId);
											} else {
												void onProjectSelect?.(projectId);
												onNewSession();
											}
										}}
										className="size-7 shrink-0 opacity-0 group-hover/resource:opacity-100 group-focus-within/resource:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
									>
										<MessageSquarePlus data-icon="inline-start" className="size-3.5" />
									</Button>
								);
							}}
							allowMove={false}
							ariaLabel="Projects and sessions"
							className="px-0"
						/>
					)}
				</AnimatedSidebarGroupContent>
			</AnimatedSidebarGroup>
		</AnimatedSidebarContent>
	);
}
