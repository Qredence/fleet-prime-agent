import {
	sortProjectsByActivity,
	visibleProjectSessions,
} from "@prime-agent/web-design/components/fleet-pi/session-sidebar-model";
import type { ChatSessionInfo, ProjectSummary } from "@prime-agent/web-protocol";
import { describe, expect, it } from "vitest";

function project(projectId: string, name = projectId): ProjectSummary {
	return {
		projectId,
		name,
		pathLabel: `…/${name}`,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		sessionCount: 0,
		status: "active",
	};
}

function session(sessionId: string, updatedAt: string, projectId = "alpha"): ChatSessionInfo {
	return {
		sessionId,
		projectId,
		title: sessionId,
		firstMessage: sessionId,
		createdAt: updatedAt,
		updatedAt,
		status: "idle",
		messageCount: 1,
	};
}

describe("Fleet session sidebar model", () => {
	it("sorts projects by their most recently updated session", () => {
		const projects = [project("alpha"), project("beta"), project("empty")];
		const sessions = [
			session("alpha-chat", "2026-01-02T00:00:00.000Z", "alpha"),
			session("beta-chat", "2026-01-03T00:00:00.000Z", "beta"),
		];

		expect(sortProjectsByActivity(projects, sessions).map(({ projectId }) => projectId)).toEqual([
			"beta",
			"alpha",
			"empty",
		]);
	});

	it("caps projects at five sessions while retaining the active session", () => {
		const sessions = Array.from({ length: 7 }, (_, index) =>
			session(`chat-${index + 1}`, `2026-01-${String(10 - index).padStart(2, "0")}T00:00:00.000Z`),
		);

		const visible = visibleProjectSessions(sessions, "chat-7", false);
		expect(visible).toHaveLength(5);
		expect(visible.map(({ sessionId }) => sessionId)).toContain("chat-7");
		expect(visibleProjectSessions(sessions, "chat-7", true)).toHaveLength(7);
	});
});
