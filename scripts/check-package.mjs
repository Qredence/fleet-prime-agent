#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pnpmInvocation } from "./pnpm-command.mjs";
import { NPM_REGISTRY, parseStableVersion } from "./release-utils.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageRoot = join(root, "packages", "fleet-prime");
const packageManifestPath = join(packageRoot, "package.json");
const REQUIRED_BINS = {
	"fleet-agent": "bin/fleet-prime.mjs",
	"fleet-prime": "bin/fleet-prime.mjs",
};
const ALLOWED_PACKAGE_ROOTS = ["bin/", "dist/"];
const ALLOWED_PACKAGE_FILES = new Set(["package.json", "README.md", "CHANGELOG.md", "LICENSE"]);
const EXPECTED_FILES = ["bin", "dist", "CHANGELOG.md", "LICENSE", "README.md"];

function parseArgs(argv) {
	let packagePath;
	let outputDirectory;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--package") {
			const value = argv[++index];
			if (!value || value.startsWith("-")) throw new Error("--package requires a tarball path");
			packagePath = resolve(value);
			continue;
		}
		if (arg.startsWith("--package=")) {
			packagePath = resolve(arg.slice("--package=".length));
			continue;
		}
		if (arg === "--out-dir") {
			const value = argv[++index];
			if (!value || value.startsWith("-")) throw new Error("--out-dir requires a directory path");
			outputDirectory = resolve(value);
			continue;
		}
		if (arg.startsWith("--out-dir=")) {
			outputDirectory = resolve(arg.slice("--out-dir=".length));
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log("Usage: node scripts/check-package.mjs [--package path] [--out-dir directory]");
			process.exit(0);
		}
		throw new Error(`Unknown option: ${arg}`);
	}
	return { packagePath, outputDirectory };
}

function readManifest({ requireGeneratedBuild = true } = {}) {
	const manifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
	if (manifest.name !== "@qredence/fleet") throw new Error(`Unexpected package name: ${manifest.name}`);
	parseStableVersion(manifest.version);
	if (JSON.stringify(Object.keys(manifest.bin ?? {}).sort()) !== JSON.stringify(Object.keys(REQUIRED_BINS).sort())) {
		throw new Error(`Unexpected public bins: ${Object.keys(manifest.bin ?? {}).join(", ")}`);
	}
	for (const [name, path] of Object.entries(REQUIRED_BINS)) {
		if (manifest.bin?.[name] !== path) throw new Error(`Unexpected ${name} bin path: ${manifest.bin?.[name]}`);
	}
	if (manifest.private === true) throw new Error("The public Fleet package must not be private");
	if (manifest.publishConfig?.access !== "public") throw new Error("Fleet must publish with public access");
	if (manifest.publishConfig?.registry !== NPM_REGISTRY) {
		throw new Error(`Fleet must publish only to ${NPM_REGISTRY}`);
	}
	if (
		!Array.isArray(manifest.files) ||
		JSON.stringify([...manifest.files].sort()) !== JSON.stringify([...EXPECTED_FILES].sort())
	) {
		throw new Error(`Unexpected package files allowlist: ${JSON.stringify(manifest.files)}`);
	}
	if (!Array.isArray(manifest.os) || JSON.stringify([...manifest.os].sort()) !== JSON.stringify(["darwin", "linux"])) {
		throw new Error(`Fleet must explicitly support only darwin and linux: ${JSON.stringify(manifest.os)}`);
	}
	if (requireGeneratedBuild && !existsSync(join(packageRoot, "dist", "web", "launcher.mjs"))) {
		throw new Error("Missing generated dist/web/launcher.mjs; build the release runtime first");
	}
	return manifest;
}

function packPackage(destination) {
	const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], {
		cwd: packageRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});
	const packed = JSON.parse(output)[0];
	const expectedName = packed.filename;
	const tarball = join(destination, expectedName);
	if (!existsSync(tarball)) {
		throw new Error(`npm pack did not produce ${expectedName}. Output:\n${output}`);
	}
	return tarball;
}

export function assertAllowedPath(path) {
	if (!ALLOWED_PACKAGE_FILES.has(path) && !ALLOWED_PACKAGE_ROOTS.some((prefix) => path.startsWith(prefix))) {
		throw new Error(`Unexpected file in npm package: ${path}`);
	}
	if (/(^|\/)(node_modules|src|test|tests|\.git)(\/|$)|\.(test|spec)\.[^/]+$|\.map$/.test(path)) {
		throw new Error(`Development file leaked into npm package: ${path}`);
	}
}

function inspectDryRun(manifest) {
	const output = execFileSync("npm", ["pack", "--json", "--dry-run", "--ignore-scripts"], {
		cwd: packageRoot,
		encoding: "utf8",
	});
	const result = JSON.parse(output)[0];
	if (result.name !== manifest.name || result.version !== manifest.version) {
		throw new Error(`Pack metadata mismatch: ${JSON.stringify({ name: result.name, version: result.version })}`);
	}
	for (const entry of result.files ?? []) {
		const path = entry.path.replace(/^package\//, "");
		assertAllowedPath(path);
	}
	console.log(`Package dry-run passed: ${result.files?.length ?? 0} files, ${result.unpackedSize} bytes unpacked.`);
}

function inspectTarball(tarball, manifest) {
	const entries = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((entry) => entry.replace(/^package\//, ""));
	for (const path of entries) {
		if (path.endsWith("/")) continue;
		assertAllowedPath(path);
	}
	const packedManifest = JSON.parse(
		execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }),
	);
	if (
		packedManifest.name !== manifest.name ||
		packedManifest.version !== manifest.version ||
		JSON.stringify(packedManifest.bin ?? {}) !== JSON.stringify(manifest.bin ?? {}) ||
		JSON.stringify([...(packedManifest.os ?? [])].sort()) !== JSON.stringify([...(manifest.os ?? [])].sort()) ||
		packedManifest.publishConfig?.access !== "public" ||
		packedManifest.publishConfig?.registry !== NPM_REGISTRY
	) {
		throw new Error("Tarball package.json does not match the source manifest");
	}
	const checksum = createHash("sha256").update(readFileSync(tarball)).digest("hex");
	console.log(`Packed ${basename(tarball)} (${checksum})`);
}

function runSmoke(tarball) {
	execFileSync(process.execPath, [join(root, "scripts", "check-web-release.mjs"), "--package", tarball], {
		cwd: root,
		stdio: "inherit",
	});
}

function main() {
	const { packagePath: requestedPackage, outputDirectory } = parseArgs(process.argv.slice(2));
	const temporaryDirectory = mkdtempSync(join(tmpdir(), "fleet-package-check-"));
	const destination = outputDirectory ?? temporaryDirectory;
	try {
		mkdirSync(destination, { recursive: true });
		if (!requestedPackage) {
			const pnpm = pnpmInvocation(["run", "build:web:release"]);
			execFileSync(pnpm.command, pnpm.args, { cwd: root, stdio: "inherit" });
		}
		const manifest = readManifest({ requireGeneratedBuild: !requestedPackage });
		inspectDryRun(manifest);
		const tarball = requestedPackage ?? packPackage(destination);
		if (!existsSync(tarball)) throw new Error(`Package tarball not found: ${tarball}`);
		inspectTarball(tarball, manifest);
		runSmoke(tarball);
		console.log(`Package verification passed for ${manifest.name}@${manifest.version}.`);
	} finally {
		if (!outputDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main();
}
