import type {
	ProjectDirectoryBrowseResponse,
	ProjectDirectoryEntry,
	ProjectId,
	ProjectSummary,
} from "@prime-agent/web-protocol";
import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import type { OpenPanelAction } from "@prime-agent/web-protocol/fleet-contract";
import {
	disambiguateSessionLabel,
	fallbackSessionLabel,
	sessionListTitle,
} from "@prime-agent/web-protocol/session-label";
import type { ReactNode } from "react";
import { normalizeSessionLabel } from "@/lib/chat/chat-helpers";
import { readStoredValue } from "@/lib/safe-storage";

export type SessionSidebarData = {
	sessions: Array<ChatSessionInfo>;
	projects?: Array<ProjectSummary>;
	projectSessions?: Array<ChatSessionInfo>;
	activeProjectId?: ProjectId;
	activeSessionId?: string;
};

export type SessionActions = {
	onNewSession: () => void;
	onNewSessionInProject?: (projectId: ProjectId) => void | Promise<void>;
	onResumeSession: (session: ChatSessionInfo) => void;
	onRenameSession: (sessionId: string, title: string) => void;
	onDeleteSession: (sessionId: string) => void;
};

export type ProjectActions = {
	onProjectSelect?: (projectId: ProjectId) => void | Promise<void>;
	onCreateProject?: (request: { path?: string; directoryToken?: string; name?: string }) => void | Promise<void>;
	onRenameProject?: (projectId: ProjectId, name: string) => void | Promise<void>;
	onUnregisterProject?: (projectId: ProjectId) => void | Promise<void>;
};

export type SidebarNavigationActions = {
	onOpenPanelAction?: (action: OpenPanelAction) => void;
	onBrowseDirectories?: (input: { path?: string; token?: string }) => Promise<ProjectDirectoryBrowseResponse>;
	onOpenSettings?: () => void;
};

export type SessionSidebarSlots = {
	accountMenu?: ReactNode;
};

export type SessionSidebarProps = {
	data: SessionSidebarData;
	sessionActions: SessionActions;
	projectActions?: ProjectActions;
	navigationActions?: SidebarNavigationActions;
	slots?: SessionSidebarSlots;
};

export type SessionSidebarDependencies = SessionSidebarData &
	SessionActions &
	ProjectActions &
	SidebarNavigationActions &
	SessionSidebarSlots;

export type SessionDialog =
	| { kind: "create-project" }
	| { kind: "rename-session"; session: ChatSessionInfo }
	| { kind: "delete-session"; session: ChatSessionInfo }
	| { kind: "rename-project"; project: ProjectSummary }
	| { kind: "unregister-project"; project: ProjectSummary }
	| null;

export const DOCUMENTATION_URL = "https://docs.qredence.ai";
export const TWITTER_URL = "https://x.com/zacharybydesign";
export const DISCORD_URL = "https://discord.gg/ebgy7gtZHK";
export const EXPANDED_PROJECTS_STORAGE_KEY = "fleet-prime:v1:sidebar-expanded-projects";
export const EMPTY_PROJECTS: Array<ProjectSummary> = [];

export const NEW_SESSION_PREFIX = "new-session:";
export const PROJECT_PREFIX = "project:";
export const SESSION_PREFIX = "session:";
export const INITIAL_SESSION_COUNT = 5;

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

/** Shown instead of a raw session-id prefix until a session has a real title. */
export const UNTITLED_SESSION_LABEL = "New chat";

function sessionBaseLabel(session: Pick<ChatSessionInfo, "sessionId" | "title" | "firstMessage">) {
	const label = normalizeSessionLabel(
		sessionListTitle({
			sessionId: session.sessionId,
			title: session.title,
			firstMessage: session.firstMessage,
		}),
	);
	// The server falls back to the session-id prefix; that is noise in browser chrome.
	return label && label !== fallbackSessionLabel(session.sessionId) ? label : UNTITLED_SESSION_LABEL;
}

export function sessionLabel(
	session: Pick<ChatSessionInfo, "sessionId" | "title" | "firstMessage">,
	siblings?: ReadonlyArray<Pick<ChatSessionInfo, "sessionId" | "title" | "firstMessage">>,
) {
	const base = sessionBaseLabel(session);
	if (!siblings) return base;
	let collidingCount = 0;
	for (const sibling of siblings) {
		if (sessionBaseLabel(sibling) === base) collidingCount += 1;
	}
	return disambiguateSessionLabel(base, session.sessionId, collidingCount);
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
	const stored = readStoredValue(EXPANDED_PROJECTS_STORAGE_KEY);
	if (!stored) return activeProjectId ? [projectResourceId(activeProjectId)] : [];
	try {
		const parsed: unknown = JSON.parse(stored);
		return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
	} catch {
		return activeProjectId ? [projectResourceId(activeProjectId)] : [];
	}
}

/**
 * Draft sessions (no messages yet) stay out of the project tree unless they are
 * the active session the user is currently composing in.
 */
export function displayProjectSessions(entries: Array<ChatSessionInfo>, activeSessionId: string | undefined) {
	return entries.filter((session) => session.messageCount > 0 || session.sessionId === activeSessionId);
}

export function sortSessions(entries: Array<ChatSessionInfo>) {
	return entries.toSorted((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function visibleProjectSessions(
	entries: Array<ChatSessionInfo>,
	activeSessionId: string | undefined,
	expanded: boolean,
) {
	const sorted = sortSessions(entries);
	if (expanded || sorted.length <= INITIAL_SESSION_COUNT) return sorted;
	const visible = sorted.slice(0, INITIAL_SESSION_COUNT);
	const active = sorted.find((session) => session.sessionId === activeSessionId);
	if (active && !visible.some((session) => session.sessionId === active.sessionId)) {
		visible[INITIAL_SESSION_COUNT - 1] = active;
	}
	return visible;
}

export function sortProjectsByActivity(entries: Array<ProjectSummary>, sessions: Array<ChatSessionInfo>) {
	const registryOrder = new Map(entries.map((project, index) => [project.projectId, index]));
	const latestByProject = new Map<ProjectId, number>();
	for (const session of sessions) {
		if (!session.projectId) continue;
		const timestamp = Date.parse(session.updatedAt);
		latestByProject.set(session.projectId, Math.max(latestByProject.get(session.projectId) ?? 0, timestamp));
	}
	return entries.toSorted((left, right) => {
		const leftUpdated = latestByProject.get(left.projectId) ?? 0;
		const rightUpdated = latestByProject.get(right.projectId) ?? 0;
		if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated;
		return (registryOrder.get(left.projectId) ?? 0) - (registryOrder.get(right.projectId) ?? 0);
	});
}
