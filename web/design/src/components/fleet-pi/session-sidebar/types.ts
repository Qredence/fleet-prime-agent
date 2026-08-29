import type {
	ProjectDirectoryBrowseResponse,
	ProjectDirectoryEntry,
	ProjectId,
	ProjectSummary,
} from "@prime-agent/web-protocol";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import type { OpenPanelAction } from "@prime-agent/web-protocol/fleet-contract";
import type { ReactNode } from "react";
import { normalizeSessionLabel } from "../../../lib/pi/chat-helpers";

export type FleetSessionSidebarProps = {
	sessions: Array<ChatSessionInfo>;
	projects?: Array<ProjectSummary>;
	projectSessions?: Array<ChatSessionInfo>;
	activeProjectId?: ProjectId;
	activeSessionId?: string;
	onNewSession: () => void;
	onNewSessionInProject?: (projectId: ProjectId) => void | Promise<void>;
	onResumeSession: (session: ChatSessionInfo) => void;
	onRenameSession: (sessionId: string, title: string) => void;
	onDeleteSession: (sessionId: string) => void;
	onProjectSelect?: (projectId: ProjectId) => void | Promise<void>;
	onCreateProject?: (request: { path?: string; directoryToken?: string; name?: string }) => void | Promise<void>;
	onRenameProject?: (projectId: ProjectId, name: string) => void | Promise<void>;
	onUnregisterProject?: (projectId: ProjectId) => void | Promise<void>;
	onForkSessionIntoProject?: (sessionId: string, projectId: ProjectId) => void | Promise<void>;
	onOpenPanelAction?: (action: OpenPanelAction) => void;
	onBrowseDirectories?: (input: { path?: string; token?: string }) => Promise<ProjectDirectoryBrowseResponse>;
	accountMenu?: ReactNode;
	onOpenSettings?: () => void;
};

export const DOCUMENTATION_URL = "https://docs.qredence.ai";
export const EXPANDED_PROJECTS_STORAGE_KEY = "fleet-prime:v1:sidebar-expanded-projects";
export const EMPTY_PROJECTS: Array<ProjectSummary> = [];

export const NEW_SESSION_PREFIX = "new-session:";
export const PROJECT_PREFIX = "project:";
export const SESSION_PREFIX = "session:";

export function projectResourceId(projectId: ProjectId) {
	return `${PROJECT_PREFIX}${projectId}`;
}

export function sessionResourceId(sessionId: string) {
	return `${SESSION_PREFIX}${sessionId}`;
}

export function newSessionResourceId(projectId: ProjectId) {
	return `${NEW_SESSION_PREFIX}${projectId}`;
}

export function idValue(id: string, prefix: string) {
	return id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

export function sessionLabel(session: ChatSessionInfo) {
	return normalizeSessionLabel(session.title || session.firstMessage || session.sessionId.slice(0, 8));
}

export function sessionDiscoveryMeta(session: ChatSessionInfo, projectById: Map<ProjectId, ProjectSummary>) {
	const project = session.projectId ? (projectById.get(session.projectId)?.name ?? "Unassigned") : "Unassigned";
	const status = session.status === "idle" ? "Ready" : session.status;
	const messages = `${String(session.messageCount)} ${session.messageCount === 1 ? "message" : "messages"}`;
	return `${project} · ${status} · ${messages}`;
}

export function sessionSearchGroup(updatedAt: string) {
	const timestamp = Date.parse(updatedAt);
	if (!Number.isFinite(timestamp)) return "Earlier";
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const day = 86_400_000;
	const difference = Math.floor((today - new Date(timestamp).setHours(0, 0, 0, 0)) / day);
	if (difference <= 0) return "Today";
	if (difference === 1) return "Yesterday";
	return "Earlier";
}

export function pathEntryLabel(entry: ProjectDirectoryEntry) {
	return entry.hasChildren ? `${entry.name}/` : entry.name;
}

export function directoryErrorMessage(error: unknown, fallback: string) {
	return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function readExpandedProjects(activeProjectId: ProjectId | undefined) {
	if (typeof window === "undefined") {
		return activeProjectId ? [projectResourceId(activeProjectId)] : [];
	}
	const stored = window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY);
	if (!stored) return activeProjectId ? [projectResourceId(activeProjectId)] : [];
	try {
		const parsed: unknown = JSON.parse(stored);
		return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
	} catch {
		return activeProjectId ? [projectResourceId(activeProjectId)] : [];
	}
}
