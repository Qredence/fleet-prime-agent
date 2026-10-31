import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ensurePrimeRuntime, runtimeTarget } from "../../packages/fleet-web/bin/prime-runtime.mjs";

const binDir = fileURLToPath(new URL("../../packages/fleet-web/bin/", import.meta.url));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), "fleet-runtime-test-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const binary = Buffer.from("#!/bin/sh\nprintf 'fixture runtime\\n'\n");
	const files = join(root, "files");
	await mkdir(files);
	await writeFile(join(files, "prime-agent"), binary);
	// The real release ships the kernel bundle beside the binary; a binary-only
	// fixture would let an install look complete while the kernel cannot start.
	await mkdir(join(files, "prime-agent-runtime", "src", "rlm"), { recursive: true });
	await writeFile(join(files, "prime-agent-runtime", "pyproject.toml"), "[project]\n");
	await writeFile(join(files, "prime-agent-runtime", "src", "rlm", "__init__.py"), "def spawn():\n\tpass\n");
	const archivePath = join(root, "runtime.tar.gz");
	const tar = spawnSync("tar", ["-czf", archivePath, "-C", files, "."]);
	assert.equal(tar.status, 0, tar.stderr.toString());
	const archive = await readFile(archivePath);
	const target = runtimeTarget(platform(), arch());
	const manifest = {
		rust: {
			version: "1.2.3",
			baseUrl: "https://runtime.invalid",
			platforms: {
				[target]: { archive: "runtime.tar.gz", sha256: sha256(archive), executableSha256: sha256(binary) },
			},
		},
	};
	return { root, binary, archive, target, manifest };
}

test("runtime target only supports the four published Rust builds", () => {
	assert.equal(runtimeTarget("darwin", "arm64"), "darwin-arm64");
	assert.equal(runtimeTarget("linux", "x64"), "linux-x64");
	assert.throws(() => runtimeTarget("win32", "x64"), /does not support win32-x64/);
});

test("bounds stalled downloads and cleans staging after an abort", async (t) => {
	const { root, manifest, target } = await fixture(t);
	const installRoot = join(root, "cache", target);
	const controller = new AbortController();
	t.mock.method(AbortSignal, "timeout", (duration) => {
		assert.equal(duration, 120_000);
		return controller.signal;
	});
	await assert.rejects(
		ensurePrimeRuntime({
			manifest,
			target,
			installRoot,
			fetch: async (_url, options) =>
				new Promise((_resolve, reject) => {
					options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
					controller.abort(new DOMException("Download timed out", "TimeoutError"));
				}),
		}),
		/Download timed out/,
	);
	assert.deepEqual(await readdir(dirname(installRoot)), []);
});

