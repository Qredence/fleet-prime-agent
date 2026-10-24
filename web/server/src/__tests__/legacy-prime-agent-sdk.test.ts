/**
 * The R1b legacy bridge (`legacy/prime-agent-sdk.ts`).
 *
 * The session reader must match what `SessionManager` reports for a transcript
 * while never writing to it, and the config factories must round-trip through
 * the real v0.9.8 stores.
 */
import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "prime-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLegacyAuthStorage,
	createLegacyModelRegistry,
	createLegacySettingsManager,
	readLegacySession,
} from "../legacy/prime-agent-sdk";

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

describe("legacy Prime Agent SDK bridge", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "fleet-legacy-bridge-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	function compactedSession(): { file: string; manager: SessionManager } {
		const manager = SessionManager.create(dir, join(dir, "sessions"));
		const user = (text: string) =>
			manager.appendMessage({ role: "user", content: [{ type: "text", text }], timestamp: 0 });
		user("first prompt");
		manager.appendMessage({ ...ASSISTANT });
		const kept = user("second prompt");
		manager.appendMessage({ ...ASSISTANT });
		manager.appendCompaction("earlier work, summarised", kept, 120);
		user("third prompt");
		manager.flushNow();
		return { file: manager.getSessionFile()!, manager };
	}

	function fingerprint(file: string): { bytes: string; mtimeMs: number } {
		return { bytes: readFileSync(file, "utf8"), mtimeMs: statSync(file).mtimeMs };
	}

	describe("readLegacySession", () => {
		it("reports the same id, cwd, header, entries and context messages as SessionManager", async () => {
			const { file, manager } = compactedSession();
			// SessionManager.openAsync may rewrite what it opens, so compare against a copy.
			const copy = join(dir, "copy.jsonl");
			copyFileSync(file, copy);
			const reference = await SessionManager.openAsync(copy);

			const snapshot = await readLegacySession(file);
			expect(snapshot).toBeDefined();
			expect(snapshot!.sessionFile).toBe(file);
			expect(snapshot!.sessionId).toBe(manager.getSessionId());
			expect(snapshot!.cwd).toBe(dir);
			expect(snapshot!.header).toEqual(reference.getHeader());
			expect(snapshot!.entries).toEqual(reference.getEntries());
			expect(snapshot!.messages()).toEqual(reference.buildSessionContext().messages);
			// The compaction collapses the first turn into a summary.
			const userMessages = snapshot!.messages().filter((message) => (message as { role?: string }).role === "user");
			expect(userMessages).toHaveLength(2);
		});

		it("never writes to the transcript, even when its tail is damaged", async () => {
			const { file } = compactedSession();
			appendFileSync(file, '{"type":"message","id":"partial"');
			const before = fingerprint(file);

			const snapshot = await readLegacySession(file);

			expect(snapshot?.entries.some((entry) => entry.id === "partial")).toBe(false);
			expect(fingerprint(file)).toEqual(before);
		});

		it("returns undefined for a missing file without creating it", async () => {
			const missing = join(dir, "sessions", "missing.jsonl");
			await expect(readLegacySession(missing)).resolves.toBeUndefined();
			expect(existsSync(missing)).toBe(false);
			expect(existsSync(join(dir, "sessions"))).toBe(false);
		});

		it("returns undefined for empty or header-less files and leaves them untouched", async () => {
			const empty = join(dir, "empty.jsonl");
			writeFileSync(empty, "");
			const headerless = join(dir, "headerless.jsonl");
			writeFileSync(headerless, '{"type":"message","id":"a","parentId":null}\n');
			const emptyBefore = fingerprint(empty);
			const headerlessBefore = fingerprint(headerless);

			await expect(readLegacySession(empty)).resolves.toBeUndefined();
			await expect(readLegacySession(headerless)).resolves.toBeUndefined();

			expect(fingerprint(empty)).toEqual(emptyBefore);
			expect(fingerprint(headerless)).toEqual(headerlessBefore);
		});
	});

	describe("config factories", () => {
		it("round-trips an api_key credential through AuthStorage at an explicit path", () => {
			const authPath = join(dir, "auth.json");
			const storage = createLegacyAuthStorage(authPath);
			storage.set("fleet-test", { type: "api_key", key: "not-a-real-key" });

			const reopened = createLegacyAuthStorage(authPath);
			expect(reopened.get("fleet-test")).toEqual({ type: "api_key", key: "not-a-real-key" });
			expect(statSync(authPath).mode & 0o777).toBe(0o600);
		});

		it("builds a ModelRegistry over the given auth store and models.json", () => {
			const registry = createLegacyModelRegistry(
				createLegacyAuthStorage(join(dir, "auth.json")),
				join(dir, "models.json"),
			);
			expect(Array.isArray(registry.getAll())).toBe(true);
		});

		it("binds a SettingsManager to the given cwd", () => {
			const settings = createLegacySettingsManager(dir);
			expect(typeof settings.getGlobalSettings()).toBe("object");
		});
	});
});
