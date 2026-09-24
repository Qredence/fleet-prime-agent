import type { ProjectId } from "@prime-agent/web-protocol";
import { Folder, FolderTree, Library, Package, Pencil, Trash2, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import type { SidebarResource } from "@/components/layout/ai-sidebar";
import {
	EMPTY_PROJECTS,
	EXPANDED_PROJECTS_STORAGE_KEY,
	idValue,
	NEW_SESSION_PREFIX,
	newSessionResourceId,
	projectResourceId,
	SESSION_PREFIX,
	type SessionDialog,
	type SessionSidebarDependencies,
	sessionLabel,
	sessionResourceId,
} from "@/components/sessions/session-sidebar/types";
import {
	displayProjectSessions,
	INITIAL_SESSION_COUNT,
	sortProjectsByActivity,
	sortSessions,
	visibleProjectSessions,
} from "@/components/sessions/session-sidebar-model";
import { writeStoredValue } from "@/lib/safe-storage";

export type SidebarViewModelState = {
	expandedProjectIds: string[];
	revealedProjectIds: Set<ProjectId>;
	setExpandedProjectIds: (value: string[] | ((current: string[]) => string[])) => void;
	setRevealedProjectIds: (value: Set<ProjectId> | ((current: Set<ProjectId>) => Set<ProjectId>)) => void;
	setSearchOpen: (value: boolean) => void;
	setActiveDialog: (dialog: SessionDialog) => void;
};

export type SidebarViewModelOptions = Pick<
	SessionSidebarDependencies,
	| "sessions"
	| "projects"
	| "projectSessions"
	| "activeProjectId"
	| "activeSessionId"
	| "onNewSession"
	| "onNewSessionInProject"
	| "onProjectSelect"
	| "onResumeSession"
	| "onForkSessionIntoProject"
	| "onOpenPanelAction"
> &
	SidebarViewModelState;

export type MenuItemControls = { close: () => void };

const PANEL_ACTIONS = [
	["resources", "Open Resources", Library],
	["workspace", "Open Workspace", Folder],
	["artifacts", "Open Artifacts", Package],
] as const;

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
		<button
			type="button"
			onClick={onClick}
			className={
				destructive
					? "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-destructive hover:bg-destructive/10"
					: "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs hover:bg-muted"
			}
		>
			<Icon className="size-3.5" />
			{label}
		</button>
	);
}

/**
 * Builds the fleet session sidebar view model and its interaction handlers.
 */
