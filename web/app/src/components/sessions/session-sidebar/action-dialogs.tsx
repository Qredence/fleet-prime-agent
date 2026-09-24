import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { type SessionDialog, sessionLabel } from "@/components/sessions/session-sidebar/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, type SelectOption } from "@/components/ui/select";

export type SidebarActionDialogsProps = {
	activeDialog: SessionDialog;
	onClose: () => void;
	projects: Array<ProjectSummary>;
	onRenameSession: (sessionId: string, title: string) => void;
	onDeleteSession: (sessionId: string) => void;
	onRenameProject?: (projectId: ProjectId, name: string) => void | Promise<void>;
	onUnregisterProject?: (projectId: ProjectId) => void | Promise<void>;
	onForkSessionIntoProject?: (sessionId: string, projectId: ProjectId) => void | Promise<void>;
};

function RenameSessionDialog({
	session,
	onClose,
	onRenameSession,
}: {
	session: ChatSessionInfo;
	onClose: () => void;
	onRenameSession: (sessionId: string, title: string) => void;
}) {
	const [renameTitle, setRenameTitle] = useState(() => sessionLabel(session));

	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
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
					<AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={!renameTitle.trim()}
						onClick={() => {
							if (renameTitle.trim()) {
								onRenameSession(session.sessionId, renameTitle.trim());
								onClose();
							}
						}}
					>
						Rename
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function RenameProjectDialog({
	project,
	onClose,
	onRenameProject,
}: {
	project: ProjectSummary;
	onClose: () => void;
	onRenameProject?: (projectId: ProjectId, name: string) => void | Promise<void>;
}) {
	const [renameProjectName, setRenameProjectName] = useState(project.name);

	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
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
					<AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						disabled={!renameProjectName.trim() || !onRenameProject}
						onClick={() => {
							if (renameProjectName.trim()) {
								void onRenameProject?.(project.projectId, renameProjectName.trim());
								onClose();
							}
						}}
					>
						Rename
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function DeleteSessionDialog({
	session,
	onClose,
	onDeleteSession,
}: {
	session: ChatSessionInfo;
	onClose: () => void;
	onDeleteSession: (sessionId: string) => void;
}) {
	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogTitle>Delete session?</AlertDialogTitle>
				<AlertDialogDescription>
					This removes the Fleet Prime session and its managed session artifacts. This cannot be undone.
				</AlertDialogDescription>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						onClick={() => {
							onDeleteSession(session.sessionId);
							onClose();
						}}
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function UnregisterProjectDialog({
	project,
	onClose,
	onUnregisterProject,
}: {
	project: ProjectSummary;
	onClose: () => void;
	onUnregisterProject?: (projectId: ProjectId) => void | Promise<void>;
}) {
	return (
		<AlertDialog open onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogTitle>Unregister project?</AlertDialogTitle>
				<AlertDialogDescription>
					The directory and its sessions remain intact. Existing sessions will move to Unassigned until the
					directory is registered again.
				</AlertDialogDescription>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						onClick={() => {
							void onUnregisterProject?.(project.projectId);
							onClose();
						}}
					>
						Unregister
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ForkSessionDialog({
	session,
	projects,
	onClose,
	onForkSessionIntoProject,
}: {
	session: ChatSessionInfo;
	projects: Array<ProjectSummary>;
	onClose: () => void;
	onForkSessionIntoProject?: (sessionId: string, projectId: ProjectId) => void | Promise<void>;
}) {
	const initialProjectId = projects.find((project) => project.projectId !== session.projectId)?.projectId;
	const [forkProjectId, setForkProjectId] = useState<ProjectId | undefined>(initialProjectId);

	const forkProjectOptions = useMemo<Array<SelectOption>>(
		() =>
			projects.flatMap((project) =>
				project.projectId === session.projectId
					? []
					: [
							{
								value: project.projectId,
								label: `${project.name} — ${project.pathLabel}`,
								icon: Folder,
							},
						],
			),
		[session.projectId, projects],
	);

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Fork session into project</DialogTitle>
					<DialogDescription>Create a new Fleet Prime session in another registered project.</DialogDescription>
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
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={!forkProjectId || !onForkSessionIntoProject}
						onClick={() => {
							if (!forkProjectId) return;
							void onForkSessionIntoProject?.(session.sessionId, forkProjectId);
							onClose();
						}}
					>
						Fork session
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Renders the dialog selected by `activeDialog`, or nothing when it is null.
 * Project creation is handled separately by SessionSidebar, so its dialog
 * kind also renders nothing here. */
export function SessionSidebarActionDialogs({
	activeDialog,
	onClose,
	projects,
	onRenameSession,
	onDeleteSession,
	onRenameProject,
	onUnregisterProject,
	onForkSessionIntoProject,
}: SidebarActionDialogsProps) {
	if (!activeDialog) return null;

	switch (activeDialog.kind) {
		case "rename-session":
			return (
				<RenameSessionDialog session={activeDialog.session} onClose={onClose} onRenameSession={onRenameSession} />
			);
		case "rename-project":
			return (
				<RenameProjectDialog project={activeDialog.project} onClose={onClose} onRenameProject={onRenameProject} />
			);
		case "delete-session":
			return (
				<DeleteSessionDialog session={activeDialog.session} onClose={onClose} onDeleteSession={onDeleteSession} />
			);
		case "unregister-project":
			return (
				<UnregisterProjectDialog
					project={activeDialog.project}
					onClose={onClose}
					onUnregisterProject={onUnregisterProject}
				/>
			);
		case "fork-session":
			return (
				<ForkSessionDialog
					session={activeDialog.session}
					projects={projects}
					onClose={onClose}
					onForkSessionIntoProject={onForkSessionIntoProject}
				/>
			);
		case "create-project":
			return null;
	}
}
