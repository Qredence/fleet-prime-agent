import type { ProjectId } from "@prime-agent/web-protocol";
import { useCallback, useReducer } from "react";
import { readExpandedProjects, type SessionDialog } from "@/components/sessions/session-sidebar/types";

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

export function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
	if (action.type === "update") return action.update(state);
	return { ...state, [action.field.key]: action.field.value } as SidebarState;
}

/** Holds the sidebar's local menu, search, expansion, and active-dialog state.
 * `activeProjectId` seeds the initially expanded projects once; later changes
 * to that argument do not reset this state. */
export function useSessionSidebarState(activeProjectId: ProjectId | undefined) {
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
			activeDialog: null,
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
