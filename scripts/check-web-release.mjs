#!/usr/bin/env node

// Smoke-tests a packed @qredence/fleet-prime release tarball: installs it into a
// temporary npm prefix, boots the bundled web runtime, and verifies the HTTP
// surface (/, /api/health, /api/workspace/tree, one client asset).

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const fleetPrimeDir = join(root, "packages", "fleet-prime");
const STARTUP_TIMEOUT_MS = 60000;
const FETCH_TIMEOUT_MS = 5000;

function printUsage() {
	console.log("Usage: node scripts/check-web-release.mjs [--package path/to/qredence-fleet-prime-*.tgz]");
	console.log("");
	console.log("Without --package, packs packages/fleet-prime into a temporary directory first.");
	console.log("Requires a built web runtime: pnpm run build:web:release");
}

function parseArgs(argv) {
	let packagePath;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--package") {
			const value = argv[index + 1];
			if (!value || value.startsWith("-")) {
				throw new Error("--package requires a tarball path");
			}
			index += 1;
			packagePath = resolve(value);
			continue;
		}
		if (arg.startsWith("--package=")) {
			packagePath = resolve(arg.slice("--package=".length));
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		}
		throw new Error(`Unknown option: ${arg}`);
	}
	return { packagePath };
}

function findExistingTarball() {
	const candidates = readdirSync(root)
		.filter((entry) => entry.startsWith("qredence-fleet-prime-") && entry.endsWith(".tgz"))
		.sort();
	if (candidates.length === 0) return undefined;
	return join(root, candidates[candidates.length - 1]);
}

function packToTemp(tempDir) {
	const launcher = join(fleetPrimeDir, "dist", "web", "launcher.mjs");
	if (!existsSync(launcher)) {
		throw new Error(`Missing ${launcher}. Run pnpm run build:web:release before packing.`);
	}
	execFileSync("pnpm", ["--dir", "packages/fleet-prime", "pack", "--pack-destination", tempDir], {
		cwd: root,
		stdio: "inherit",
	});
	const packed = readdirSync(tempDir)
		.filter((entry) => entry.startsWith("qredence-fleet-prime-") && entry.endsWith(".tgz"))
		.sort();
	if (packed.length === 0) {
		throw new Error("pnpm pack did not produce a qredence-fleet-prime tarball");
	}
	return join(tempDir, packed[packed.length - 1]);
}

function findClientJsAsset(clientDir) {
	const queue = [clientDir];
	while (queue.length > 0) {
		const dir = queue.shift();
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const entryPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				queue.push(entryPath);
			} else if (entry.isFile() && entry.name.endsWith(".js")) {
				return relative(clientDir, entryPath).split(sep).join("/");
			}
		}
	}
	return undefined;
}

function installTarball(tarball, prefix) {
	execFileSync("npm", ["install", "--global", "--no-fund", "--no-audit", tarball], {
		stdio: "inherit",
		env: { ...process.env, NPM_CONFIG_PREFIX: prefix, npm_config_prefix: prefix },
	});
	const globalRoot = execFileSync("npm", ["root", "-g"], {
		encoding: "utf8",
		env: { ...process.env, NPM_CONFIG_PREFIX: prefix, npm_config_prefix: prefix },
	}).trim();
	const installedPackage = join(globalRoot, "@qredence", "fleet-prime");
	if (!existsSync(installedPackage)) {
		throw new Error(`Expected installed package at ${installedPackage}`);
	}
	return installedPackage;
}

function assertFile(path, description) {
	if (!existsSync(path)) {
		throw new Error(`Missing ${description}: ${path}`);
	}
}

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function getJson(url) {
	const response = await fetchWithTimeout(url);
	if (!response.ok) {
		throw new Error(`GET ${url} -> HTTP ${response.status}`);
	}
	return response.json();
}

