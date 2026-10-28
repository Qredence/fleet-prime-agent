import type { ProjectId, ProjectListResponse } from "@prime-agent/web-protocol";
import type { ChatSessionInfo, ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import type { UploadedAttachment, WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from "react";
import { chatClient } from "@/components/chat/chat-client";
import { notifyChatError } from "@/components/chat/chat-error-notify";
import {
	shouldClearPendingAttachments,
	shouldClearPendingAttachmentsForNewSession,
} from "@/components/chat/composer/pending-attachment-lifecycle";
import { workspacePathFromSuggestion } from "@/components/chat/composer/workspace-suggestions";

type UseChatWorkspaceActionsArgs = {
	activeProjectId: ProjectId | undefined;
	deleteSession: (sessionId: string) => Promise<boolean>;
	getSessionMetadata: () => ChatSessionMetadata;
	refetchProjects: () => Promise<{ data?: ProjectListResponse }>;
	resumeSession: (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => Promise<boolean>;
	sessionId: string | undefined;
	sessions: Array<ChatSessionInfo>;
	setActiveProjectId: Dispatch<SetStateAction<ProjectId | undefined>>;
	setSelectedWorkspacePath: Dispatch<SetStateAction<string | null>>;
	setUploadedAttachments: Dispatch<SetStateAction<Array<UploadedAttachment>>>;
	setWorkspaceAttachments: Dispatch<SetStateAction<Array<WorkspaceAttachment>>>;
	startNewSession: (options?: { projectId?: ProjectId; preserveRunning?: boolean }) => Promise<void>;
	switchProject: (projectId: ProjectId, sessionId?: string) => Promise<boolean>;
};

export function useChatWorkspaceActions({
	activeProjectId,
	deleteSession,
	getSessionMetadata,
	refetchProjects,
	resumeSession,
	sessionId,
	sessions,
	setActiveProjectId,
	setSelectedWorkspacePath,
	setUploadedAttachments,
	setWorkspaceAttachments,
	startNewSession,
	switchProject,
}: UseChatWorkspaceActionsArgs) {
	const clearPendingAttachments = useCallback(() => {
		setUploadedAttachments([]);
		setWorkspaceAttachments([]);
	}, [setUploadedAttachments, setWorkspaceAttachments]);

	// In-flight session-creation memo mirroring sessionCreatePromiseRef in
	// use-pi-chat-messaging.ts. startNewSession is fire-and-forget from several
	// call sites (header/sidebar new-session buttons, attachment upload), so two
	// concurrent invocations would otherwise create two sessions. Concurrent
	// callers reuse the in-flight creation and share its result.
	const workspaceSessionCreatePromiseRef = useRef<{
		key: string;
		promise: Promise<ChatSessionMetadata>;
	} | null>(null);

	const startNewSessionForWorkspace = useCallback(
		async (options?: { projectId?: ProjectId; preserveRunning?: boolean }): Promise<ChatSessionMetadata> => {
			const key = `${options?.projectId ?? ""}::${options?.preserveRunning ?? ""}`;
			const inFlight = workspaceSessionCreatePromiseRef.current;
			if (inFlight && inFlight.key === key) return inFlight.promise;
			const promise: Promise<ChatSessionMetadata> = (async () => {
				const currentMetadata = getSessionMetadata();
				const targetProjectId = options?.projectId ?? activeProjectId;
				const currentWorkspaceMetadata = {
					...currentMetadata,
					projectId: currentMetadata.projectId ?? activeProjectId,
				};
				const shouldClear = shouldClearPendingAttachmentsForNewSession(currentWorkspaceMetadata, targetProjectId);
				await startNewSession(options);
				if (shouldClear) clearPendingAttachments();
				return getSessionMetadata();
			})().finally(() => {
				if (workspaceSessionCreatePromiseRef.current?.promise === promise) {
					workspaceSessionCreatePromiseRef.current = null;
				}
			});
			workspaceSessionCreatePromiseRef.current = { key, promise };
			return promise;
		},
		[activeProjectId, clearPendingAttachments, getSessionMetadata, startNewSession],
	);

	const resumeSessionForWorkspaceWithResult = useCallback(
		async (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => {
			const targetMetadata =
				metadata.projectId === undefined && activeProjectId
					? { ...metadata, projectId: activeProjectId }
					: metadata;
			const currentMetadata = getSessionMetadata();
			const shouldClear = shouldClearPendingAttachments(currentMetadata, targetMetadata);
			const resumed = await resumeSession(targetMetadata, options);
			if (resumed && shouldClear) clearPendingAttachments();
			return resumed;
		},
		[activeProjectId, clearPendingAttachments, getSessionMetadata, resumeSession],
	);

	const resumeSessionForWorkspace = useCallback(
		async (metadata: ChatSessionMetadata, options?: { preserveRunning?: boolean }) => {
			await resumeSessionForWorkspaceWithResult(metadata, options);
		},
		[resumeSessionForWorkspaceWithResult],
	);

	const selectProject = useCallback(
		async (projectId: ProjectId) => {
			const targetSession = sessions
				.filter((session) => session.projectId === projectId)
				.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
			const currentMetadata = getSessionMetadata();
			const shouldClear = shouldClearPendingAttachments(currentMetadata, {
				sessionId: targetSession?.sessionId,
				projectId,
			});
			setActiveProjectId(projectId);
			setSelectedWorkspacePath(null);
			const switched = await switchProject(projectId, targetSession?.sessionId);
			if (switched && shouldClear) clearPendingAttachments();
			await refetchProjects();
		},
		[
			clearPendingAttachments,
			getSessionMetadata,
			refetchProjects,
			setActiveProjectId,
			setSelectedWorkspacePath,
			sessions,
			switchProject,
		],
	);

	const startNewSessionInProject = useCallback(
		async (targetProjectId: ProjectId) => {
			setActiveProjectId(targetProjectId);
			setSelectedWorkspacePath(null);
			await startNewSessionForWorkspace({ projectId: targetProjectId });
			await refetchProjects();
		},
		[refetchProjects, setActiveProjectId, setSelectedWorkspacePath, startNewSessionForWorkspace],
	);

	const deleteSessionForWorkspace = useCallback(
		async (targetSessionId: string) => {
			const deletingActiveSession = getSessionMetadata().sessionId === targetSessionId;
			const deleted = await deleteSession(targetSessionId);
			if (deleted && deletingActiveSession) clearPendingAttachments();
		},
		[clearPendingAttachments, deleteSession, getSessionMetadata],
	);

	const createProject = useCallback(
		async (request: { path?: string; directoryToken?: string; name?: string }) => {
			const project = await chatClient.createProject(request);
			await refetchProjects();
			await selectProject(project.projectId);
		},
		[refetchProjects, selectProject],
	);

	const renameProject = useCallback(
		async (projectId: ProjectId, name: string) => {
			await chatClient.renameProject(projectId, name);
			await refetchProjects();
		},
		[refetchProjects],
	);

	const unregisterProject = useCallback(
		async (projectId: ProjectId) => {
			await chatClient.unregisterProject(projectId);
			const refreshed = await refetchProjects();
			if (activeProjectId === projectId) {
				const fallback = refreshed.data?.projects.find((project) => project.projectId !== projectId);
				if (fallback) await selectProject(fallback.projectId);
				else {
					setActiveProjectId(undefined);
					setSelectedWorkspacePath(null);
					const switched = await switchProject("", undefined);
					if (switched) clearPendingAttachments();
				}
			}
		},
		[
			activeProjectId,
			clearPendingAttachments,
			refetchProjects,
			selectProject,
			setActiveProjectId,
			setSelectedWorkspacePath,
			switchProject,
		],
	);

	const browseProjectDirectories = useCallback(
		(input: { path?: string; token?: string }) => chatClient.browseProjectDirectories(input),
		[],
	);

	useEffect(() => {
		if (sessionId) void refetchProjects();
	}, [refetchProjects, sessionId]);

	const handleAttach = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = "image/*,text/*,application/json,application/pdf";
		input.onchange = () => {
			void (async () => {
				const files = Array.from(input.files ?? []);
				if (files.length === 0) return;
				const existingSessionId = getSessionMetadata().sessionId;
				const nextSessionId = existingSessionId ?? (await startNewSessionForWorkspace()).sessionId;
				if (!nextSessionId) throw new Error("Unable to create a session for attachments");
				const uploaded = await chatClient.uploadAttachments(nextSessionId, files);
				setUploadedAttachments((current) => [...current, ...uploaded]);
			})().catch((attachmentError) => {
				notifyChatError(attachmentError);
			});
		};
		input.click();
	}, [getSessionMetadata, setUploadedAttachments, startNewSessionForWorkspace]);

	const removeUploadedAttachment = useCallback(
		(attachmentId: string) => {
			setUploadedAttachments((current) => current.filter((attachment) => attachment.attachmentId !== attachmentId));
		},
		[setUploadedAttachments],
	);

	const clearUploadedAttachments = useCallback(() => setUploadedAttachments([]), [setUploadedAttachments]);
	const clearWorkspaceAttachments = useCallback(() => setWorkspaceAttachments([]), [setWorkspaceAttachments]);

	const restoreAttachments = useCallback(
		(uploaded: Array<UploadedAttachment>, workspace: Array<WorkspaceAttachment>) => {
			if (uploaded.length > 0) {
				setUploadedAttachments((current) => [...uploaded, ...current]);
			}
			if (workspace.length > 0) {
				setWorkspaceAttachments((current) => [...workspace, ...current]);
			}
		},
		[setUploadedAttachments, setWorkspaceAttachments],
	);

	const addWorkspaceAttachment = useCallback(
		(item: Parameters<typeof workspacePathFromSuggestion>[0]) => {
			const relativePath = workspacePathFromSuggestion(item);
			if (!relativePath) return;
			setWorkspaceAttachments((current) => {
				if (current.some((attachment) => attachment.relativePath === relativePath)) return current;
				return [
					...current,
					{
						kind: "workspace",
						relativePath,
						name: relativePath.split("/").pop() || relativePath,
					},
				];
			});
		},
		[setWorkspaceAttachments],
	);

	const removeWorkspaceAttachment = useCallback(
		(relativePath: string) => {
			setWorkspaceAttachments((current) => current.filter((attachment) => attachment.relativePath !== relativePath));
		},
		[setWorkspaceAttachments],
	);

	return {
		addWorkspaceAttachment,
		browseProjectDirectories,
		clearPendingAttachments,
		clearUploadedAttachments,
		clearWorkspaceAttachments,
		createProject,
		deleteSessionForWorkspace,
		handleAttach,
		removeUploadedAttachment,
		removeWorkspaceAttachment,
		renameProject,
		restoreAttachments,
		resumeSessionForWorkspace,
		resumeSessionForWorkspaceWithResult,
		selectProject,
		startNewSessionForWorkspace,
		startNewSessionInProject,
		unregisterProject,
	};
}
