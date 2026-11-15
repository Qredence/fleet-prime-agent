import type { ProjectId } from "@prime-agent/web-protocol";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { SidebarResource } from "@/components/sessions/session-sidebar/resource-tree";
import { writeStoredValue } from "@/lib/safe-storage";
import {
	displayProjectSessions,
	EMPTY_PROJECTS,
	EXPANDED_PROJECTS_STORAGE_KEY,
	INITIAL_SESSION_COUNT,
	idValue,
	NEW_SESSION_PREFIX,
	newSessionResourceId,
	projectResourceId,
	readExpandedProjects,
	SESSION_PREFIX,
	type SessionDialog,
	type SessionSidebarDependencies,
	sessionLabel,
	sessionResourceId,
	sortProjectsByActivity,
	sortSessions,
	visibleProjectSessions,
} from "@/lib/sessions/sidebar-types";

export type SidebarState = {
	brandMenuOpen: boolean;
	projectActionsOpen: boolean;
	searchOpen: boolean;
	query: string;
	expandedProjectIds: string[];
	revealedProjectIds: Set<ProjectId>;
	activeDialog: SessionDialog;
};

type SidebarField = {
	[Key in keyof SidebarState]: { key: Key; value: SidebarState[Key] };
}[keyof SidebarState];

export type SidebarAction =
	| { type: "set"; field: SidebarField }
	| { type: "update"; update: (state: SidebarState) => SidebarState };

function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
	if (action.type === "update") return action.update(state);
	return { ...state, [action.field.key]: action.field.value } as SidebarState;
}

/** Holds the sidebar's local menu, search, expansion, and active-dialog state.
 * `activeProjectId` seeds the initially expanded projects once; later changes
 * to that argument do not reset this state. */
export function useSessionSidebarState(activeProjectId: ProjectId | undefined) {
	const [state, dispatch] = useReducer(sidebarReducer, activeProjectId, (initialActiveProjectId): SidebarState => ({
		brandMenuOpen: false,
		projectActionsOpen: false,
		searchOpen: false,
		query: "",
		expandedProjectIds: readExpandedProjects(initialActiveProjectId),
		revealedProjectIds: new Set(),
		activeDialog: null,
	}));

	const setField = useCallback(function setSidebarField<Key extends keyof SidebarState>(
		key: Key,
		value: SidebarState[Key],
	) {
		dispatch({ type: "set", field: { key, value } as SidebarField });
	}, []);

	const updateField = useCallback(function updateSidebarField<Key extends keyof SidebarState>(
		key: Key,
		update: (value: SidebarState[Key]) => SidebarState[Key],
	) {
		dispatch({
			type: "update",
			update: (current) => ({ ...current, [key]: update(current[key]) }),
		});
	}, []);

	const setBrandMenuOpen = useCallback((value: boolean) => setField("brandMenuOpen", value), [setField]);
	const setProjectActionsOpen = useCallback((value: boolean) => setField("projectActionsOpen", value), [setField]);
	const setSearchOpen = useCallback((value: boolean) => setField("searchOpen", value), [setField]);
	const setQuery = useCallback((value: string) => setField("query", value), [setField]);
	const setExpandedProjectIds = useCallback(
		(value: string[] | ((current: string[]) => string[])) =>
			typeof value === "function" ? updateField("expandedProjectIds", value) : setField("expandedProjectIds", value),
		[setField, updateField],
	);
	const setRevealedProjectIds = useCallback(
		(value: Set<ProjectId> | ((current: Set<ProjectId>) => Set<ProjectId>)) =>
			typeof value === "function" ? updateField("revealedProjectIds", value) : setField("revealedProjectIds", value),
		[setField, updateField],
	);
	const setActiveDialog = useCallback((value: SessionDialog) => setField("activeDialog", value), [setField]);
	const closeDialog = useCallback(() => setField("activeDialog", null), [setField]);

	return {
		...state,
		setBrandMenuOpen,
		setProjectActionsOpen,
		setSearchOpen,
		setQuery,
		setExpandedProjectIds,
		setRevealedProjectIds,
		setActiveDialog,
		closeDialog,
	};
}

export type SidebarStateView = ReturnType<typeof useSessionSidebarState>;

export type SidebarViewModelState = {
	expandedProjectIds: string[];
	revealedProjectIds: Set<ProjectId>;
	setExpandedProjectIds: (value: string[] | ((current: string[]) => string[])) => void;
	setRevealedProjectIds: (value: Set<ProjectId> | ((current: Set<ProjectId>) => Set<ProjectId>)) => void;
	setSearchOpen: (value: boolean) => void;
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
> &
	SidebarViewModelState;

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
	expandedProjectIds,
	revealedProjectIds,
	setExpandedProjectIds,
	setRevealedProjectIds,
	setSearchOpen,
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

	return {
		projectById,
		sortedProjects,
		sidebarItems,
		resumeResource,
		toggleProjectResource,
		selectSearchResult,
	};
}