function startServer(launcherBin, workspace) {
	const server = spawn(process.execPath, [launcherBin, "--host", "127.0.0.1", "--port", "0"], {
		cwd: workspace,
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});
	server.output = "";
	server.urlPromise = new Promise((resolvePromise, rejectPromise) => {
		const timer = setTimeout(() => {
			rejectPromise(
				new Error(
					`Fleet Prime interface did not start within ${STARTUP_TIMEOUT_MS}ms. Output:\n${server.output}`,
				),
			);
		}, STARTUP_TIMEOUT_MS);
		server.on("error", (error) => {
			clearTimeout(timer);
			rejectPromise(error);
		});
		server.on("exit", (code, signal) => {
			clearTimeout(timer);
			rejectPromise(new Error(`Fleet Prime interface exited early (${code ?? signal}). Output:\n${server.output}`));
		});
		const handleData = (chunk) => {
			server.output += chunk;
			const match = server.output.match(/Fleet Prime interface: (http:\/\/\S+)/);
			if (match) {
				clearTimeout(timer);
				resolvePromise(match[1]);
			}
		};
		server.stdout.on("data", handleData);
		server.stderr.on("data", handleData);
	});
	return server;
}

async function checkWebRuntime(baseUrl, workspace, installedPackage) {
	const pageResponse = await fetchWithTimeout(baseUrl);
	if (pageResponse.status !== 200) {
		throw new Error(`GET ${baseUrl} -> HTTP ${pageResponse.status}`);
	}

	const health = await getJson(`${baseUrl}/api/health`);
	if (health.ok !== true) {
		throw new Error(`Health endpoint returned ${JSON.stringify(health)}`);
	}

	const tree = await getJson(`${baseUrl}/api/workspace/tree`);
	// /api/workspace/tree returns a display label (safePathLabel), not a
	// canonical path: short roots come back verbatim, longer ones as
	// `…/<parent>/<basename>`. Match the label like the source-installer
	// smoke does instead of realpath-ing it.
	const labelSuffix = `${basename(dirname(workspace))}${sep}${basename(workspace)}`;
	const reportedRoot = typeof tree?.root === "string" ? tree.root : "";
	if (reportedRoot !== workspace && !reportedRoot.endsWith(labelSuffix)) {
		throw new Error(`Workspace tree root mismatch: ${reportedRoot} != ${workspace}`);
	}

	const clientDir = join(installedPackage, "dist", "web", "client");
	const assetPath = findClientJsAsset(clientDir);
	if (!assetPath) {
		throw new Error(`No client JS asset found in ${clientDir}`);
	}
	const assetResponse = await fetchWithTimeout(`${baseUrl}/${assetPath}`);
	if (assetResponse.status !== 200) {
		throw new Error(`GET ${baseUrl}/${assetPath} -> HTTP ${assetResponse.status}`);
	}
}

async function main() {
	const { packagePath: requestedPackage } = parseArgs(process.argv.slice(2));
	const packDir = mkdtempSync(join(tmpdir(), "fleet-prime-pack-"));
	const prefix = mkdtempSync(join(tmpdir(), "fleet-prime-prefix-"));
	const workspace = mkdtempSync(join(tmpdir(), "fleet-prime-workspace-"));
	let server;
	try {
		let tarball = requestedPackage;
		if (!tarball) {
			tarball = findExistingTarball() ?? packToTemp(packDir);
		}
		if (!existsSync(tarball)) {
			throw new Error(`Tarball not found: ${tarball}`);
		}
		console.log(`Smoke-testing ${tarball}`);

		const installedPackage = installTarball(tarball, prefix);
		for (const binName of ["fleet-prime", "fleet-agent"]) {
			assertFile(join(prefix, "bin", binName), `installed bin/${binName}`);
		}
		assertFile(join(installedPackage, "dist", "web", "launcher.mjs"), "packaged web launcher");
		assertFile(join(installedPackage, "dist", "web", "server", "server.js"), "packaged web server bundle");

		const launcherBin = join(prefix, "bin", "fleet-prime");
		server = startServer(launcherBin, workspace);
		const baseUrl = await server.urlPromise;
		await checkWebRuntime(baseUrl, workspace, installedPackage);

		const stopped = new Promise((resolvePromise) => {
			server.once("exit", (code, signal) => resolvePromise({ code, signal }));
		});
		server.kill("SIGTERM");
		const { code, signal } = await stopped;
		if (signal !== "SIGTERM" && code !== 143) {
			throw new Error(`Fleet Prime interface did not shut down cleanly (code=${code}, signal=${signal})`);
		}
		if (/ERR_MODULE_NOT_FOUND|Cannot find package/.test(server.output)) {
			throw new Error(`Fleet Prime interface reported missing modules:\n${server.output}`);
		}
		console.log("Web release smoke test passed.");
	} finally {
		if (server && server.exitCode === null) {
			server.kill("SIGKILL");
		}
		for (const dir of [packDir, prefix, workspace]) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
