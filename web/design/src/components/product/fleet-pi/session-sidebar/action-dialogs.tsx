import { Folder } from "lucide-react";
import { useMemo } from "react";
import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "../../../ui/alert-dialog";
import { Button } from "../../../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../ui/dialog";
import { Input } from "../../../ui/input";
import { Select, type SelectOption } from "../../../ui/select";
import type { SidebarStateView } from "./state";

export type SidebarActionDialogsProps = {
	projects: Array<ProjectSummary>;
	onRenameSession: (sessionId: string, title: string) => void;
	onDeleteSession: (sessionId: string) => void;
	onRenameProject?: (projectId: ProjectId, name: string) => void | Promise<void>;
	onUnregisterProject?: (projectId: ProjectId) => void | Promise<void>;
	onForkSessionIntoProject?: (sessionId: string, projectId: ProjectId) => void | Promise<void>;
	renameTarget: SidebarStateView["renameTarget"];
	setRenameTarget: SidebarStateView["setRenameTarget"];
	renameTitle: SidebarStateView["renameTitle"];
	setRenameTitle: SidebarStateView["setRenameTitle"];
	renameProjectTarget: SidebarStateView["renameProjectTarget"];
	setRenameProjectTarget: SidebarStateView["setRenameProjectTarget"];
	renameProjectName: SidebarStateView["renameProjectName"];
	setRenameProjectName: SidebarStateView["setRenameProjectName"];
	deleteTarget: SidebarStateView["deleteTarget"];
	setDeleteTarget: SidebarStateView["setDeleteTarget"];
	unregisterTarget: SidebarStateView["unregisterTarget"];
	setUnregisterTarget: SidebarStateView["setUnregisterTarget"];
	forkTarget: SidebarStateView["forkTarget"];
	setForkTarget: SidebarStateView["setForkTarget"];
	forkProjectId: SidebarStateView["forkProjectId"];
	setForkProjectId: SidebarStateView["setForkProjectId"];
};

export function FleetSessionSidebarActionDialogs({
	projects,
	onRenameSession,
	onDeleteSession,
	onRenameProject,
	onUnregisterProject,
	onForkSessionIntoProject,
	renameTarget,
	setRenameTarget,
	renameTitle,
	setRenameTitle,
	renameProjectTarget,
	setRenameProjectTarget,
	renameProjectName,
	setRenameProjectName,
	deleteTarget,
	setDeleteTarget,
	unregisterTarget,
	setUnregisterTarget,
	forkTarget,
	setForkTarget,
	forkProjectId,
	setForkProjectId,
}: SidebarActionDialogsProps) {
	const forkProjectOptions = useMemo<Array<SelectOption>>(
		() =>
			projects.flatMap((project) =>
				project.projectId === forkTarget?.projectId
					? []
					: [
							{
								value: project.projectId,
								label: `${project.name} — ${project.pathLabel}`,
								icon: Folder,
							},
						],
			),
		[forkTarget?.projectId, projects],
	);

	return (
		<>
			<AlertDialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
				<AlertDialogContent>
					<AlertDialogTitle>Rename session</AlertDialogTitle>
					<AlertDialogDescription>Choose a local display title for this Fleet Prime session.</AlertDialogDescription>
					<Input
						value={renameTitle}
						onChange={(event) => setRenameTitle(event.target.value)}
						aria-label="Session title"
						autoFocus
					/>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={!renameTitle.trim()}
							onClick={() => {
								if (renameTarget && renameTitle.trim()) {
									onRenameSession(renameTarget.sessionId, renameTitle.trim());
									setRenameTarget(null);
								}
							}}
						>
							Rename
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog
				open={renameProjectTarget !== null}
				onOpenChange={(open) => !open && setRenameProjectTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogTitle>Rename project</AlertDialogTitle>
					<AlertDialogDescription>
						This changes the display name only. The registered directory stays the same.
					</AlertDialogDescription>
					<Input
						value={renameProjectName}
						onChange={(event) => setRenameProjectName(event.target.value)}
						aria-label="Project name"
						autoFocus
					/>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={!renameProjectName.trim() || !onRenameProject}
							onClick={() => {
								if (renameProjectTarget && renameProjectName.trim()) {
									void onRenameProject?.(renameProjectTarget.projectId, renameProjectName.trim());
									setRenameProjectTarget(null);
								}
							}}
						>
							Rename
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogTitle>Delete session?</AlertDialogTitle>
					<AlertDialogDescription>
						This removes the Fleet Prime session and its managed session artifacts. This cannot be undone.
					</AlertDialogDescription>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => {
								if (deleteTarget) onDeleteSession(deleteTarget.sessionId);
								setDeleteTarget(null);
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={unregisterTarget !== null} onOpenChange={(open) => !open && setUnregisterTarget(null)}>
				<AlertDialogContent>
					<AlertDialogTitle>Unregister project?</AlertDialogTitle>
					<AlertDialogDescription>
						The directory and its sessions remain intact. Existing sessions will move to Unassigned until the
						directory is registered again.
					</AlertDialogDescription>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={() => {
								if (unregisterTarget) void onUnregisterProject?.(unregisterTarget.projectId);
								setUnregisterTarget(null);
							}}
						>
							Unregister
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog open={forkTarget !== null} onOpenChange={(open) => !open && setForkTarget(null)}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Fork session into project</DialogTitle>
						<DialogDescription>
							Create a new Fleet Prime session in another registered project.
						</DialogDescription>
					</DialogHeader>
					<div className="py-2">
						<Select
							value={forkProjectId ?? null}
							onValueChange={(value) => setForkProjectId(value as ProjectId)}
							options={forkProjectOptions}
							placeholder="Select a project…"
							aria-label="Target project"
						/>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setForkTarget(null)}>
							Cancel
						</Button>
						<Button
							type="button"
							disabled={!forkTarget || !forkProjectId || !onForkSessionIntoProject}
							onClick={() => {
								if (!forkTarget || !forkProjectId) return;
								void onForkSessionIntoProject?.(forkTarget.sessionId, forkProjectId);
								setForkTarget(null);
							}}
						>
							Fork session
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
