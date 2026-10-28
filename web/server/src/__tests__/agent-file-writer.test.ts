import { mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RUNTIME_FILE_MODE, readJsonObjectFile, updateJsonObjectFile, writeJsonObjectFile } from "../agent-file-writer";

let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "fleet-writer-"));
});

afterEach(() => {
	// The temp dir is unique per test and holds no user data.
});

describe("agent file writer", () => {
	it("reports a missing file distinctly from a corrupt one", async () => {
		expect(await readJsonObjectFile(join(dir, "absent.json"))).toEqual({ kind: "missing" });

		const corrupt = join(dir, "corrupt.json");
		await writeFile(corrupt, "{not json", "utf8");
		expect((await readJsonObjectFile(corrupt)).kind).toBe("invalid");

		const array = join(dir, "array.json");
		await writeFile(array, "[1,2,3]", "utf8");
		expect((await readJsonObjectFile(array)).kind).toBe("invalid");
	});

	it("writes owner-only by default for credential-bearing files", async () => {
		const path = join(dir, "auth.json");
		await writeJsonObjectFile(path, { provider: { type: "api_key" } }, { mode: RUNTIME_FILE_MODE });
		// One descriptor for both the mode check and the contents, so the assertions
		// describe a single file rather than two path lookups that could in principle
		// see different files.
		const handle = await open(path, "r");
		try {
			expect((await handle.stat()).mode & 0o777).toBe(RUNTIME_FILE_MODE);
			expect(JSON.parse(await handle.readFile("utf8"))).toEqual({ provider: { type: "api_key" } });
		} finally {
			await handle.close();
		}
	});

	it("preserves an existing file's permissions instead of widening them", async () => {
		const path = join(dir, "settings.json");
		await writeFile(path, "{}\n", { encoding: "utf8", mode: 0o600 });
		await writeJsonObjectFile(path, { transport: "auto" }, { mode: 0o600 });
		const handle = await open(path, "r");
		try {
			expect((await handle.stat()).mode & 0o777).toBe(0o600);
		} finally {
			await handle.close();
		}
	});

	it("serializes concurrent read-merge-writes so no update is lost", async () => {
		const path = join(dir, "settings.json");
		await writeJsonObjectFile(path, { seed: true }, { mode: 0o600 });

		// Without the lock these interleave: each reads the original and the last
		// rename wins, silently dropping the others.
		await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				updateJsonObjectFile(path, (current) => ({ next: { ...current, [`key${index}`]: index }, result: index }), {
					mode: 0o600,
				}),
			),
		);

		const written = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
		for (let index = 0; index < 12; index++) expect(written[`key${index}`]).toBe(index);
		expect(written.seed).toBe(true);
	});

	it("refuses to overwrite a file it cannot parse", async () => {
		const path = join(dir, "auth.json");
		await writeFile(path, "{broken", "utf8");
		const result = await updateJsonObjectFile(path, () => ({ next: { replaced: true }, result: "ok" }));
		expect(result.status).toBe("refused");
		// The unparseable content is left untouched rather than discarded.
		expect(await readFile(path, "utf8")).toBe("{broken");
	});

	it("lets a mutation refuse without writing", async () => {
		const path = join(dir, "settings.json");
		await writeJsonObjectFile(path, { version: 99 }, { mode: 0o600 });
		const result = await updateJsonObjectFile(path, () => ({ refuse: "newer shape" }));
		expect(result).toEqual({ status: "refused", reason: "newer shape" });
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 99 });
	});

	it("reclaims a lock left behind by a dead process", async () => {
		const path = join(dir, "settings.json");
		await writeJsonObjectFile(path, { value: 1 }, { mode: 0o600 });
		// A pid that cannot be running, standing in for a crashed writer.
		await writeFile(`${path}.lock`, "2147483647", "utf8");

		const result = await updateJsonObjectFile(path, (current) => ({
			next: { ...current, value: 2 },
			result: "ok",
		}));
		expect(result.status).toBe("written");
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ value: 2 });
	});
});