export function useSessionSidebarViewModel({
	sessions,
	projects = EMPTY_PROJECTS,
	projectSessions = sessions,
	activeProjectId,
	activeSessionId,
	onNewSession,
	onNewSessionInProject,
	onProjectSelect,
	onResumeSession,
	onForkSessionIntoProject,
	onOpenPanelAction,
	expandedProjectIds,
	revealedProjectIds,
	setExpandedProjectIds,
	setRevealedProjectIds,
	setSearchOpen,
	setActiveDialog,
}: SidebarViewModelOptions) {
	const projectById = useMemo(() => new Map(projects.map((project) => [project.projectId, project])), [projects]);

	const sortedProjects = useMemo(() => sortProjectsByActivity(projects, projectSessions), [projectSessions, projects]);

	useEffect(() => {
		if (!activeProjectId) return;
		const resourceId = projectResourceId(activeProjectId);
		setExpandedProjectIds((current) => (current.includes(resourceId) ? current : [...current, resourceId]));
	}, [activeProjectId, setExpandedProjectIds]);

	useEffect(() => {
		writeStoredValue(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify(expandedProjectIds));
	}, [expandedProjectIds]);

	const sidebarItems = useMemo<SidebarResource[]>(() => {
		const grouped: SidebarResource[] = sortedProjects.map((project) => {
			const sessionsForProject = displayProjectSessions(
				projectSessions.filter((session) => session.projectId === project.projectId),
				activeSessionId,
			);
			const revealed = revealedProjectIds.has(project.projectId);
			const visible = visibleProjectSessions(sessionsForProject, activeSessionId, revealed);
			const children: SidebarResource[] = visible.map((session) => ({
				id: sessionResourceId(session.sessionId),
				label: sessionLabel(session, visible),
				kind: "file" as const,
				...(session.isSubagent ? { indent: 1 } : {}),
			}));
			if (sessionsForProject.length === 0) {
				children.push({
					id: newSessionResourceId(project.projectId),
					label: "Start first chat",
					kind: "action",
				});
			} else if (sessionsForProject.length > INITIAL_SESSION_COUNT) {
				const hidden = sessionsForProject.length - visible.length;
				children.push({
					id: `toggle:${project.projectId}`,
					label: revealed ? "Show less" : `Show ${hidden} more`,
					kind: "action",
				});
			}
			return {
				id: projectResourceId(project.projectId),
				label: project.name,
				kind: "project",
				children,
			};
		});
		const unassigned = sortSessions(
			displayProjectSessions(
				projectSessions.filter((session) => !session.projectId),
				activeSessionId,
			),
		);
		if (unassigned.length > 0) {
			const unassignedRevealed = revealedProjectIds.has("unassigned");
			const unassignedVisible = visibleProjectSessions(unassigned, activeSessionId, unassignedRevealed);
			const unassignedChildren: SidebarResource[] = unassignedVisible.map((session) => ({
				id: sessionResourceId(session.sessionId),
				label: sessionLabel(session, unassigned),
				kind: "file",
				...(session.isSubagent ? { indent: 1 } : {}),
			}));
			if (unassigned.length > INITIAL_SESSION_COUNT) {
				const hidden = unassigned.length - unassignedVisible.length;
				unassignedChildren.push({
					id: "toggle:unassigned",
					label: unassignedRevealed ? "Show less" : `Show ${hidden} more`,
					kind: "action",
				});
			}
			grouped.push({
				id: "project:unassigned",
				label: "Unassigned",
				kind: "folder",
				children: unassignedChildren,
			});
		}
		return grouped;
	}, [activeSessionId, projectSessions, revealedProjectIds, sortedProjects]);

	const openSessionInProject = useCallback(
		(projectId: ProjectId) => {
			if (onNewSessionInProject) {
				void onNewSessionInProject(projectId);
			} else {
				void onProjectSelect?.(projectId);
				onNewSession();
			}
		},
		[onNewSession, onNewSessionInProject, onProjectSelect],
	);

	const resumeResource = useCallback(
		(id: string) => {
			const toggleProjectId = idValue(id, "toggle:");
			if (toggleProjectId) {
				setRevealedProjectIds((current) => {
					const next = new Set(current);
					if (next.has(toggleProjectId)) next.delete(toggleProjectId);
					else next.add(toggleProjectId);
					return next;
				});
				return;
			}
			const newSessionProjectId = idValue(id, NEW_SESSION_PREFIX);
			if (newSessionProjectId) {
				openSessionInProject(newSessionProjectId as ProjectId);
				return;
			}
			const sessionId = idValue(id, SESSION_PREFIX);
			if (!sessionId) return;
			const session = projectSessions.find((entry) => entry.sessionId === sessionId);
			if (session) onResumeSession(session);
		},
		[openSessionInProject, onResumeSession, projectSessions, setRevealedProjectIds],
	);

	const toggleProjectResource = useCallback(
		(id: string) => {
			setExpandedProjectIds((current) =>
				current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
			);
		},
		[setExpandedProjectIds],
	);

	const selectSearchResult = useCallback(
		(value: string) => {
			const projectId = idValue(value, "search-project:");
			if (projectId) {
				const resourceId = projectResourceId(projectId);
				setExpandedProjectIds((current) => (current.includes(resourceId) ? current : [...current, resourceId]));
				void onProjectSelect?.(projectId);
				setSearchOpen(false);
				return;
			}
			const sessionId = idValue(value, "search-session:");
			const session = sessionId ? projectSessions.find((entry) => entry.sessionId === sessionId) : undefined;
			if (!session) return;
			if (session.projectId) {
				const resourceId = projectResourceId(session.projectId);
				setExpandedProjectIds((current) => (current.includes(resourceId) ? current : [...current, resourceId]));
			}
			onResumeSession(session);
			setSearchOpen(false);
		},
		[onProjectSelect, onResumeSession, projectSessions, setExpandedProjectIds, setSearchOpen],
	);

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
						{onForkSessionIntoProject && projects.length > 1 ? (
							<MenuItem
								icon={FolderTree}
								label="Fork into project"
								onClick={() => {
									controls.close();
									setActiveDialog({ kind: "fork-session", session });
								}}
							/>
						) : null}
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
		[onForkSessionIntoProject, onOpenPanelAction, projectById, projectSessions, projects.length, setActiveDialog],
	);

	return {
		projectById,
		sortedProjects,
		sidebarItems,
		resumeResource,
		toggleProjectResource,
		selectSearchResult,
		renderMenu,
	};
}
