import type { ProjectDirectoryBrowseResponse, ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { useCallback, useReducer } from "react";
import { readExpandedProjects } from "./types";

export type SidebarState = {
	brandMenuOpen: boolean;
	projectActionsOpen: boolean;
	searchOpen: boolean;
	query: string;
	expandedProjectIds: string[];
	revealedProjectIds: Set<ProjectId>;
	renameTarget: ChatSessionInfo | null;
	renameTitle: string;
	renameProjectTarget: ProjectSummary | null;
	renameProjectName: string;
	deleteTarget: ChatSessionInfo | null;
	unregisterTarget: ProjectSummary | null;
	createOpen: boolean;
	createPath: string;
	createName: string;
	directoryToken: string | undefined;
	directoryBrowser: ProjectDirectoryBrowseResponse | null;
	directoryBrowseLoading: boolean;
	directoryBrowseError: string | null;
	createSubmitting: boolean;
	createSubmitError: string | null;
	forkTarget: ChatSessionInfo | null;
	forkProjectId: ProjectId | undefined;
};

type SidebarField = {
	[Key in keyof SidebarState]: { key: Key; value: SidebarState[Key] };
}[keyof SidebarState];

export type SidebarAction =
	| { type: "set"; field: SidebarField }
	| { type: "update"; update: (state: SidebarState) => SidebarState };

export function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
	if (action.type === "update") return action.update(state);
	return { ...state, [action.field.key]: action.field.value } as SidebarState;
}

export function useFleetSessionSidebarState(activeProjectId: ProjectId | undefined) {
	const [state, dispatch] = useReducer(
		sidebarReducer,
		activeProjectId,
		(initialActiveProjectId): SidebarState => ({
			brandMenuOpen: false,
			projectActionsOpen: false,
			searchOpen: false,
			query: "",
			expandedProjectIds: readExpandedProjects(initialActiveProjectId),
			revealedProjectIds: new Set(),
			renameTarget: null,
			renameTitle: "",
			renameProjectTarget: null,
			renameProjectName: "",
			deleteTarget: null,
			unregisterTarget: null,
			createOpen: false,
			createPath: "",
			createName: "",
			directoryToken: undefined,
			directoryBrowser: null,
			directoryBrowseLoading: false,
			directoryBrowseError: null,
			createSubmitting: false,
			createSubmitError: null,
			forkTarget: null,
			forkProjectId: undefined,
		}),
	);

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
	const setRenameTarget = useCallback((value: ChatSessionInfo | null) => setField("renameTarget", value), [setField]);
	const setRenameTitle = useCallback((value: string) => setField("renameTitle", value), [setField]);
	const setRenameProjectTarget = useCallback(
		(value: ProjectSummary | null) => setField("renameProjectTarget", value),
		[setField],
	);
	const setRenameProjectName = useCallback((value: string) => setField("renameProjectName", value), [setField]);
	const setDeleteTarget = useCallback((value: ChatSessionInfo | null) => setField("deleteTarget", value), [setField]);
	const setUnregisterTarget = useCallback(
		(value: ProjectSummary | null) => setField("unregisterTarget", value),
		[setField],
	);
	const setCreateOpen = useCallback((value: boolean) => setField("createOpen", value), [setField]);
	const setCreatePath = useCallback((value: string) => setField("createPath", value), [setField]);
	const setCreateName = useCallback((value: string) => setField("createName", value), [setField]);
	const setDirectoryToken = useCallback((value: string | undefined) => setField("directoryToken", value), [setField]);
	const setDirectoryBrowser = useCallback(
		(value: ProjectDirectoryBrowseResponse | null) => setField("directoryBrowser", value),
		[setField],
	);
	const setDirectoryBrowseLoading = useCallback(
		(value: boolean) => setField("directoryBrowseLoading", value),
		[setField],
	);
	const setDirectoryBrowseError = useCallback(
		(value: string | null) => setField("directoryBrowseError", value),
		[setField],
	);
	const setCreateSubmitting = useCallback((value: boolean) => setField("createSubmitting", value), [setField]);
	const setCreateSubmitError = useCallback((value: string | null) => setField("createSubmitError", value), [setField]);
	const setForkTarget = useCallback((value: ChatSessionInfo | null) => setField("forkTarget", value), [setField]);
	const setForkProjectId = useCallback((value: ProjectId | undefined) => setField("forkProjectId", value), [setField]);

	return {
		...state,
		setBrandMenuOpen,
		setProjectActionsOpen,
		setSearchOpen,
		setQuery,
		setExpandedProjectIds,
		setRevealedProjectIds,
		setRenameTarget,
		setRenameTitle,
		setRenameProjectTarget,
		setRenameProjectName,
		setDeleteTarget,
		setUnregisterTarget,
		setCreateOpen,
		setCreatePath,
		setCreateName,
		setDirectoryToken,
		setDirectoryBrowser,
		setDirectoryBrowseLoading,
		setDirectoryBrowseError,
		setCreateSubmitting,
		setCreateSubmitError,
		setForkTarget,
		setForkProjectId,
	};
}

export type SidebarStateView = ReturnType<typeof useFleetSessionSidebarState>;
