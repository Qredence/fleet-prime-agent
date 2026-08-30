import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import type { ProjectId, ProjectSummary } from "@prime-agent/web-protocol/fleet-contract";

export const INITIAL_SESSION_COUNT = 5;

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