test("launcher distinguishes missing and non-executable native binaries", async (t) => {
	const { root } = await fixture(t);
	const binary = join(root, "native-agent");
	const run = () =>
		spawnSync(process.execPath, [join(binDir, "fleet-prime.mjs"), "agent"], {
			env: { ...process.env, FLEET_PRIME_AGENT_BIN: binary },
			encoding: "utf8",
			timeout: 5_000,
		});
	let result = run();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Prime Agent binary not found/);
	await writeFile(binary, "fixture", { mode: 0o600 });
	result = run();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Could not start Prime Agent binary .+: EACCES/);
	assert.doesNotMatch(result.stderr, /not found/);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
	test(`launcher forwards ${signal} and preserves the child exit code`, { timeout: 10_000 }, async (t) => {
		const { root } = await fixture(t);
		const binary = join(root, "native-agent");
		await writeFile(
			binary,
			`#!${process.execPath}\nprocess.on("${signal}", () => { console.log("received ${signal}"); process.exit(23); });\nconsole.log("ready");\nsetInterval(() => {}, 1000);\n`,
			{ mode: 0o755 },
		);
		const child = spawn(process.execPath, [join(binDir, "fleet-prime.mjs"), "agent"], {
			env: { ...process.env, FLEET_PRIME_AGENT_BIN: binary },
			stdio: ["ignore", "pipe", "pipe"],
		});
		t.after(() => {
			if (child.exitCode === null) child.kill("SIGKILL");
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		const closed = once(child, "close");
		await new Promise((resolve, reject) => {
			child.stdout.on("data", () => {
				if (output.includes("ready")) resolve();
			});
			child.once("error", reject);
			child.once("exit", () => reject(new Error("Launcher exited before readiness")));
		});
		child.kill(signal);
		const [code, exitSignal] = await closed;
		assert.equal(code, 23);
		assert.equal(exitSignal, null);
		assert.match(output, new RegExp(`received ${signal}`));
	});
}

test("refuses an archive that does not match its pinned checksum", async (t) => {
	const { root, target, manifest } = await fixture(t);
	await assert.rejects(
		ensurePrimeRuntime({
			manifest,
			target,
			installRoot: join(root, "install"),
			fetch: async () => new Response("invalid"),
		}),
		/archive checksum mismatch/,
	);
});

test("refuses an executable that does not match its pinned checksum", async (t) => {
	const { root, target, manifest, archive } = await fixture(t);
	manifest.rust.platforms[target].executableSha256 = "0".repeat(64);
	await assert.rejects(
		ensurePrimeRuntime({
			manifest,
			target,
			installRoot: join(root, "install"),
			fetch: async () => new Response(archive),
		}),
		/executable checksum mismatch/,
	);
});

test("stages beside the destination and safely installs concurrently", async (t) => {
	const { root, binary, archive, target, manifest } = await fixture(t);
	const installRoot = join(root, "cache", target);
	let downloads = 0;
	const fetch = async () => {
		downloads += 1;
		assert.ok((await readdir(dirname(installRoot))).some((name) => name.startsWith(".fleet-prime-runtime-")));
		return new Response(archive);
	};
	const options = { manifest, target, installRoot, fetch };
	const results = await Promise.all([ensurePrimeRuntime(options), ensurePrimeRuntime(options)]);
	assert.deepEqual(results, [join(installRoot, "prime-agent"), join(installRoot, "prime-agent")]);
	assert.deepEqual(await readFile(results[0]), binary);
	assert.equal(downloads, 2);
	assert.deepEqual(await readdir(dirname(installRoot)), [target]);
	assert.equal(
		await ensurePrimeRuntime({
			...options,
			fetch: () => {
				throw new Error("unexpected download");
			},
		}),
		results[0],
	);
});

test("installs the packaged kernel runtime beside the binary", async (t) => {
	const { root, binary, archive, target, manifest } = await fixture(t);
	const installRoot = join(root, "cache", target);
	const executable = await ensurePrimeRuntime({
		manifest,
		target,
		installRoot,
		fetch: async () => new Response(archive),
	});
	assert.equal(executable, join(installRoot, "prime-agent"));
	assert.deepEqual(await readFile(executable), binary);
	assert.deepEqual((await readdir(installRoot)).sort(), ["prime-agent", "prime-agent-runtime"]);
	assert.equal(await readFile(join(installRoot, "prime-agent-runtime", "pyproject.toml"), "utf8"), "[project]\n");
});

test("repairs an existing binary-only install whose executable is already current", async (t) => {
	const { root, binary, archive, target, manifest } = await fixture(t);
	const installRoot = join(root, "cache", target);
	// Every install made by fleet-prime before this fix: a hash-correct
	// executable with no packaged runtime. Reusing it would leave sessions
	// unable to start a kernel.
	await mkdir(installRoot, { recursive: true });
	await writeFile(join(installRoot, "prime-agent"), binary, { mode: 0o755 });
	let downloads = 0;
	const options = {
		manifest,
		target,
		installRoot,
		fetch: async () => {
			downloads += 1;
			return new Response(archive);
		},
	};
	await ensurePrimeRuntime(options);
	assert.equal(downloads, 1);
	assert.deepEqual((await readdir(installRoot)).sort(), ["prime-agent", "prime-agent-runtime"]);
	assert.deepEqual(await readFile(join(installRoot, "prime-agent")), binary);
	// Once complete, the install short-circuits without another download.
	await ensurePrimeRuntime(options);
	assert.equal(downloads, 1);
});

test("launcher reads the source manifest or the packaged manifest and runs the cached agent", async (t) => {
	const { root, binary, target, manifest } = await fixture(t);
	const packageRoot = join(root, "packages", "fleet-web");
	const launcherBin = join(packageRoot, "bin");
	const fakeHome = join(root, "home");
	await mkdir(launcherBin, { recursive: true });
	await Promise.all(
		["fleet-prime.mjs", "prime-runtime.mjs"].map((name) => copyFile(join(binDir, name), join(launcherBin, name))),
	);
	const cached = join(fakeHome, ".prime", "fleet", "runtimes", manifest.rust.version, target, "prime-agent");
	await mkdir(dirname(cached), { recursive: true });
	await writeFile(cached, binary);
	await chmod(cached, 0o755);
	await mkdir(join(dirname(cached), "prime-agent-runtime"));
	const env = { ...process.env, HOME: fakeHome };
	delete env.FLEET_PRIME_AGENT_BIN;
	await writeFile(join(root, "PRIME_AGENT_RUNTIME.json"), JSON.stringify(manifest));
	const run = () =>
		spawnSync(process.execPath, [join(launcherBin, "fleet-prime.mjs"), "agent", "--version"], {
			env,
			encoding: "utf8",
		});
	let result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /fixture runtime/);
	await mkdir(join(packageRoot, "dist"));
	await writeFile(join(packageRoot, "dist", "runtime-manifest.json"), JSON.stringify(manifest));
	await rm(join(root, "PRIME_AGENT_RUNTIME.json"));
	result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /fixture runtime/);
	await rm(join(packageRoot, "dist", "runtime-manifest.json"));
	env.FLEET_PRIME_AGENT_BIN = cached;
	result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /fixture runtime/);
});
