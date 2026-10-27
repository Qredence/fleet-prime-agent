import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export function runtimeTarget(os = platform(), cpu = arch()) {
	const target = `${os}-${cpu}`;
	if (!["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].includes(target)) {
		throw new Error(
			`Fleet's Rust Prime Agent runtime does not support ${target}; supported targets: darwin-arm64, darwin-x64, linux-arm64, linux-x64.`,
		);
	}
	return target;
}

export async function ensurePrimeRuntime({
	manifest,
	installRoot,
	home = homedir(),
	fetch: fetchImpl = fetch,
	target = runtimeTarget(),
}) {
	const runtime = manifest.rust;
	const asset = runtime?.platforms?.[target];
	if (!asset) throw new Error(`Fleet has no pinned Prime Agent runtime for ${target}`);
	const destination = installRoot ?? join(home, ".prime", "fleet", "runtimes", runtime.version, target);
	const executable = join(destination, "prime-agent");
	if (await matchesDigest(executable, asset.executableSha256)) return executable;

	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	const staging = await mkdtemp(join(dirname(destination), ".fleet-prime-runtime-"));
	try {
		const archivePath = join(staging, asset.archive);
		const response = await fetchImpl(`${runtime.baseUrl}/${asset.archive}`);
		if (!response.ok)
			throw new Error(
				`Could not download Prime Agent ${runtime.version} (${response.status}). Check your network and retry.`,
			);
		const archive = Buffer.from(await response.arrayBuffer());
		if (digest(archive) !== asset.sha256)
			throw new Error(`Prime Agent ${runtime.version} archive checksum mismatch; refusing to install it.`);
		await writeFile(archivePath, archive, { mode: 0o600 });
		const unpacked = join(staging, "unpacked");
		await mkdir(unpacked);
		const result = spawnSync("tar", ["-xzf", archivePath, "-C", unpacked], { encoding: "utf8" });
		if (result.status !== 0)
			throw new Error(`Could not extract Prime Agent runtime: ${result.stderr || "tar failed"}`);
		if (!(await matchesDigest(join(unpacked, "prime-agent"), asset.executableSha256))) {
			throw new Error("Extracted Prime Agent executable checksum mismatch; refusing to install it.");
		}
		await chmod(join(unpacked, "prime-agent"), 0o755);
		await mkdir(destination, { recursive: true, mode: 0o700 });
		await rename(join(unpacked, "prime-agent"), executable);
		return executable;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function matchesDigest(path, expected) {
	let file;
	try {
		file = await open(path, "r");
		return (await file.stat()).isFile() && digest(await file.readFile()) === expected;
	} catch {
		return false;
	} finally {
		await file?.close();
	}
}

function digest(value) {
	return createHash("sha256").update(value).digest("hex");
}
