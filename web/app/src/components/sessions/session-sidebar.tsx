import { lazy, Suspense, useCallback } from "react";
import { SessionSidebarActionDialogs } from "@/components/sessions/session-sidebar/action-dialogs";
import { SessionSidebarNavigation } from "@/components/sessions/session-sidebar/navigation";
import { useSessionSidebarState, useSessionSidebarViewModel } from "@/hooks/sessions/use-session-sidebar";
import { EMPTY_PROJECTS, type SessionSidebarProps } from "@/lib/sessions/sidebar-types";

export type { SessionSidebarProps } from "@/lib/sessions/sidebar-types";

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
	const { onProjectSelect, onCreateProject, onRenameProject, onUnregisterProject } = projectActions;
	const { onOpenPanelAction, onBrowseDirectories, onOpenSettings } = navigationActions;
	const { accountMenu } = slots;
	const state = useSessionSidebarState(activeProjectId);

	const { projectById, sortedProjects, sidebarItems, resumeResource, toggleProjectResource, selectSearchResult } =
		useSessionSidebarViewModel({
			sessions,
			projects,
			projectSessions,
			activeProjectId,
			activeSessionId,
			onNewSession,
			onNewSessionInProject,
			onProjectSelect,
			onResumeSession,
			expandedProjectIds: state.expandedProjectIds,
			revealedProjectIds: state.revealedProjectIds,
			setExpandedProjectIds: state.setExpandedProjectIds,
			setRevealedProjectIds: state.setRevealedProjectIds,
			setSearchOpen: state.setSearchOpen,
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
				onOpenPanelAction={onOpenPanelAction}
				setActiveDialog={state.setActiveDialog}
				accountMenu={accountMenu}
				resumeResource={resumeResource}
				toggleProjectResource={toggleProjectResource}
				selectSearchResult={selectSearchResult}
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
				onRenameSession={onRenameSession}
				onDeleteSession={onDeleteSession}
				onRenameProject={onRenameProject}
				onUnregisterProject={onUnregisterProject}
			/>
		</>
	);
}
