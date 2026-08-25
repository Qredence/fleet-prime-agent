#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, sep, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = join(root, "install.sh");
const mode = process.argv[2] || "--static";

if (mode === "--static") {
	checkStaticInstaller();
	console.log("Source installer check passed.");
} else if (mode === "--smoke") {
	checkStaticInstaller();
	await checkInstallerSmoke();
} else {
	console.error("Usage: node scripts/check-source-installer.mjs [--static|--smoke]");
	process.exit(1);
}

function checkStaticInstaller() {
	const source = readFileSync(installerPath, "utf8");
	const syntax = spawnSync("sh", ["-n", installerPath], { encoding: "utf8" });
	if (syntax.status !== 0) {
		throw new Error(`install.sh has invalid shell syntax:\n${syntax.stderr || syntax.stdout}`);
	}

	for (const marker of [
		"https://github.com/Qredence/fleet-prime-agent.git",
		"git clone",
		"npm ci",
		"--frozen-lockfile",
		"npm run build",
		"scripts/build-web-release.mjs",
		"npm link --force .",
	]) {
		if (!source.includes(marker)) {
			throw new Error(`install.sh is missing required source-install step: ${marker}`);
		}
	}

	for (const forbidden of [
		"PRIME_AGENT_DOWNLOAD_BASE_URL",
		"__PRIME_AGENT_DOWNLOAD_BASE_URL__",
		"R2_PUBLIC_BASE_URL",
		"install-beta.sh",
		"npm install -g --no-fund",
	]) {
		if (source.includes(forbidden)) {
			throw new Error(`install.sh still contains release-only behavior: ${forbidden}`);
		}
	}
}

