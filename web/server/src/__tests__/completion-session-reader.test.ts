/**
 * What the corpus reads out of a session file.
 *
 * The read seam is the whole reason this test exists: a session's *context* is
 * what the model is shown (the branch to the current leaf, with everything before
 * a compaction's `firstKeptEntryId` replaced by a summary), while a prompt is
 * something the person wrote, and it does not stop being one because the
 * conversation was compacted away. Reading the context instead of the entries
 * measured 522 prompts on a store that holds 830.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "prime-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harvestPromptCandidates } from "../completion/match";
import { openSessionWithRuntime } from "../completion/singleton";

describe("openSessionWithRuntime", () => {
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = mkdtempSync(join(tmpdir(), "fleet-session-reader-"));
	});

	afterEach(() => {
		rmSync(sessionDir, { recursive: true, force: true });
	});

	/** The minimum the runtime accepts for an assistant turn. */
	const ASSISTANT = {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "acknowledged" }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: 0,
	};

	/** A session whose compaction keeps the last two turns and summarises the rest. */
	function compactedSession(): string {
		const manager = SessionManager.create(process.cwd(), sessionDir);
		const user = (text: string) =>
			manager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: 0 });
		const assistant = () => manager.appendMessage({ ...ASSISTANT });

		user("explore this codebase and explain its architecture");
		assistant();
		user("analyze the uncommitted changes on this branch");
		assistant();
		const kept = user("now analyze the rendering layer and its components");
		assistant();
		manager.appendCompaction("earlier work, summarised", kept, 120);
		user("continue with the composer work");
		manager.flushNow();
		return manager.getSessionFile()!;
	}

	it("keeps prompts a compaction summarised away", async () => {
		const file = compactedSession();

		const harvested = harvestPromptCandidates(await openSessionWithRuntime(file), 0).map((c) => c.text);
		expect(harvested).toEqual([
			"explore this codebase and explain its architecture",
			"analyze the uncommitted changes on this branch",
			"now analyze the rendering layer and its components",
			"continue with the composer work",
		]);

		// The same file read as the model sees it: the two turns before the
		// compaction boundary are gone, replaced by the summary. This is the loss
		// the entry read exists to avoid.
		const context = (await SessionManager.openAsync(file)).buildSessionContext();
		expect(context.messages.filter((message) => (message as { role?: string }).role === "user")).toHaveLength(2);
	});

	it("indexes user prose only", async () => {
		const file = compactedSession();
		const harvested = harvestPromptCandidates(await openSessionWithRuntime(file), 0).map((c) => c.text);

		// Assistant turns are entries too, and are not candidates.
		expect(harvested).not.toContain("acknowledged");
		// Nor is the compaction summary, which is a message the context *synthesises*
		// and never an entry — the entry read cannot see it at all.
		expect(harvested.some((text) => text.includes("summarised"))).toBe(false);
		// Bash execution is persisted with its own role, so the `role !== "user"`
		// filter keeps shell output out of the corpus without a special case.
		expect(harvested.every((text) => text.length >= 8 && !text.startsWith("<"))).toBe(true);
	});
});
