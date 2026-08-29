import { useFleetSessionSidebarState } from "./state";
import { useFleetSessionSidebarViewModel } from "./view-model";
import { FleetSessionSidebarNavigation } from "./navigation";
import { FleetSessionSidebarCreateDialog } from "./create-project-dialog";
import { FleetSessionSidebarActionDialogs, type SidebarActionDialogsProps } from "./action-dialogs";
import { EMPTY_PROJECTS, type FleetSessionSidebarProps } from "./types";

export type { FleetSessionSidebarProps } from "./types";

function FleetSessionSidebarDialogs(
	props: Parameters<typeof FleetSessionSidebarCreateDialog>[0] & SidebarActionDialogsProps,
) {
	return (
		<>
			<FleetSessionSidebarCreateDialog {...props} />
			<FleetSessionSidebarActionDialogs {...props} />
		</>
	);
}

export function FleetSessionSidebar({
	sessions,
	projects = EMPTY_PROJECTS,
	projectSessions = sessions,
	activeProjectId,
	activeSessionId,
	onNewSession,
	onNewSessionInProject,
	onResumeSession,
	onRenameSession,
	onDeleteSession,
	onProjectSelect,
	onCreateProject,
	onRenameProject,
	onUnregisterProject,
	onForkSessionIntoProject,
	onOpenPanelAction,
	onBrowseDirectories,
	accountMenu,
	onOpenSettings,
}: FleetSessionSidebarProps) {
	const state = useFleetSessionSidebarState(activeProjectId);

	const {
		loadDirectories,
		projectById,
		sortedProjects,
		sidebarItems,
		resumeResource,
		toggleProjectResource,
		selectSearchResult,
		renderMenu,
		submitCreate,
	} = useFleetSessionSidebarViewModel({
		sessions,
		projects,
		projectSessions,
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
		createOpen: state.createOpen,
		expandedProjectIds: state.expandedProjectIds,
		revealedProjectIds: state.revealedProjectIds,
		setExpandedProjectIds: state.setExpandedProjectIds,
		setRevealedProjectIds: state.setRevealedProjectIds,
		setSearchOpen: state.setSearchOpen,
		setDirectoryBrowser: state.setDirectoryBrowser,
		setDirectoryBrowseLoading: state.setDirectoryBrowseLoading,
		setDirectoryBrowseError: state.setDirectoryBrowseError,
		setDirectoryToken: state.setDirectoryToken,
		setCreatePath: state.setCreatePath,
		setRenameTarget: state.setRenameTarget,
		setRenameTitle: state.setRenameTitle,
		setForkTarget: state.setForkTarget,
		setForkProjectId: state.setForkProjectId,
		setDeleteTarget: state.setDeleteTarget,
		setRenameProjectTarget: state.setRenameProjectTarget,
		setRenameProjectName: state.setRenameProjectName,
		setUnregisterTarget: state.setUnregisterTarget,
		createPath: state.createPath,
		directoryToken: state.directoryToken,
		createName: state.createName,
		setCreateName: state.setCreateName,
		setCreateOpen: state.setCreateOpen,
		setCreateSubmitError: state.setCreateSubmitError,
		setCreateSubmitting: state.setCreateSubmitting,
	});

	return (
		<>
			<FleetSessionSidebarNavigation
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
				setCreateOpen={state.setCreateOpen}
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

			<FleetSessionSidebarDialogs
				projects={projects}
				onRenameSession={onRenameSession}
				onDeleteSession={onDeleteSession}
				onRenameProject={onRenameProject}
				onUnregisterProject={onUnregisterProject}
				onForkSessionIntoProject={onForkSessionIntoProject}
				onBrowseDirectories={onBrowseDirectories}
				createOpen={state.createOpen}
				setCreateOpen={state.setCreateOpen}
				directoryBrowser={state.directoryBrowser}
				setDirectoryBrowser={state.setDirectoryBrowser}
				directoryBrowseLoading={state.directoryBrowseLoading}
				directoryBrowseError={state.directoryBrowseError}
				setDirectoryBrowseError={state.setDirectoryBrowseError}
				directoryToken={state.directoryToken}
				setDirectoryToken={state.setDirectoryToken}
				createName={state.createName}
				setCreateName={state.setCreateName}
				createPath={state.createPath}
				setCreatePath={state.setCreatePath}
				renameTarget={state.renameTarget}
				setRenameTarget={state.setRenameTarget}
				renameTitle={state.renameTitle}
				setRenameTitle={state.setRenameTitle}
				renameProjectTarget={state.renameProjectTarget}
				setRenameProjectTarget={state.setRenameProjectTarget}
				renameProjectName={state.renameProjectName}
				setRenameProjectName={state.setRenameProjectName}
				deleteTarget={state.deleteTarget}
				setDeleteTarget={state.setDeleteTarget}
				unregisterTarget={state.unregisterTarget}
				setUnregisterTarget={state.setUnregisterTarget}
				forkTarget={state.forkTarget}
				setForkTarget={state.setForkTarget}
				forkProjectId={state.forkProjectId}
				setForkProjectId={state.setForkProjectId}
				createSubmitting={state.createSubmitting}
				createSubmitError={state.createSubmitError}
				setCreateSubmitError={state.setCreateSubmitError}
				loadDirectories={loadDirectories}
				submitCreate={submitCreate}
			/>
		</>
	);
}
