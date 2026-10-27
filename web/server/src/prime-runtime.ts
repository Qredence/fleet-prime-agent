import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import manifest from "../../../PRIME_AGENT_RUNTIME.json";

export function runtimeArchiveTarget(os: string, cpu: string): string {
	const target = `${os}-${cpu}`;
	if (!["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(target)) {
		throw new Error(
			`Fleet's Rust Prime Agent runtime does not support ${target}; supported targets: darwin-arm64, darwin-x64, linux-arm64, linux-x64.`,
		);
	}
	return target;
}

export async function ensurePrimeAgentRuntime(
	options: { target?: string; installRoot?: string; home?: string; fetch?: typeof fetch } = {},
): Promise<string> {
	const selectedTarget = options.target ?? runtimeArchiveTarget(platform(), arch());
	const runtime = manifest.rust;
	const asset = runtime.platforms[selectedTarget as keyof typeof runtime.platforms];
	if (!asset) throw new Error(`No pinned Prime Agent runtime archive for ${selectedTarget}`);
	const installRoot =
		options.installRoot ??
		join(options.home ?? homedir(), ".prime", "fleet", "runtimes", runtime.version, selectedTarget);
	const binary = join(installRoot, "prime-agent");
	if (await executableMatches(binary, asset.executableSha256)) return binary;

	await mkdir(dirname(installRoot), { recursive: true, mode: 0o700 });
	const staging = await mkdtemp(join(dirname(installRoot), ".fleet-prime-runtime-"));
	try {
		const archivePath = join(staging, asset.archive);
		// The release URL comes from Fleet's shipped runtime pin, never session or provider input.
		const response = await (options.fetch ?? fetch)(`${runtime.baseUrl}/${asset.archive}`);
		if (!response.ok)
			throw new Error(
				`Could not download Prime Agent ${runtime.version} (${response.status}). Check your network and retry.`,
			);
		const bytes = Buffer.from(await response.arrayBuffer());
		if (digest(bytes) !== asset.sha256)
			throw new Error(`Prime Agent ${runtime.version} archive checksum mismatch; refusing to install it.`);
		// Only checksum-verified release bytes reach this private staging file.
		await writeFile(archivePath, bytes, { mode: 0o600 });
		const extractRoot = join(staging, "extracted");
		await mkdir(extractRoot);
		const extraction = spawnSync("tar", ["-xzf", archivePath, "-C", extractRoot], { encoding: "utf8" });
		if (extraction.status !== 0)
			throw new Error(`Could not extract Prime Agent runtime: ${extraction.stderr || "tar failed"}`);
		const extractedBinary = join(extractRoot, "prime-agent");
		if (!(await executableMatches(extractedBinary, asset.executableSha256)))
			throw new Error("Extracted Prime Agent executable checksum mismatch; refusing to install it.");
		await chmod(extractedBinary, 0o755);
		await mkdir(installRoot, { recursive: true, mode: 0o700 });
		await rename(extractedBinary, binary);
		return binary;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function executableMatches(path: string, expected: string): Promise<boolean> {
	let file: Awaited<ReturnType<typeof open>> | undefined;
	try {
		file = await open(path, "r");
		return (await file.stat()).isFile() && digest(await file.readFile()) === expected;
	} catch {
		return false;
	} finally {
		await file?.close();
	}
}

function digest(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}
