#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultPackageDir = join(root, "packages", "coding-agent", "release", "packages", "coding-agent");
const defaultArtifactsDir = join(root, "packages", "coding-agent", "release", "artifacts");

const args = parseArgs(process.argv.slice(2));
const packageDir = resolve(args.packageDir || defaultPackageDir);
const artifactsDir = resolve(args.artifactsDir || defaultArtifactsDir);
if (!existsSync(join(packageDir, "package.json"))) throw new Error(`Missing release package: ${packageDir}`);
if (!existsSync(artifactsDir)) throw new Error(`Missing release artifacts: ${artifactsDir}`);
verifyArtifactChecksums(artifactsDir);

const tempRoot = mkdtempSync(join(tmpdir(), "fleet-prime-web-release-"));
const packageCopy = join(tempRoot, "package");
const installRoot = join(tempRoot, "install");
const localArtifactsDir = join(tempRoot, "local-artifacts");
const workspaceRoot = join(tempRoot, "workspace");
const agentDir = join(tempRoot, "agent");
cpSync(packageDir, packageCopy, { recursive: true });
mkdirSync(localArtifactsDir, { recursive: true });
mkdirSync(workspaceRoot, { recursive: true });
assertPackagedWebLayout(packageCopy);

try {
	const localArtifacts = createLocalSupportArtifacts(packageDir, localArtifactsDir);
	const manifestPath = join(packageCopy, "package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	rewriteLocalDependencies(manifest.dependencies, localArtifacts);
	rewriteLocalDependencies(manifest.optionalDependencies, localArtifacts);
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	const packedName = execFileSync("npm", ["pack", packageCopy, "--pack-destination", tempRoot, "--silent"], {
		cwd: root,
		encoding: "utf8",
	})
		.trim()
		.split("\n")
		.at(-1);
	if (!packedName) throw new Error("npm pack did not report the public release artifact");
	const packageArchive = join(tempRoot, basename(packedName));

	execFileSync(
		"npm",
		[
			"install",
			"--global",
			"--prefix",
			installRoot,
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
			packageArchive,
		],
		{ cwd: root, stdio: "inherit" },
	);

	const executable = [join(installRoot, "bin", "fleet-prime"), join(installRoot, "node_modules", ".bin", "fleet-prime")].find(
		(path) => existsSync(path),
	);
	if (!executable) throw new Error(`Installed Fleet Prime launcher was not linked under ${installRoot}`);
	const installedPackageDir = [
		join(installRoot, "lib", "node_modules", "prime-agent"),
		join(installRoot, "node_modules", "prime-agent"),
	].find((path) => existsSync(join(path, "package.json")));
	if (!installedPackageDir) throw new Error(`Installed package was not found under ${installRoot}`);
	if (existsSync(join(installedPackageDir, "web", "node_modules"))) {
		throw new Error("Installed release unexpectedly depends on web/node_modules");
	}
	const asset = findFirstJavaScriptAsset(join(packageCopy, "dist", "web", "client", "assets"));
	if (!asset) throw new Error("Packaged web release contains no client JavaScript asset");

	const child = spawn(
		executable,
		["--host", "127.0.0.1", "--port", "0"],
		{
			cwd: workspaceRoot,
			env: { ...process.env, PRIME_AGENT_CODING_AGENT_DIR: agentDir },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	const output = collectOutput(child);
	try {
		const url = await waitForUrl(output);
		await assertResponse(`${url}/`, 200, "root page");
		const health = await fetchJson(`${url}/api/health`);
		if (health.status !== 200 || health.body.ok !== true) {
			throw new Error(`Health check failed: HTTP ${health.status} ${JSON.stringify(health.body)}`);
		}
		const workspace = await fetchJson(`${url}/api/workspace/tree`);
		const workspaceLabelSuffix = `${basename(dirname(workspaceRoot))}${sep}${basename(workspaceRoot)}`;
		const workspaceMatches =
			typeof workspace.body.root === "string" &&
			(workspace.body.root === workspaceRoot || workspace.body.root.endsWith(workspaceLabelSuffix));
		if (workspace.status !== 200 || !workspaceMatches) {
			throw new Error(`Workspace check failed: expected ${workspaceRoot}, got ${JSON.stringify(workspace.body)}`);
		}
		const assetPath = relative(join(packageCopy, "dist", "web", "client"), asset).split(sep).join("/");
		await assertResponse(`${url}/${assetPath}`, 200, "client asset");
		if (output.stderr.includes("Named export 'Parser' not found") || output.stderr.includes("parse5")) {
			throw new Error(`Production SSR emitted a parse5/module interop error:\n${output.stderr}`);
		}
		console.log("Packaged web release smoke check passed.");
	} finally {
		child.kill("SIGTERM");
		await output.done;
	}
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

function parseArgs(values) {
	const parsed = {};
	for (let index = 0; index < values.length; index += 1) {
		const arg = values[index];
		if (arg === "--package-dir" || arg === "--artifacts-dir") {
			const value = values[index + 1];
			if (!value) throw new Error(`${arg} requires a value`);
			parsed[arg === "--package-dir" ? "packageDir" : "artifactsDir"] = value;
			index += 1;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log("Usage: node scripts/check-web-release.mjs [--package-dir path] [--artifacts-dir path]");
			process.exit(0);
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return parsed;
}

function createLocalSupportArtifacts(publicPackageDir, localArtifactsDir) {
	const stagingRoot = resolve(publicPackageDir, "..");
	const supportPackages = [
		["ai", "prime-agent-ai"],
		["tui", "prime-agent-tui"],
		["agent", "prime-agent-core"],
	];
	const localArtifacts = new Map();
	for (const [directory, artifactPrefix] of supportPackages) {
		const sourceDir = join(stagingRoot, directory);
		if (!existsSync(join(sourceDir, "package.json"))) {
			throw new Error(`Missing staged support package: ${sourceDir}`);
		}
		const manifest = JSON.parse(readFileSync(join(sourceDir, "package.json"), "utf8"));
		const artifactName = readdirSync(resolve(artifactsDir), { withFileTypes: true })
			.find((entry) => entry.isFile() && entry.name.startsWith(`${artifactPrefix}-`) && entry.name.endsWith(".tgz"))?.name;
		if (!artifactName) throw new Error(`Missing support artifact for ${manifest.name}`);
		localArtifacts.set(artifactName, join(localArtifactsDir, artifactName));
	}

	for (const [directory, artifactPrefix] of supportPackages) {
		const sourceDir = join(stagingRoot, directory);
		const localDir = join(localArtifactsDir, `${directory}-package`);
		cpSync(sourceDir, localDir, { recursive: true });
		const manifestPath = join(localDir, "package.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		rewriteLocalDependencies(manifest.dependencies, localArtifacts);
		rewriteLocalDependencies(manifest.optionalDependencies, localArtifacts);
		writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		const packedName = execFileSync("npm", ["pack", localDir, "--pack-destination", localArtifactsDir, "--silent"], {
			cwd: root,
			encoding: "utf8",
		})
			.trim()
			.split("\n")
			.at(-1);
		if (!packedName) throw new Error(`npm pack did not report a local artifact for ${manifest.name}`);
		const artifactName = [...localArtifacts.keys()].find((name) => name.startsWith(`${artifactPrefix}-`));
		const expectedPath = artifactName ? localArtifacts.get(artifactName) : undefined;
		if (!expectedPath) throw new Error(`Could not determine local artifact path for ${manifest.name}`);
		renameSync(join(localArtifactsDir, basename(packedName)), expectedPath);
	}

	return localArtifacts;
}

function rewriteLocalDependencies(dependencies, localArtifacts) {
	if (!dependencies) return;
	for (const [name, value] of Object.entries(dependencies)) {
		if (typeof value !== "string" || !value.startsWith("http")) continue;
		const file = basename(new URL(value).pathname);
		const localPath = localArtifacts.get(file);
		if (localPath) dependencies[name] = `file:${localPath}`;
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

function collectOutput(child) {
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk) => {
		stdout += chunk.toString();
		process.stdout.write(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		stderr += chunk.toString();
		process.stderr.write(chunk);
	});
	const done = new Promise((resolvePromise, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (signal === "SIGTERM" || code === 0 || code === 143) resolvePromise();
			else reject(new Error(`Packaged web CLI exited with ${signal || code}\n${stderr}`));
		});
	});
	return { get stdout() { return stdout; }, get stderr() { return stderr; }, done };
}

async function waitForUrl(output) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const match = output.stdout.match(/Fleet Prime interface: (http:\/\/[^\s]+)/);
		if (match) return match[1];
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
	}
	throw new Error(`Timed out waiting for web server startup. Output:\n${output.stdout}\n${output.stderr}`);
}

function verifyArtifactChecksums(directory) {
	const checksumPath = join(directory, "SHA256SUMS");
	if (!existsSync(checksumPath)) throw new Error(`Missing checksum manifest: ${checksumPath}`);
	for (const line of readFileSync(checksumPath, "utf8").trim().split("\n")) {
		const match = /^(\S+)\s{2}(\S+)$/.exec(line);
		if (!match) throw new Error(`Malformed checksum entry: ${line}`);
		const [, expected, file] = match;
		const filePath = join(directory, file);
		if (!existsSync(filePath)) throw new Error(`Checksum target is missing: ${filePath}`);
		const actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
		if (actual !== expected) throw new Error(`Checksum mismatch for ${file}: expected ${expected}, got ${actual}`);
	}
}

function assertPackagedWebLayout(directory) {
	const webRoot = join(directory, "dist", "web");
	for (const requiredPath of [join(webRoot, "launcher.mjs"), join(webRoot, "server", "server.js"), join(webRoot, "client")]) {
		if (!existsSync(requiredPath)) throw new Error(`Packaged web runtime is missing ${requiredPath}`);
	}
	if (existsSync(join(directory, "web", "node_modules"))) {
		throw new Error("Release package contains web/node_modules");
	}
}

async function assertResponse(url, expectedStatus, label) {
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
