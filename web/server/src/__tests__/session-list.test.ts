import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { EMPTY_SESSION_FIRST_MESSAGE } from "@prime-agent/web-protocol/session-label";
import { describe, expect, it } from "vitest";
import {
	applyPresentationToSessionRow,
	normalizeSessionListRow,
	presentationListActivity,
	type SessionListSource,
	sessionNeedsPresentationJoin,
} from "../session-list";

function listSource(row: {
	sessionId: string;
	cwd: string;
	sessionName?: string;
	firstMessage: string;
	messageCount: number;
	created: string;
	modified: string;
}): SessionListSource {
	return row as SessionListSource;
}

const refinementPresentation: PrimeAgentSessionPresentation = {
	revision: 1,
	userBash: [],
	rlmChildren: [],
	refinements: [
		{
			id: "ref-1",
			summary: "Tighten the plan",
			rationale: "Clearer steps",
			expectedOutcome: "A better plan",
			edits: [],
			status: "success",
			timestamp: 2,
		},
	],
	artifactRuns: [],
};

describe("normalizeSessionListRow", () => {
	it("strips the upstream empty-session placeholder", () => {
		const row = normalizeSessionListRow(
			listSource({
				sessionId: "refine-session",
				cwd: "/workspace",
				sessionName: EMPTY_SESSION_FIRST_MESSAGE,
				firstMessage: EMPTY_SESSION_FIRST_MESSAGE,
				messageCount: 0,
				created: "2026-09-12T00:00:00.000Z",
				modified: "2026-09-12T00:01:00.000Z",
			}),
		);
		expect(row.title).toBeUndefined();
		expect(row.firstMessage).toBe("");
		expect(row.messageCount).toBe(0);
		expect(sessionNeedsPresentationJoin(row)).toBe(true);
	});
});

describe("applyPresentationToSessionRow", () => {
	it("titles command-only activity from a refinement sidecar", () => {
		const row = normalizeSessionListRow(
			listSource({
				sessionId: "refine-session",
				cwd: "/workspace",
				firstMessage: EMPTY_SESSION_FIRST_MESSAGE,
				messageCount: 0,
				created: "2026-09-12T00:00:00.000Z",
				modified: "2026-09-12T00:01:00.000Z",
			}),
		);
		const fields = applyPresentationToSessionRow(row, refinementPresentation);
		expect(fields.title).toBe("Tighten the plan");
		expect(fields.firstMessage).toBe("Tighten the plan");
		expect(fields.messageCount).toBe(1);
	});

	it("keeps a true empty draft at zero messages", () => {
		const row = normalizeSessionListRow(
			listSource({
				sessionId: "draft-session",
				cwd: "/workspace",
				firstMessage: EMPTY_SESSION_FIRST_MESSAGE,
				messageCount: 0,
				created: "2026-09-12T00:00:00.000Z",
				modified: "2026-09-12T00:01:00.000Z",
			}),
		);
		const fields = applyPresentationToSessionRow(row, undefined);
		expect(fields.title).toBe("draft-se");
		expect(fields.firstMessage).toBe("");
		expect(fields.messageCount).toBe(0);
	});

	it("prefers a saved session name over a later refinement summary", () => {
		expect(presentationListActivity({ ...refinementPresentation, sessionName: "Plan v2" }).title).toBe("Plan v2");
		const row = normalizeSessionListRow(
			listSource({
				sessionId: "named-session",
				cwd: "/workspace",
				sessionName: "Plan v2",
				firstMessage: EMPTY_SESSION_FIRST_MESSAGE,
				messageCount: 0,
				created: "2026-09-12T00:00:00.000Z",
				modified: "2026-09-12T00:01:00.000Z",
			}),
		);
		expect(applyPresentationToSessionRow(row, refinementPresentation).title).toBe("Plan v2");
	});
});
