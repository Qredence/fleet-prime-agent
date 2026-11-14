import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import {
	ChevronDown,
	ChevronUp,
	CircleStop,
	Folder,
	FolderPlus,
	LoaderCircle,
	MoreHorizontal,
	Plus,
	SquarePen,
	TriangleAlert,
} from "lucide-react";
import {
	AnimatedSidebarContent,
	AnimatedSidebarGroup,
	AnimatedSidebarGroupContent,
	AnimatedSidebarGroupLabel,
} from "@/components/layout/animated-sidebar";
import {
	AISidebar,
	type AISidebarProps,
	type SidebarResource,
} from "@/components/sessions/session-sidebar/resource-tree";
import type { SidebarStateView } from "@/hooks/sessions/use-session-sidebar";
import type { SessionSidebarDependencies } from "@/lib/sessions/sidebar-types";
import {
	idValue,
	PROJECT_PREFIX,
	projectResourceId,
	SESSION_PREFIX,
	sessionResourceId,
} from "@/lib/sessions/sidebar-types";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type SidebarProjectListProps = {
	projectActionsOpen: SidebarStateView["projectActionsOpen"];
	setProjectActionsOpen: SidebarStateView["setProjectActionsOpen"];
	expandedProjectIds: SidebarStateView["expandedProjectIds"];
	setExpandedProjectIds: SidebarStateView["setExpandedProjectIds"];
	onOpenCreateProject: () => void;
	projects: Array<ProjectSummary>;
	projectSessions: Array<ChatSessionInfo>;
	sidebarItems: SidebarResource[];
	activeProjectId?: ProjectId;
	activeSessionId?: string;
	onNewSession: () => void;
	onNewSessionInProject?: (projectId: ProjectId) => void | Promise<void>;
	onProjectSelect?: (projectId: ProjectId) => void | Promise<void>;
	onRenameSession: (sessionId: string, title: string) => void;
	onCreateProject?: SessionSidebarDependencies["onCreateProject"];
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

export function SessionSidebarProjectList({
	projectActionsOpen,
	setProjectActionsOpen,
	expandedProjectIds,
	setExpandedProjectIds,
	onOpenCreateProject,
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
		<AnimatedSidebarContent className="gap-0 px-2.5 pb-1 pt-2">
			<AnimatedSidebarGroup className="p-0">
				<div className="relative mb-1 h-8">
					<AnimatedSidebarGroupLabel className="mb-0 h-8 pe-20 text-xs font-normal normal-case tracking-normal text-muted-foreground">
						Projects
					</AnimatedSidebarGroupLabel>
					<div className="absolute inset-y-0 left-auto flex items-center gap-0.5 [inset-inline-start:auto] [inset-inline-end:0]">
						<Popover open={projectActionsOpen} onOpenChange={setProjectActionsOpen}>
							<PopoverTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-compact"
										aria-label="Project actions"
										title="Project actions"
										className="hit-area-expand-dense text-muted-foreground hover:bg-muted hover:text-foreground"
									>
										<MoreHorizontal aria-hidden="true" className="size-3.5" />
									</Button>
								}
							/>
							<PopoverContent side="bottom" align="end" sideOffset={6} className="w-44 gap-0 p-1">
								{onCreateProject ? (
									<Button
										type="button"
										variant="ghost"
										size="compact"
										onClick={() => {
											setProjectActionsOpen(false);
											onOpenCreateProject();
										}}
										className="w-full justify-start gap-2 rounded-md px-2 text-xs font-normal shadow-none hover:bg-muted focus-visible:bg-muted"
									>
										<FolderPlus aria-hidden="true" className="size-3.5" />
										Add project
									</Button>
								) : null}
								<Button
									type="button"
									variant="ghost"
									size="compact"
									onClick={() => {
										setProjectActionsOpen(false);
										setExpandedProjectIds([]);
									}}
									className="w-full justify-start gap-2 rounded-md px-2 text-xs font-normal shadow-none hover:bg-muted focus-visible:bg-muted"
								>
									<ChevronDown aria-hidden="true" className="size-3.5" />
									Collapse all
								</Button>
							</PopoverContent>
						</Popover>
						{onCreateProject ? (
							<Button
								type="button"
								variant="ghost"
								size="icon-compact"
								aria-label="Add project"
								title="Add project"
								onClick={onOpenCreateProject}
								className="hit-area-expand-dense text-muted-foreground hover:bg-muted hover:text-foreground"
							>
								<Plus aria-hidden="true" className="size-3.5" />
							</Button>
						) : null}
					</div>
				</div>
				<AnimatedSidebarGroupContent>
					{projects.length === 0 ? (
						<div className="px-2 py-4">
							<Card size="sm" className="gap-2 bg-muted/30">
								<CardHeader className="gap-1">
									<div className="flex items-center gap-2 text-muted-foreground">
										<FolderPlus className="size-4 shrink-0" />
										<CardTitle className="text-sm font-medium text-foreground">Add a project</CardTitle>
									</div>
									<CardDescription className="text-xs">
										Choose a local directory for Fleet Prime.
									</CardDescription>
								</CardHeader>
								<div className="px-4 pb-3">
									<Button
										type="button"
										variant="outline"
										size="compact"
										className="w-full"
										onClick={onOpenCreateProject}
									>
										Add a project
									</Button>
								</div>
							</Card>
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
								if (item.id.startsWith("toggle:")) {
									return item.label === "Show less" ? (
										<ChevronUp className="size-4" />
									) : (
										<ChevronDown className="size-4" />
									);
								}
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
										size="icon"
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
										className="size-8 shrink-0 opacity-0 group-hover/resource:opacity-100 group-focus-within/resource:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
									>
										<SquarePen data-icon="inline-start" className="size-3.5" />
									</Button>
								);
							}}
							className="px-0"
						/>
					)}
				</AnimatedSidebarGroupContent>
			</AnimatedSidebarGroup>
		</AnimatedSidebarContent>
	);
}
