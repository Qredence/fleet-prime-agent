import { Folder, FolderTree, Library, Package, Pencil, Trash2, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ProjectId } from "@prime-agent/web-protocol";
import type { SidebarResource } from "../../../registry/beui/agents/ai-sidebar";
import {
	INITIAL_SESSION_COUNT,
	displayProjectSessions,
	sortProjectsByActivity,
	sortSessions,
	visibleProjectSessions,
} from "../session-sidebar-model";
import type { SidebarStateView } from "./state";
import {
	EMPTY_PROJECTS,
	EXPANDED_PROJECTS_STORAGE_KEY,
	type FleetSessionSidebarDependencies,
	NEW_SESSION_PREFIX,
	SESSION_PREFIX,
	directoryErrorMessage,
	idValue,
	newSessionResourceId,
	projectResourceId,
	sessionLabel,
	sessionResourceId,
} from "./types";

export type SidebarViewModelState = Pick<
	SidebarStateView,
	| "createOpen"
	| "expandedProjectIds"
	| "revealedProjectIds"
	| "setExpandedProjectIds"
	| "setRevealedProjectIds"
	| "setSearchOpen"
	| "setDirectoryBrowser"
	| "setDirectoryBrowseLoading"
	| "setDirectoryBrowseError"
	| "setDirectoryToken"
	| "setCreatePath"
	| "setRenameTarget"
	| "setRenameTitle"
	| "setForkTarget"
	| "setForkProjectId"
	| "setDeleteTarget"
	| "setRenameProjectTarget"
	| "setRenameProjectName"
	| "setUnregisterTarget"
	| "createPath"
	| "directoryToken"
	| "createName"
	| "setCreateName"
	| "setCreateOpen"
	| "setCreateSubmitError"
	| "setCreateSubmitting"
>;

export type SidebarViewModelOptions = Pick<
	FleetSessionSidebarDependencies,
	| "sessions"
	| "projects"
	| "projectSessions"
	| "activeProjectId"
	| "activeSessionId"
	| "onNewSession"
	| "onNewSessionInProject"
	| "onProjectSelect"
	| "onResumeSession"
	| "onCreateProject"
	| "onForkSessionIntoProject"
	| "onOpenPanelAction"
	| "onBrowseDirectories"
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

