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
	it("bounds stalled archive downloads and cleans staging after an abort", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-server-runtime-timeout-"));
		roots.push(root);
		const installRoot = join(root, "cache", "linux-x64");
		const controller = new AbortController();
		const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
		try {
			await expect(
				ensurePrimeAgentRuntime({
					target: "linux-x64",
					installRoot,
					fetch: async (_url, options) =>
						new Promise((_resolve, reject) => {
							options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
							controller.abort(new DOMException("Download timed out", "TimeoutError"));
						}),
				}),
			).rejects.toThrow("Download timed out");
			expect(timeout).toHaveBeenCalledWith(120_000);
			expect(await readdir(dirname(installRoot))).toEqual([]);
		} finally {
			timeout.mockRestore();
		}
	});
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
		await mkdir(join(input, "prime-agent-runtime", "src", "rlm"), { recursive: true });
		const binary = Buffer.from("fixture runtime");
		await writeFile(join(input, "prime-agent"), binary);
		// The shipped archive always carries the packaged kernel runtime. A
		// binary-only fixture would let an install look complete while the kernel
		// could never start, and would defeat the "already installed" early return.
		await writeFile(join(input, "prime-agent-runtime", "pyproject.toml"), "[project]\n");
		await writeFile(join(input, "prime-agent-runtime", "src", "rlm", "__init__.py"), "def spawn():\n\tpass\n");
		const archivePath = join(root, "runtime.tar.gz");
		const tar = spawnSync("tar", ["-czf", archivePath, "-C", input, "."]);
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
		// A complete install (binary and packaged runtime) short-circuits.
		expect(fetchFixture).toHaveBeenCalledTimes(2);
	});
	it("installs the packaged kernel runtime beside the binary", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-server-runtime-test-"));
		roots.push(root);
		const input = join(root, "input");
		await mkdir(join(input, "prime-agent-runtime", "src", "rlm"), { recursive: true });
		const binary = Buffer.from("fixture runtime");
		await writeFile(join(input, "prime-agent"), binary);
		await writeFile(join(input, "prime-agent-runtime", "pyproject.toml"), "[project]\n");
		await writeFile(join(input, "prime-agent-runtime", "src", "rlm", "__init__.py"), "def spawn():\n\tpass\n");
		const archivePath = join(root, "runtime.tar.gz");
		const tar = spawnSync("tar", ["-czf", archivePath, "-C", input, "."]);
		expect(tar.status).toBe(0);
		const archive = await readFile(archivePath);
		asset.sha256 = createHash("sha256").update(archive).digest("hex");
		asset.executableSha256 = createHash("sha256").update(binary).digest("hex");
		const installRoot = join(root, "cache", "linux-x64");
		const binaryPath = await ensurePrimeAgentRuntime({
			target: "linux-x64",
			installRoot,
			fetch: (async () => new Response(archive)) as typeof fetch,
		});
		// The kernel bootstraps from this directory; a binary-only install leaves
		// every session unable to start one.
		expect(await readdir(installRoot)).toEqual(["prime-agent", "prime-agent-runtime"]);
		expect(await readFile(join(installRoot, "prime-agent-runtime", "pyproject.toml"), "utf8")).toBe("[project]\n");
		expect(binaryPath).toBe(join(installRoot, "prime-agent"));
	});
	it("repairs an existing binary-only install whose executable is already current", async () => {
		const root = await mkdtemp(join(tmpdir(), "fleet-server-runtime-test-"));
		roots.push(root);
		const input = join(root, "input");
		await mkdir(join(input, "prime-agent-runtime", "src", "rlm"), { recursive: true });
		const binary = Buffer.from("fixture runtime");
		await writeFile(join(input, "prime-agent"), binary);
		await writeFile(join(input, "prime-agent-runtime", "pyproject.toml"), "[project]\n");
		await writeFile(join(input, "prime-agent-runtime", "src", "rlm", "__init__.py"), "def spawn():\n\tpass\n");
		const archivePath = join(root, "runtime.tar.gz");
		const tar = spawnSync("tar", ["-czf", archivePath, "-C", input, "."]);
		expect(tar.status).toBe(0);
		const archive = await readFile(archivePath);
		asset.sha256 = createHash("sha256").update(archive).digest("hex");
		asset.executableSha256 = createHash("sha256").update(binary).digest("hex");

		// The state every install made by an earlier Fleet is in: the executable is
		// present and hash-correct, but the packaged runtime was never kept. A
		// binary-only early return would leave the kernel permanently unstartable.
		const installRoot = join(root, "cache", "linux-x64");
		await mkdir(installRoot, { recursive: true });
		await writeFile(join(installRoot, "prime-agent"), binary);

		await ensurePrimeAgentRuntime({
			target: "linux-x64",
			installRoot,
			fetch: (async () => new Response(archive)) as typeof fetch,
		});

		expect(await readdir(installRoot)).toEqual(["prime-agent", "prime-agent-runtime"]);
		expect(await readFile(join(installRoot, "prime-agent-runtime", "pyproject.toml"), "utf8")).toBe("[project]\n");
		expect(await readFile(join(installRoot, "prime-agent"))).toEqual(binary);
	});
});
