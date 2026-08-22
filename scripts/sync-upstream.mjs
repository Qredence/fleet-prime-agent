#!/usr/bin/env node

/**
 * Sync the vendored upstream engine (packages/, prime-agent-runtime/) with the
 * release pinned in the root UPSTREAM manifest.
 *
 *   node scripts/sync-upstream.mjs --verify          fail if vendored dirs differ from the pinned tag
 *   node scripts/sync-upstream.mjs --report <tag>    list upstream changes between the pinned tag and <tag>
 *   node scripts/sync-upstream.mjs --apply <tag>     vendored dirs := <tag>, update the manifest
 *
 * Vendored dirs must stay byte-identical to upstream; all fleet code lives in
 * web/, scripts/, and other root-level files.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "UPSTREAM");

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

function git(args, options = {}) {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", ...options }).trim();
}

function readManifest() {
	try {
		return JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch (error) {
		fail(`cannot parse UPSTREAM manifest: ${error.message}`);
	}
}

/** Fetch the tag from repoUrl; returns null on success, otherwise git's stderr. */
function fetchTag(manifest, tag, extraArgs = []) {
	try {
		git([...extraArgs, "fetch", "--quiet", "--no-tags", manifest.repoUrl, "tag", tag]);
		return null;
	} catch (error) {
		return error.stderr ? String(error.stderr).trim() : String(error);
	}
}

/** Make sure the tag commit object exists locally; fetch it from repoUrl if not. */
function ensureTag(manifest, tag) {
	try {
		git(["rev-parse", "--verify", `${tag}^{commit}`]);
	} catch {
		// CI runners may inject credentials (http.extraheader / credential
		// helper); retry with both disabled, the upstream repo is public.
		let stderr = fetchTag(manifest, tag);
		if (stderr) {
			stderr = fetchTag(manifest, tag, ["-c", "http.extraheader=", "-c", "credential.helper="]);
		}
		if (stderr) {
			fail(`tag ${tag} is not available locally and fetching it failed:\n${stderr}`);
		}
	}
	return git(["rev-parse", `${tag}^{commit}`]);
}

/** Paths where the index/worktree differs from the tag, plus untracked files. */
function vendoredDrift(manifest, tag) {
	const diffOutput = git(["diff", "--name-only", "--no-renames", `${tag}`, "--", ...manifest.vendoredPaths], {
		maxBuffer: 64 * 1024 * 1024,
	});
	const untrackedOutput = git(
		["ls-files", "--others", "--exclude-standard", "--", ...manifest.vendoredPaths],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	return {
		changed: diffOutput ? diffOutput.split("\n") : [],
		untracked: untrackedOutput ? untrackedOutput.split("\n") : [],
	};
}

function verify(manifest) {
	const tagSha = ensureTag(manifest, manifest.tag);
	if (tagSha !== manifest.sha) {
		fail(`tag ${manifest.tag} resolves to ${tagSha}, but UPSTREAM pins ${manifest.sha}; is this the same release?`);
	}
	const drift = vendoredDrift(manifest, manifest.tag);
	// Build-regenerated files (e.g. CI runs packages/ai generate-models before
	// checks) drift legitimately; they are reset to tag bytes on every --apply.
	const generated = new Set(manifest.generatedPaths ?? []);
	const regenerated = drift.changed.filter((path) => generated.has(path));
	drift.changed = drift.changed.filter((path) => !generated.has(path));
	if (regenerated.length > 0) {
		for (const path of regenerated) console.log(`  ignored (build-regenerated): ${path}`);
	}
	if (drift.changed.length === 0 && drift.untracked.length === 0) {
		console.log(`Vendored engine matches upstream ${manifest.tag}.`);
		return;
	}
	for (const path of drift.changed) console.error(`  drifted: ${path}`);
	for (const path of drift.untracked) console.error(`  untracked: ${path}`);
	fail(
		`${drift.changed.length + drift.untracked.length} vendored path(s) differ from upstream ${manifest.tag}. ` +
			"Vendored dirs are verbatim upstream: revert the local change, or sync with --apply.",
	);
}

function report(manifest, newTag) {
	const oldSha = ensureTag(manifest, manifest.tag);
	const newSha = ensureTag(manifest, newTag);
	const summary = git(
		["diff", "--stat", oldSha, newSha, "--", ...manifest.vendoredPaths, "packages/coding-agent/src/index.ts"],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	console.log(summary || "(no vendored changes)");
	console.log("\n--- adapter-consumed public surface (src/index.ts exports) ---");
	for (const pkg of ["ai", "agent", "coding-agent", "tui"]) {
		const path = `packages/${pkg}/src/index.ts`;
		const diff = git(["diff", oldSha, newSha, "--", path], { maxBuffer: 64 * 1024 * 1024 });
		if (diff) console.log(`\n## ${path}\n${diff}`);
	}
	console.log("\n--- daemon protocol constants ---");
	const protocol = git(
		["diff", oldSha, newSha, "--", "packages/coding-agent/src/modes/daemon/daemon-protocol.ts"],
		{ maxBuffer: 64 * 1024 * 1024 },
	).split("\n").filter((line) => /DAEMON_(PROTOCOL_VERSION|SCHEMA_REVISION)/.test(line));
	console.log(protocol.length > 0 ? protocol.join("\n") : "(unchanged)");
}

function apply(manifest, newTag) {
	const newSha = ensureTag(manifest, newTag);
	// Overlay tag content.
	git(["checkout", newSha, "--", ...manifest.vendoredPaths]);
	// Remove files that exist locally but not in the tag (fork leftovers).
	const leftovers = git(
		["diff", "--name-only", "--diff-filter=A", "--no-renames", newSha, "--", ...manifest.vendoredPaths],
		{ maxBuffer: 64 * 1024 * 1024 },
	);
	if (leftovers) {
		git(["rm", "-q", "--", ...leftovers.split("\n")]);
	}
	const oldTag = manifest.tag;
	const next = { ...manifest, tag: newTag, sha: newSha };
	writeFileSync(manifestPath, `${JSON.stringify(next, null, "\t")}\n`);
	console.log(`Vendored engine: ${oldTag} -> ${newTag} (${newSha.slice(0, 12)}).`);
	console.log("Next: npm install && npm run check, then review the adapter contract doc.");
}

const manifest = readManifest();
const [flag, arg] = process.argv.slice(2);
if (flag === "--verify" && !arg) {
	verify(manifest);
} else if (flag === "--report" && arg) {
	report(manifest, arg);
} else if (flag === "--apply" && arg) {
	apply(manifest, arg);
} else {
	console.error("Usage: node scripts/sync-upstream.mjs --verify | --report <tag> | --apply <tag>");
	process.exit(1);
}