export function useFleetSessionSidebarViewModel({
	sessions,
	projects = EMPTY_PROJECTS,
	projectSessions = sessions,
	activeProjectId,
	activeSessionId,
	onNewSession,
	onNewSessionInProject,
	onProjectSelect,
	onResumeSession,
	onCreateProject,
	onForkSessionIntoProject,
	onOpenPanelAction,
	onBrowseDirectories,
	createOpen,
	expandedProjectIds,
	revealedProjectIds,
	setExpandedProjectIds,
	setRevealedProjectIds,
	setSearchOpen,
	setDirectoryBrowser,
	setDirectoryBrowseLoading,
	setDirectoryBrowseError,
	setDirectoryToken,
	setCreatePath,
	setRenameTarget,
	setRenameTitle,
	setForkTarget,
	setForkProjectId,
	setDeleteTarget,
	setRenameProjectTarget,
	setRenameProjectName,
	setUnregisterTarget,
	createPath,
	directoryToken,
	createName,
	setCreateName,
	setCreateOpen,
	setCreateSubmitError,
	setCreateSubmitting,
}: SidebarViewModelOptions) {
	const createOpenRef = useRef(false);
	const loadDirectories = useCallback(
		async (input: { path?: string; token?: string }) => {
			if (!onBrowseDirectories) return false;
			setDirectoryBrowseLoading(true);
			setDirectoryBrowseError(null);
			try {
				const response = await onBrowseDirectories(input);
				setDirectoryBrowser(response);
				setDirectoryToken(response.directoryToken);
				setCreatePath(response.pathLabel);
				return true;
			} catch (error) {
				setDirectoryBrowseError(directoryErrorMessage(error, "Could not browse this directory."));
				return false;
			} finally {
				setDirectoryBrowseLoading(false);
			}
		},
		[
			onBrowseDirectories,
			setCreatePath,
			setDirectoryBrowseError,
			setDirectoryBrowseLoading,
			setDirectoryBrowser,
			setDirectoryToken,
		],
	);

	useEffect(() => {
		const opened = createOpen && !createOpenRef.current;
		createOpenRef.current = createOpen;
		if (!opened || !onBrowseDirectories) return;
		void loadDirectories({});
	}, [createOpen, loadDirectories, onBrowseDirectories]);

	const projectById = useMemo(() => new Map(projects.map((project) => [project.projectId, project])), [projects]);

	const sortedProjects = useMemo(() => sortProjectsByActivity(projects, projectSessions), [projectSessions, projects]);

	useEffect(() => {
		if (!activeProjectId) return;
		const resourceId = projectResourceId(activeProjectId);
		setExpandedProjectIds((current) => (current.includes(resourceId) ? current : [...current, resourceId]));
	}, [activeProjectId, setExpandedProjectIds]);

	useEffect(() => {
		window.localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify(expandedProjectIds));
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
				label: sessionLabel(session),
				kind: "file" as const,
			}));
			if (sessionsForProject.length === 0) {
				children.push({
					id: newSessionResourceId(project.projectId),
					label: "Start first chat",
					kind: "action",
				});
			} else if (sessionsForProject.length > INITIAL_SESSION_COUNT) {
				children.push({
					id: `toggle:${project.projectId}`,
					label: revealed ? "Show less" : "Show more",
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
			const unassignedChildren: SidebarResource[] = visibleProjectSessions(
				unassigned,
				activeSessionId,
				revealedProjectIds.has("unassigned"),
			).map((session) => ({
				id: sessionResourceId(session.sessionId),
				label: sessionLabel(session),
				kind: "file",
			}));
			if (unassigned.length > INITIAL_SESSION_COUNT) {
				unassignedChildren.push({
					id: "toggle:unassigned",
					label: revealedProjectIds.has("unassigned") ? "Show less" : "Show more",
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
			const session = sessionId
				? projectSessions.find((entry) => entry.sessionId === sessionId)
				: undefined;
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
								setRenameTarget(session);
								setRenameTitle(sessionLabel(session));
							}}
						/>
						{onForkSessionIntoProject && projects.length > 1 ? (
							<MenuItem
								icon={FolderTree}
								label="Fork into project"
								onClick={() => {
									controls.close();
									setForkTarget(session);
									setForkProjectId(
										projects.find((project) => project.projectId !== session.projectId)?.projectId,
									);
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
								setDeleteTarget(session);
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
								setRenameProjectTarget(project);
								setRenameProjectName(project.name);
							}}
						/>
						<MenuItem
							icon={Unplug}
							label="Unregister project"
							destructive
							onClick={() => {
								controls.close();
								setUnregisterTarget(project);
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
		[
			onForkSessionIntoProject,
			onOpenPanelAction,
			projectById,
			projectSessions,
			projects,
			setDeleteTarget,
			setForkProjectId,
			setForkTarget,
			setRenameProjectName,
			setRenameProjectTarget,
			setRenameTarget,
			setRenameTitle,
			setUnregisterTarget,
		],
	);

	const submitCreate = async () => {
		const path = createPath.trim();
		if (!onCreateProject || (!path && !directoryToken)) return;
		setCreateSubmitting(true);
		setCreateSubmitError(null);
		try {
			await onCreateProject({
				path: directoryToken ? undefined : path,
				directoryToken,
				name: createName.trim() || undefined,
			});
			setCreateOpen(false);
			setCreatePath("");
			setCreateName("");
			setDirectoryToken(undefined);
			setDirectoryBrowser(null);
			setDirectoryBrowseError(null);
		} catch (error) {
			setCreateSubmitError(directoryErrorMessage(error, "Could not add this project."));
		} finally {
			setCreateSubmitting(false);
		}
	};

	return {
		loadDirectories,
		projectById,
		sortedProjects,
		sidebarItems,
		resumeResource,
		toggleProjectResource,
		selectSearchResult,
		renderMenu,
		submitCreate,
	};
}
