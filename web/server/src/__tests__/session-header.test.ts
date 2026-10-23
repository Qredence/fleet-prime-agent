import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionHeaderId } from "../session-header";

describe("readSessionHeaderId (read-only)", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "session-header-test-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	const header = {
		type: "session",
		version: 3,
		id: "01a1683e-802b-7379-ba56-8dfea3a92117",
		timestamp: "t",
		cwd: "/w",
	};
	const past = new Date("2020-01-01T00:00:00Z");

	/** Write `content`, pin an old mtime, run the lookup, and assert nothing changed on disk. */
	async function lookupUnchanged(name: string, content: string): Promise<string | undefined> {
		const file = join(dir, name);
		writeFileSync(file, content);
		utimesSync(file, past, past);
		const before = readFileSync(file);
		const id = await readSessionHeaderId(file);
		expect(readFileSync(file).equals(before)).toBe(true);
		expect(statSync(file).mtimeMs).toBe(past.getTime());
		return id;
	}

	it("resolves the id from a valid header, even with a damaged tail, without touching the file", async () => {
		const damagedTail = `${JSON.stringify(header)}\n{"type":"message","id":"m1"}\n{"type":"mess`;
		await expect(lookupUnchanged("damaged.jsonl", damagedTail)).resolves.toBe(header.id);
		await expect(lookupUnchanged("header-only.jsonl", JSON.stringify(header))).resolves.toBe(header.id);
	});

	it.each([
		["header-less", `{"type":"message","id":"m1"}\n{"type":"message","id":"m2"}\n`],
		["malformed header", `{"type":"session","id":\n`],
		["empty", ""],
		["header without id", `${JSON.stringify({ type: "session", cwd: "/w" })}\n`],
	])("returns undefined for a %s file and leaves it byte-identical", async (_label, content) => {
		await expect(lookupUnchanged("bad.jsonl", content)).resolves.toBeUndefined();
	});

	it("returns undefined for a missing file and creates no directory", async () => {
		const missingDir = join(dir, "never-created", "nested");
		await expect(readSessionHeaderId(join(missingDir, "s.jsonl"))).resolves.toBeUndefined();
		expect(existsSync(join(dir, "never-created"))).toBe(false);
	});

	it("returns undefined for a directory path", async () => {
		await expect(readSessionHeaderId(dir)).resolves.toBeUndefined();
	});
});
