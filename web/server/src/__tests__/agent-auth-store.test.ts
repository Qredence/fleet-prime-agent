import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	authFilePath,
	hasProviderCredential,
	isWritableProviderId,
	removeProviderCredential,
	setProviderApiKey,
} from "../agent-auth-store";

let dir: string;
let path: string;

async function seed(value: Record<string, unknown>): Promise<void> {
	await writeFile(path, `${JSON.stringify(value, null, "\t")}\n`, { encoding: "utf8", mode: 0o600 });
}

async function read(): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "fleet-auth-"));
	path = authFilePath(dir);
});

describe("auth store", () => {
	it("rejects provider ids that would corrupt the file's keys", () => {
		expect(isWritableProviderId("openrouter")).toBe(true);
		expect(isWritableProviderId("mcp:linear")).toBe(true);
		expect(isWritableProviderId("")).toBe(false);
		expect(isWritableProviderId("a/b")).toBe(false);
		expect(isWritableProviderId("a\\b")).toBe(false);
		expect(isWritableProviderId("a b\u0000c")).toBe(false);
	});

	it("stores a key and leaves other providers untouched", async () => {
		await seed({ openrouter: { type: "api_key", key: "existing" }, serper: { type: "api_key", key: "s" } });
		const outcome = await setProviderApiKey(dir, "alibaba", "new-key");
		expect(outcome.status).toBe("written");

		const written = await read();
		expect(written.alibaba).toEqual({ type: "api_key", key: "new-key" });
		expect(written.openrouter).toEqual({ type: "api_key", key: "existing" });
		expect(written.serper).toEqual({ type: "api_key", key: "s" });
	});

	it("preserves extra fields on an entry it updates", async () => {
		// prime-inference carries a primeTeam field Fleet does not model.
		await seed({ "prime-inference": { type: "api_key", key: "old", primeTeam: "qredence" } });
		await setProviderApiKey(dir, "prime-inference", "rotated");

		expect(await read()).toMatchObject({
			"prime-inference": { type: "api_key", key: "rotated", primeTeam: "qredence" },
		});
	});

	it("keeps OAuth refresh state when an API key is written over it", async () => {
		await seed({
			"openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 123, accountId: "acct" },
		});
		await setProviderApiKey(dir, "openai-codex", "api-key");

		// The runtime can still refresh this provider; discarding refresh/expiry
		// would silently sign the user out of that path.
		expect(await read()).toMatchObject({
			"openai-codex": { type: "api_key", key: "api-key", refresh: "r", expires: 123, accountId: "acct" },
		});
	});

	it("refuses an empty key instead of storing whitespace", async () => {
		await seed({});
		expect((await setProviderApiKey(dir, "alibaba", "   ")).status).toBe("refused");
		expect(await read()).toEqual({});
	});

	it("removes only the requested credential", async () => {
		await seed({ alibaba: { type: "api_key", key: "k" }, serper: { type: "api_key", key: "s" } });
		expect((await removeProviderCredential(dir, "alibaba")).status).toBe("written");

		const written = await read();
		expect(written).not.toHaveProperty("alibaba");
		expect(written.serper).toEqual({ type: "api_key", key: "s" });
	});

	it("answers presence without exposing the secret", async () => {
		await seed({ alibaba: { type: "api_key", key: "secret-value" } });
		expect(await hasProviderCredential(dir, "alibaba")).toBe(true);
		expect(await hasProviderCredential(dir, "openrouter")).toBe(false);
	});

	it("writes the file owner-only", async () => {
		await setProviderApiKey(dir, "alibaba", "k");
		const { stat } = await import("node:fs/promises");
		expect((await stat(path)).mode & 0o777).toBe(0o600);
	});

	it("never leaks the key into a refusal message", async () => {
		const { writeFile: write } = await import("node:fs/promises");
		await write(path, "{broken", "utf8");
		const outcome = await setProviderApiKey(dir, "alibaba", "super-secret-key");
		expect(outcome.status).toBe("refused");
		if (outcome.status !== "refused") throw new Error("unreachable");
		expect(outcome.reason).not.toContain("super-secret-key");
	});
});
