import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexableSession, OpenSession } from "../completion/prompt-index";
import {
	createPromptIndex,
	PROMPT_INDEX_MAX_AGE_MS,
	PROMPT_INDEX_MAX_SESSION_ENTRIES,
	PROMPT_INDEX_RETRY_BACKOFF_MS,
	promptIndexPath,
} from "../completion/prompt-index";

const NOW = Date.parse("2026-09-18T12:00:00.000Z");

function session(file: string, modified: string, extra: Partial<IndexableSession> = {}): IndexableSession {
	return { sessionFile: file, modified, ...extra };
}

/** Subagent detection is the normalised `isSubagent` flag, not a re-derivation. */
function subagent(file: string, modified: string): IndexableSession {
	return { sessionFile: file, modified, isSubagent: true };
}

describe("createPromptIndex", () => {
	let agentDir: string;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "fleet-prompt-index-"));
	});

	afterEach(() => {
		rmSync(agentDir, { recursive: true, force: true });
	});

	const makeIndex = (options: {
		sessions: ReadonlyArray<IndexableSession>;
		openSession: OpenSession;
		now?: number;
		sessionLimit?: number;
	}) =>
		createPromptIndex({
			agentDir,
			listSessions: async () => options.sessions,
			openSession: options.openSession,
			now: () => options.now ?? NOW,
			sessionLimit: options.sessionLimit,
		});

	it("harvests only user text, through the supplied session reader", async () => {
		const openSession = vi.fn<OpenSession>(async () => [
			{ role: "user", text: "refactor the auth middleware and add tests" },
			{ role: "assistant", text: "assistant output must never be indexed" },
		]);
		const index = makeIndex({
			sessions: [session("/s/a.jsonl", "2026-09-18T11:00:00.000Z")],
			openSession,
		});
		await index.refresh();

		const candidates = index.candidates().map((c) => c.text);
		expect(candidates).toEqual(["refactor the auth middleware and add tests"]);
		expect(openSession).toHaveBeenCalledWith("/s/a.jsonl");
		expect(index.stats()).toMatchObject({ sessions: 1, prompts: 1 });
	});

	it("skips subagent sessions and sessions with no readable file", async () => {
		const openSession = vi.fn<OpenSession>(async () => [{ role: "user", text: "a real prompt from a person" }]);
		const index = makeIndex({
			sessions: [
				subagent("/s/child.jsonl", "2026-09-18T11:00:00.000Z"),
				subagent("/s/orphan.jsonl", "2026-09-18T11:00:00.000Z"),
				{ sessionFile: undefined, modified: "2026-09-18T11:00:00.000Z" },
				session("/s/real.jsonl", "2026-09-18T11:00:00.000Z"),
			],
			openSession,
		});
		await index.refresh();

		expect(openSession).toHaveBeenCalledTimes(1);
		expect(openSession).toHaveBeenCalledWith("/s/real.jsonl");
	});

	it("reads every listed session, however long ago it was last touched", async () => {
		// The window was 400, which on this store silently cost 95 prompts from the
		// 47 sessions it excluded — including one session holding 35. Recency is a
		// ranking, not a reason for a prompt to stop being a candidate.
		const openSession = vi.fn<OpenSession>(async () => [{ role: "user", text: "a real prompt from a person" }]);
		const sessions = Array.from({ length: 450 }, (_, index) =>
			session(`/s/${index}.jsonl`, new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString()),
		);
		const index = makeIndex({ sessions, openSession });
		await index.refresh();

		expect(openSession).toHaveBeenCalledTimes(450);
		expect(index.stats().sessions).toBe(450);
	});

	it("keeps only the most recently updated sessions up to the limit", async () => {
		const openSession = vi.fn<OpenSession>(async () => [{ role: "user", text: "a real prompt from a person" }]);
		const index = makeIndex({
			sessions: [
				session("/s/old.jsonl", "2026-01-01T00:00:00.000Z"),
				session("/s/new.jsonl", "2026-09-18T11:00:00.000Z"),
				session("/s/mid.jsonl", "2026-06-01T00:00:00.000Z"),
			],
			openSession,
			sessionLimit: 2,
		});
		await index.refresh();

		expect(openSession.mock.calls.map((call) => call[0])).toEqual(["/s/new.jsonl", "/s/mid.jsonl"]);
	});

	it("orders candidates by session recency, latest first", async () => {
		const openSession: OpenSession = async (file) =>
			file === "/s/new.jsonl"
				? [{ role: "user", text: "the newer prompt of the two" }]
				: [{ role: "user", text: "the older prompt of the two" }];
		const index = makeIndex({
			sessions: [
				session("/s/old.jsonl", "2026-01-01T00:00:00.000Z"),
				session("/s/new.jsonl", "2026-09-18T11:00:00.000Z"),
			],
			openSession,
		});
		await index.refresh();

		expect(index.candidates()[0]?.text).toBe("the newer prompt of the two");
	});

	it("persists into the agent dir, beside the runtime's own files", async () => {
		const index = makeIndex({
			sessions: [session("/s/a.jsonl", "2026-09-18T11:00:00.000Z")],
			openSession: async () => [{ role: "user", text: "persisted across process restarts" }],
		});
		await index.refresh();

		const persisted = JSON.parse(readFileSync(promptIndexPath(agentDir), "utf8"));
		expect(persisted.version).toBe(1);
		expect(persisted.sessions[0].prompts).toEqual(["persisted across process restarts"]);
	});

	it("reuses a fresh persisted index without re-reading any session", async () => {
		const first = vi.fn<OpenSession>(async () => [{ role: "user", text: "a real prompt from a person" }]);
		await makeIndex({ sessions: [session("/s/a.jsonl", "2026-09-18T11:00:00.000Z")], openSession: first }).refresh();
		expect(first).toHaveBeenCalledTimes(1);

		// A new process at the same moment: the index is fresh on disk.
		const second = vi.fn<OpenSession>(async () => [{ role: "user", text: "should not be called" }]);
		const index = makeIndex({ sessions: [session("/s/a.jsonl", "2026-09-18T11:00:00.000Z")], openSession: second });
		index.candidates();
		await vi.waitFor(() => expect(index.stats().sessions).toBe(1));
		expect(second).not.toHaveBeenCalled();
		expect(index.candidates().map((c) => c.text)).toEqual(["a real prompt from a person"]);
	});

	it("re-reads only the sessions whose timestamp moved", async () => {
		const openSession = vi.fn<OpenSession>(async () => [{ role: "user", text: "a real prompt from a person" }]);
		const sessions = [
			session("/s/stable.jsonl", "2026-09-18T11:00:00.000Z"),
			session("/s/changed.jsonl", "2026-09-18T11:00:00.000Z"),
		];
		await makeIndex({ sessions, openSession }).refresh();
		expect(openSession).toHaveBeenCalledTimes(2);

		openSession.mockClear();
		const later = {
			...sessions[1]!,
			modified: "2026-09-18T11:30:00.000Z",
		};
		await createPromptIndex({
			agentDir,
			listSessions: async () => [sessions[0]!, later],
			openSession,
			now: () => NOW + PROMPT_INDEX_MAX_AGE_MS + 1,
		}).refresh();

		expect(openSession.mock.calls.map((call) => call[0])).toEqual(["/s/changed.jsonl"]);
	});

	it("survives an unreadable session and a corrupt index file", async () => {
		writeFileSync(promptIndexPath(agentDir), "{ not json at all", "utf8");
		const openSession: OpenSession = async (file) => {
			if (file === "/s/broken.jsonl") throw new Error("unreadable");
			return [{ role: "user", text: "a real prompt from a person" }];
		};
		const index = makeIndex({
			sessions: [
				session("/s/broken.jsonl", "2026-09-18T11:30:00.000Z"),
				session("/s/good.jsonl", "2026-09-18T11:00:00.000Z"),
			],
			openSession,
		});
		await index.refresh();
		expect(index.candidates().map((c) => c.text)).toEqual(["a real prompt from a person"]);
		expect(index.stats().sessions).toBe(1);
	});

	it("clears the corpus once an empty store is confirmed", async () => {
		const withPrompts: OpenSession = async () => [{ role: "user", text: "a real prompt from a person" }];
		await makeIndex({
			sessions: [session("/s/a.jsonl", "2026-09-18T11:00:00.000Z")],
			openSession: withPrompts,
		}).refresh();

		// The store now reports no sessions at all, twice. The first is treated as
		// transient; the second is trusted, so deleted prompts stop being served.
		const empty = makeIndex({ sessions: [], openSession: withPrompts, now: NOW + PROMPT_INDEX_MAX_AGE_MS + 1 });
		await empty.refresh();
		expect(empty.candidates().map((c) => c.text)).toEqual(["a real prompt from a person"]);

		const confirmed = createPromptIndex({
			agentDir,
			listSessions: async () => [],
			openSession: withPrompts,
			now: () => NOW + PROMPT_INDEX_MAX_AGE_MS + PROMPT_INDEX_RETRY_BACKOFF_MS + 2,
		});
		await confirmed.refresh();
		expect(confirmed.candidates()).toEqual([]);
	});

	it("answers immediately from an empty corpus while the build runs", async () => {
		const index = makeIndex({
			sessions: [session("/s/a.jsonl", "2026-09-18T11:00:00.000Z")],
			openSession: async () => [{ role: "user", text: "a real prompt from a person" }],
		});
		// Never awaits a build: a cold index returns nothing rather than blocking.
		expect(index.candidates()).toEqual([]);
		await vi.waitFor(() => expect(index.candidates().length).toBe(1));
	});

	it("skips sessions over the entry-count ceiling", async () => {
		const openSession = vi.fn<OpenSession>(async () =>
			Array.from({ length: PROMPT_INDEX_MAX_SESSION_ENTRIES + 1 }, (_, index) => ({
				role: "user" as const,
				text: `prompt number ${index} from a marathon session`,
			})),
		);
		const index = makeIndex({
			sessions: [session("/s/huge.jsonl", "2026-09-18T11:00:00.000Z")],
			openSession,
		});
		await index.refresh();
		expect(openSession).toHaveBeenCalledTimes(1);
		expect(index.candidates()).toEqual([]);
		expect(index.stats().sessions).toBe(0);
	});

	it("stamps sessionId onto flattened candidates", async () => {
		const index = makeIndex({
			sessions: [session("/s/session-a.jsonl", "2026-09-18T11:00:00.000Z")],
			openSession: async () => [{ role: "user", text: "a real prompt from a person" }],
		});
		await index.refresh();
		expect(index.candidates()[0]).toMatchObject({
			text: "a real prompt from a person",
			sessionFile: "/s/session-a.jsonl",
			sessionId: "session-a",
		});
	});
});