async function checkInstallerSmoke() {
	const tempRoot = mkdtempSync(join(tmpdir(), "prime-agent-source-installer-"));
	const sourceMirror = join(tempRoot, "source");
	const checkout = join(tempRoot, "checkout");
	const globalPrefix = join(tempRoot, "npm-global");
	const workspace = join(tempRoot, "workspace");
	const runtimeBin = join(tempRoot, "runtime-bin");

	try {
		copyWorkingTree(sourceMirror);
		initializeGitMirror(sourceMirror);
		mkdirSync(checkout, { recursive: true });
		mkdirSync(globalPrefix, { recursive: true });
		mkdirSync(join(globalPrefix, "lib"), { recursive: true });
		mkdirSync(workspace, { recursive: true });
		mkdirSync(runtimeBin, { recursive: true });
		symlinkSync(process.execPath, join(runtimeBin, "node"));

		const repositoryUrl = pathToFileURL(sourceMirror).href;
		const installerEnvironment = {
			...process.env,
			NPM_CONFIG_PREFIX: globalPrefix,
			npm_config_prefix: globalPrefix,
			PATH: [join(globalPrefix, "bin"), process.env.PATH].filter(Boolean).join(delimiter),
			PRIME_AGENT_REPOSITORY_URL: repositoryUrl,
			PRIME_AGENT_REPOSITORY_REF: "main",
			PRIME_AGENT_PNPM_VERSION: "11.15.1",
		};

		const firstInstallOutput = runInstaller(checkout, sourceMirror, installerEnvironment);
		if (!firstInstallOutput.includes("Cloning ")) throw new Error("Installer did not exercise the clone path");
		if (!existsSync(join(checkout, ".git"))) throw new Error("Installer did not create a Git checkout");
		if (!existsSync(join(checkout, "packages", "coding-agent", "dist", "web", "launcher.mjs"))) {
			throw new Error("Installer did not build the packaged web launcher");
		}

		const origin = execFileSync("git", ["config", "--get", "remote.origin.url"], {
			cwd: checkout,
			encoding: "utf8",
		}).trim();
		if (origin !== repositoryUrl) throw new Error(`Installer cloned the wrong repository: ${origin}`);

		// A second run exercises the reuse path. It must build the existing checkout
		// again without pulling, resetting, or cloning over it.
		const reuseOutput = runInstaller(checkout, sourceMirror, installerEnvironment);
		if (!reuseOutput.includes("Using existing Qredence/fleet-prime-agent checkout")) {
			throw new Error("Installer did not exercise the matching-checkout reuse path");
		}
		if (reuseOutput.includes("Cloning ")) throw new Error("Installer cloned over the existing checkout");

		const executable = join(globalPrefix, "bin", "prime-agent");
		if (!existsSync(executable)) throw new Error(`Global prime-agent link was not created at ${executable}`);
		const fleetPrimeExecutable = join(globalPrefix, "bin", "fleet-prime");
		if (!existsSync(fleetPrimeExecutable)) {
			throw new Error(`Global fleet-prime link was not created at ${fleetPrimeExecutable}`);
		}

		const runtimeEnvironment = {
			...process.env,
			PATH: [join(globalPrefix, "bin"), runtimeBin, "/usr/bin", "/bin"].join(delimiter),
			PRIME_AGENT_CODING_AGENT_DIR: join(tempRoot, "agent-config"),
		};
		await checkWebRuntime(fleetPrimeExecutable, workspace, checkout, runtimeEnvironment);

		const occupied = join(tempRoot, "occupied");
		mkdirSync(occupied, { recursive: true });
		writeFileSync(join(occupied, "keep.txt"), "user data\n");
		const refused = spawnSync("sh", [join(sourceMirror, "install.sh")], {
			cwd: occupied,
			env: installerEnvironment,
			encoding: "utf8",
		});
		if (refused.status === 0 || !`${refused.stdout}\n${refused.stderr}`.includes("refusing to overwrite")) {
			throw new Error("Installer did not refuse an unrelated non-empty directory");
		}

		console.log("Source installer smoke check passed.");
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

function copyWorkingTree(target) {
	cpSync(root, target, {
		recursive: true,
		filter(sourcePath) {
			const relativePath = relative(root, sourcePath);
			if (!relativePath) return true;
			const segments = relativePath.split(sep);
			return !segments.some((segment) => segment === ".git" || segment === "node_modules" || segment === "dist" || segment === "release");
		},
	});
}

function initializeGitMirror(directory) {
	execFileSync("git", ["init", "-b", "main"], { cwd: directory, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "source-installer-smoke@example.invalid"], { cwd: directory });
	execFileSync("git", ["config", "user.name", "Source Installer Smoke"], { cwd: directory });
	execFileSync("git", ["add", "--all"], { cwd: directory });
	execFileSync("git", ["commit", "--quiet", "-m", "source-installer-smoke"], { cwd: directory });
}

function runInstaller(checkout, sourceMirror, environment) {
	const result = spawnSync("sh", [join(sourceMirror, "install.sh")], {
		cwd: checkout,
		env: environment,
		encoding: "utf8",
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(`Source installer failed with exit code ${result.status}:\n${result.stdout}\n${result.stderr}`);
	}
	process.stdout.write(result.stdout);
	process.stderr.write(result.stderr);
	return `${result.stdout}\n${result.stderr}`;
}

async function checkWebRuntime(executable, workspace, checkout, environment) {
	const clientRoot = join(checkout, "packages", "coding-agent", "dist", "web", "client");
	const asset = findFirstJavaScriptAsset(clientRoot);
	if (!asset) throw new Error("Source installer produced no client JavaScript asset");

	const child = spawn(executable, ["--host", "127.0.0.1", "--port", "0"], {
		cwd: workspace,
		env: environment,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout?.on("data", (chunk) => {
		output += chunk.toString();
	});
	child.stderr?.on("data", (chunk) => {
		output += chunk.toString();
	});

	try {
		const url = await waitForUrl(child, () => output);
		await assertStatus(`${url}/`, 200, "root page");

		const health = await fetchJson(`${url}/api/health`);
		if (health.status !== 200 || health.body.ok !== true) {
			throw new Error(`Health check failed: HTTP ${health.status} ${JSON.stringify(health.body)}`);
		}

		const workspaceResponse = await fetchJson(`${url}/api/workspace/tree`);
		const workspaceLabelSuffix = `${basename(dirname(workspace))}${sep}${basename(workspace)}`;
		const workspaceMatches =
			typeof workspaceResponse.body.root === "string" &&
			(workspaceResponse.body.root === workspace || workspaceResponse.body.root.endsWith(workspaceLabelSuffix));
		if (workspaceResponse.status !== 200 || !workspaceMatches) {
			throw new Error(`Workspace check failed: expected ${workspace}, got ${JSON.stringify(workspaceResponse.body)}`);
		}

		const assetPath = relative(join(checkout, "packages", "coding-agent", "dist", "web", "client"), asset)
			.split(sep)
			.join("/");
		await assertStatus(`${url}/${assetPath}`, 200, "client asset");
		if (/parse5|Named export .* not found|Cannot find package|ERR_MODULE_NOT_FOUND/.test(output)) {
			throw new Error(`Source-installed web runtime emitted a production module error:\n${output}`);
		}
	} finally {
		child.kill("SIGTERM");
		const exit = await waitForExit(child);
		if (exit.code !== 143 && exit.signal !== "SIGTERM") {
			throw new Error(`Source-installed web runtime did not stop cleanly: ${JSON.stringify(exit)}\n${output}`);
		}
	}
}

function findFirstJavaScriptAsset(directory) {
	if (!existsSync(directory)) return undefined;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isFile() && entry.name.endsWith(".js")) return path;
		if (entry.isDirectory()) {
			const nested = findFirstJavaScriptAsset(path);
			if (nested) return nested;
		}
	}
	return undefined;
}

async function waitForUrl(child, getOutput) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const match = getOutput().match(/Fleet Prime interface: (http:\/\/[^\s]+)/);
		if (match) return match[1];
		if (child.exitCode !== null || child.signalCode !== null) break;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
	}
	throw new Error(`Timed out waiting for source-installed web runtime:\n${getOutput()}`);
}

async function assertStatus(url, expectedStatus, label) {
	const response = await fetch(url);
	if (response.status !== expectedStatus) {
		throw new Error(`${label} failed: expected HTTP ${expectedStatus}, got ${response.status}`);
	}
}

async function fetchJson(url) {
	const response = await fetch(url);
	let body;
	try {
		body = await response.json();
	} catch {
		body = undefined;
	}
	return { status: response.status, body };
}

function waitForExit(child) {
	return new Promise((resolvePromise, reject) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			resolvePromise({ code: child.exitCode, signal: child.signalCode });
			return;
		}
		child.once("error", reject);
		child.once("exit", (code, signal) => resolvePromise({ code, signal }));
	});
}
