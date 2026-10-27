import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePrimeAgentRuntime } from "../prime-runtime";

const { asset } = vi.hoisted(() => ({ asset: { archive: "runtime.tar.gz", sha256: "", executableSha256: "" } }));
vi.mock("../../../../PRIME_AGENT_RUNTIME.json", () => ({
	default: { rust: { version: "1.2.3", baseUrl: "https://runtime.invalid", platforms: { "linux-x64": asset } } },
}));

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Prime Agent runtime installation", () => {
	it("rejects unverified network bytes before writing an archive or installing a runtime", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-server-runtime-test-"));
		roots.push(root);
		const installRoot = join(root, "cache", "linux-x64");
		asset.sha256 = "0".repeat(64);
		await expect(
			ensurePrimeAgentRuntime({
				target: "linux-x64",
				installRoot,
				fetch: async () => new Response("untrusted archive"),
			}),
		).rejects.toThrow("archive checksum mismatch");
		expect(await readdir(dirname(installRoot))).toEqual([]);
	});
	it("stages next to the destination and safely installs concurrently", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-server-runtime-test-"));
		roots.push(root);
		const input = join(root, "input");
		await mkdir(input);
		const binary = Buffer.from("fixture runtime");
		await writeFile(join(input, "prime-agent"), binary);
		const archivePath = join(root, "runtime.tar.gz");
		const tar = spawnSync("tar", ["-czf", archivePath, "-C", input, "prime-agent"]);
		expect(tar.status).toBe(0);
		const archive = await readFile(archivePath);
		asset.sha256 = createHash("sha256").update(archive).digest("hex");
		asset.executableSha256 = createHash("sha256").update(binary).digest("hex");
		const installRoot = join(root, "cache", "linux-x64");
		const fetchFixture = vi.fn(async () => {
			expect((await readdir(dirname(installRoot))).some((entry) => entry.startsWith(".fleet-prime-runtime-"))).toBe(
				true,
			);
			return new Response(archive);
		});
		const options = { target: "linux-x64", installRoot, fetch: fetchFixture as typeof fetch };
		const results = await Promise.all([ensurePrimeAgentRuntime(options), ensurePrimeAgentRuntime(options)]);
		expect(results).toEqual([join(installRoot, "prime-agent"), join(installRoot, "prime-agent")]);
		expect(await readFile(results[0])).toEqual(binary);
		expect(await readdir(dirname(installRoot))).toEqual(["linux-x64"]);
		expect(fetchFixture).toHaveBeenCalledTimes(2);
		await ensurePrimeAgentRuntime(options);
		expect(fetchFixture).toHaveBeenCalledTimes(2);
	});
});
