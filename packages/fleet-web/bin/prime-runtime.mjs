import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { arch, homedir, platform } from "node:os";
import { dirname, join } from "node:path";

// This module is the single Prime Agent runtime installer. The npm launcher
// (`fleet-prime`) runs it directly, and the web server re-exports it from
// `web/server/src/prime-runtime.ts`, so both install the same payload.

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
	const packagedRuntime = join(destination, "prime-agent-runtime");
	// A verified binary is not enough: the kernel bootstraps from the packaged
	// runtime beside it. Installs made by earlier Fleet releases kept only the
	// executable, so that state is repaired rather than short-circuited.
	if ((await matchesDigest(executable, asset.executableSha256)) && (await directoryExists(packagedRuntime))) {
		return executable;
	}

	await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
	const staging = await mkdtemp(join(dirname(destination), ".fleet-prime-runtime-"));
	try {
		const archivePath = join(staging, asset.archive);
		// The release URL comes from Fleet's shipped runtime pin, never session or provider input.
		const response = await fetchImpl(`${runtime.baseUrl}/${asset.archive}`, {
			signal: AbortSignal.timeout(120_000),
		});
		if (!response.ok)
			throw new Error(
				`Could not download Prime Agent ${runtime.version} (${response.status}). Check your network and retry.`,
			);
		const archive = Buffer.from(await response.arrayBuffer());
		if (digest(archive) !== asset.sha256)
			throw new Error(`Prime Agent ${runtime.version} archive checksum mismatch; refusing to install it.`);
		// Only checksum-verified release bytes reach this private staging file.
		await writeFile(archivePath, archive, { mode: 0o600 });
		const unpacked = join(staging, "unpacked");
		await mkdir(unpacked);
		const result = spawnSync("tar", ["-xzf", archivePath, "-C", unpacked], { encoding: "utf8" });
		if (result.status !== 0)
			throw new Error(`Could not extract Prime Agent runtime: ${result.stderr || "tar failed"}`);
		const extractedBinary = join(unpacked, "prime-agent");
		if (!(await matchesDigest(extractedBinary, asset.executableSha256))) {
			throw new Error("Extracted Prime Agent executable checksum mismatch; refusing to install it.");
		}
		await chmod(extractedBinary, 0o755);
		await mkdir(destination, { recursive: true, mode: 0o700 });
		// The kernel bootstraps from `prime-agent-runtime/`, which ships beside the
		// binary. It lands before the executable is replaced, so a failed rename
		// cannot leave a binary that looks current with no runtime. Any existing
		// copy (possibly damaged) is moved aside into the private staging dir
		// rather than deleted in place, so the window with no runtime is two
		// renames, and the verified copy always replaces it.
		const extractedRuntime = join(unpacked, "prime-agent-runtime");
		if (await directoryExists(extractedRuntime)) {
			await rename(packagedRuntime, join(staging, "previous-runtime")).catch((error) => {
				if (error.code !== "ENOENT") throw error;
			});
			await rename(extractedRuntime, packagedRuntime).catch((error) => {
				// A concurrent install of the same checksummed archive placed it first.
				if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
			});
		}
		await rename(extractedBinary, executable);
		return executable;
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

async function directoryExists(path) {
	try {
		return (await stat(path)).isDirectory();
	} catch (error) {
		// Only absence means "not installed"; surface permission or symlink errors.
		if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
		throw error;
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
