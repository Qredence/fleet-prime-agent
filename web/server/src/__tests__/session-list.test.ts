import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { EMPTY_SESSION_FIRST_MESSAGE } from "@prime-agent/web-protocol/session-label";
import { describe, expect, it, vi } from "vitest";
import type { PrimeBridge } from "../prime-bridge";
import {
	applyPresentationToSessionRow,
	listSessionRows,
	normalizeSessionListRow,
	presentationListActivity,
	type SessionListSource,
	sessionNeedsPresentationJoin,
} from "../session-list";

const presentationLoader = vi.hoisted(() => vi.fn());
vi.mock("../prime-agent-presentation", () => ({ loadManagedPrimePresentation: presentationLoader }));

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

describe("read-only catalog projection", () => {
	it("bounds sidecar I/O, preserves order and omits kernel diagnostics", async () => {
		let active = 0;
		let peak = 0;
		presentationLoader.mockReset().mockImplementation(async (_session, options) => {
			expect(options).toEqual({ includeKernelDiagnostics: false });
			peak = Math.max(peak, ++active);
			await new Promise<void>((resolve) => setImmediate(resolve));
			active--;
			return refinementPresentation;
		});
		const sources = Array.from({ length: 25 }, (_, index) => ({
			id: `session-${index}`,
			cwd: "/workspace",
			path: `/sessions/${index}.jsonl`,
		}));
		const bridge = { listSessions: async () => sources, getSession: () => undefined } as unknown as Pick<
			PrimeBridge,
			"listSessions" | "getSession"
		>;
		const registry = { activeProjectIdForSession: vi.fn(async () => "project-1") };
		const rows = await listSessionRows(bridge, registry);
		expect(rows.map((row) => row.sessionId)).toEqual(sources.map((row) => row.id));
		expect(peak).toBe(8);
		expect(presentationLoader).toHaveBeenCalledTimes(25);
	});

	it("omits a recovering session that has no directory yet", async () => {
		presentationLoader.mockReset();
		const bridge = {
			listSessions: async () => [
				{
					id: "recovering-session",
					lifecycle: "recovering",
					activity: "idle",
					sessionId: "",
					cwd: "",
				},
				{ id: "ready-session", cwd: "/workspace", sessionName: "Ready", firstMessage: "Hello", messageCount: 1 },
			],
			getSession: () => undefined,
		} as unknown as Pick<PrimeBridge, "listSessions" | "getSession">;
		const rows = await listSessionRows(bridge, { activeProjectIdForSession: async () => "project-1" });
		expect(rows.map((row) => row.sessionId)).toEqual(["ready-session"]);
		expect(presentationLoader).not.toHaveBeenCalled();
	});

	it("filters projects before reading sidecars and skips complete summaries", async () => {
		presentationLoader.mockReset();
		const bridge = {
			listSessions: async () => [
				{ id: "foreign", cwd: "/foreign", path: "/sessions/foreign.jsonl" },
				{ id: "complete", cwd: "/workspace", sessionName: "Named", firstMessage: "Hello", messageCount: 1 },
			],
			getSession: () => undefined,
		} as unknown as Pick<PrimeBridge, "listSessions" | "getSession">;
		const rows = await listSessionRows(
			bridge,
			{ activeProjectIdForSession: async (id) => (id === "foreign" ? "foreign-project" : "project-1") },
			"project-1",
		);
		expect(rows.map((row) => row.sessionId)).toEqual(["complete"]);
		expect(presentationLoader).not.toHaveBeenCalled();
	});
});

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
