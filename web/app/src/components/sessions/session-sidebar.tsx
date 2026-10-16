import { lazy, Suspense, useCallback } from "react";
import { SessionSidebarActionDialogs } from "@/components/sessions/session-sidebar/action-dialogs";
import { SessionSidebarNavigation } from "@/components/sessions/session-sidebar/navigation";
import { useSessionSidebarState } from "@/components/sessions/session-sidebar/state";
import { EMPTY_PROJECTS, type SessionSidebarProps } from "@/components/sessions/session-sidebar/types";
import { useSessionSidebarViewModel } from "@/components/sessions/session-sidebar/view-model";

export type { SessionSidebarProps } from "@/components/sessions/session-sidebar/types";

// Keep cmdk (via ui/command) out of the welcome-route eager graph — same budget
// contract as the lazy model-selector / command-palette chunks.
const LazySessionSidebarCreateDialog = lazy(() =>
	import("@/components/sessions/session-sidebar/create-project-dialog").then(({ SessionSidebarCreateDialog }) => ({
		default: SessionSidebarCreateDialog,
	})),
);

export function SessionSidebar({
	data,
	sessionActions,
	projectActions = {},
	navigationActions = {},
	slots = {},
}: SessionSidebarProps) {
	const { sessions, projects = EMPTY_PROJECTS, projectSessions = sessions, activeProjectId, activeSessionId } = data;
	const { onNewSession, onNewSessionInProject, onResumeSession, onRenameSession, onDeleteSession } = sessionActions;
	const { onProjectSelect, onCreateProject, onRenameProject, onUnregisterProject, onForkSessionIntoProject } =
		projectActions;
	const { onOpenPanelAction, onBrowseDirectories, onOpenSettings } = navigationActions;
	const { accountMenu } = slots;
	const state = useSessionSidebarState(activeProjectId);

	const {
		projectById,
		sortedProjects,
		sidebarItems,
		resumeResource,
		toggleProjectResource,
		selectSearchResult,
		renderMenu,
	} = useSessionSidebarViewModel({
		sessions,
		projects,
		projectSessions,
		activeProjectId,
		activeSessionId,
		onNewSession,
		onNewSessionInProject,
		onProjectSelect,
		onResumeSession,
		onForkSessionIntoProject,
		onOpenPanelAction,
		expandedProjectIds: state.expandedProjectIds,
		revealedProjectIds: state.revealedProjectIds,
		setExpandedProjectIds: state.setExpandedProjectIds,
		setRevealedProjectIds: state.setRevealedProjectIds,
		setSearchOpen: state.setSearchOpen,
		setActiveDialog: state.setActiveDialog,
	});

	const setActiveDialog = state.setActiveDialog;
	const handleOpenCreateProject = useCallback(() => {
		setActiveDialog({ kind: "create-project" });
	}, [setActiveDialog]);

	const isCreateOpen = state.activeDialog?.kind === "create-project";

	return (
		<>
			<SessionSidebarNavigation
				brandMenuOpen={state.brandMenuOpen}
				setBrandMenuOpen={state.setBrandMenuOpen}
				searchOpen={state.searchOpen}
				setSearchOpen={state.setSearchOpen}
				query={state.query}
				setQuery={state.setQuery}
				projectActionsOpen={state.projectActionsOpen}
				setProjectActionsOpen={state.setProjectActionsOpen}
				expandedProjectIds={state.expandedProjectIds}
				setExpandedProjectIds={state.setExpandedProjectIds}
				onOpenCreateProject={handleOpenCreateProject}
				projects={projects}
				projectSessions={projectSessions}
				sidebarItems={sidebarItems}
				sortedProjects={sortedProjects}
				projectById={projectById}
				activeProjectId={activeProjectId}
				activeSessionId={activeSessionId}
				onNewSession={onNewSession}
				onNewSessionInProject={onNewSessionInProject}
				onProjectSelect={onProjectSelect}
				onRenameSession={onRenameSession}
				onCreateProject={onCreateProject}
				onOpenSettings={onOpenSettings}
				accountMenu={accountMenu}
				resumeResource={resumeResource}
				toggleProjectResource={toggleProjectResource}
				selectSearchResult={selectSearchResult}
				renderMenu={renderMenu}
			/>

			{isCreateOpen ? (
				<Suspense fallback={null}>
					<LazySessionSidebarCreateDialog
						open={isCreateOpen}
						onClose={state.closeDialog}
						onBrowseDirectories={onBrowseDirectories}
						onCreateProject={onCreateProject}
					/>
				</Suspense>
			) : null}

			<SessionSidebarActionDialogs
				activeDialog={state.activeDialog}
				onClose={state.closeDialog}
				projects={projects}
				onRenameSession={onRenameSession}
				onDeleteSession={onDeleteSession}
				onRenameProject={onRenameProject}
				onUnregisterProject={onUnregisterProject}
				onForkSessionIntoProject={onForkSessionIntoProject}
			/>
		</>
	);
}
