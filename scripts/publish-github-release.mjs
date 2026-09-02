#!/usr/bin/env node

// Publishes the GitHub release for a Fleet release from the CircleCI release
// job: creates the release for the pushed tag (reusing it on re-runs) and
// uploads the packed tarball plus SHA256SUMS. Requires GITHUB_TOKEN,
// RELEASE_VERSION, and CIRCLE_SHA1 from the CircleCI environment; the
// repository is read from the launcher package's repository.url.

import { readFileSync } from "node:fs";

const API_BASE = "https://api.github.com";
const REQUIRED_ENV = ["GITHUB_TOKEN", "RELEASE_VERSION", "CIRCLE_SHA1"];

/**
 * Wraps fetch with the GitHub API headers and consistent error reporting.
 * @param {string} path - GitHub API path or absolute URL.
 * @param {string} token - GitHub token with contents write access.
 * @param {RequestInit} [options] - Fetch options; `body` may be a Buffer.
 * @returns {Promise<Response>} The GitHub API response.
 */
async function githubFetch(path, token, options = {}) {
	const response = await fetch(path.startsWith("http") ? path : `${API_BASE}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...(options.headers ?? {}),
		},
	});
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`GitHub API ${path} -> HTTP ${response.status}: ${detail}`);
	}
	return response;
}

/**
 * Resolves a lightweight or annotated Git tag to its commit SHA.
 * @param {string} token - GitHub token with contents read access.
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {string} tag - Tag name without refs/tags/.
 * @returns {Promise<string>} The commit SHA targeted by the tag.
 */
async function resolveTagCommit(token, owner, repo, tag) {
	const refResponse = await githubFetch(`/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, token);
	let object = (await refResponse.json()).object;
	for (let depth = 0; depth < 3; depth += 1) {
		if (object?.type === "commit") return object.sha;
		if (object?.type !== "tag" || !object.sha) {
			throw new Error(`GitHub tag v${tag.replace(/^v/, "")} does not resolve to a commit`);
		}
		const tagResponse = await githubFetch(`/repos/${owner}/${repo}/git/tags/${object.sha}`, token);
		object = (await tagResponse.json()).object;
	}
	throw new Error(`GitHub tag ${tag} contains too many annotated-tag indirections`);
}

/**
 * Ensures the release tag points at the CircleCI commit that produced the
 * already-verified npm artifact.
 */
async function assertTagTarget(token, owner, repo, tag, expectedSha) {
	const actualSha = await resolveTagCommit(token, owner, repo, tag);
	if (actualSha !== expectedSha) {
		throw new Error(`GitHub tag ${tag} points to ${actualSha}; expected CircleCI commit ${expectedSha}`);
	}
}

/**
 * Builds the release notes shown on the GitHub release page.
 * @param {string} version - The release version without the leading v.
 * @returns {string} Markdown release notes.
 */
function releaseNotes(version) {
	return [
		`Fleet Prime release ${version}.`,
		"",
		"Artifacts:",
		"",
		`- qredence-fleet-${version}.tgz: packed @qredence/fleet launcher package`,
		"- SHA256SUMS: checksum for the packed tarball",
		"",
		"The package is also published to npm as @qredence/fleet via npm trusted",
		"publishing from CircleCI (no provenance attestations; CircleCI trusted",
		"publishing does not support them yet).",
		"",
		"The upstream Prime Agent runtime is consumed as the stock tarball pinned in PRIME_AGENT_RUNTIME.json.",
		"Verify the checksum before installing the artifact.",
	].join("\n");
}

/**
 * Finds the existing release for the tag, or creates it when missing.
 * @param {string} token - GitHub token with contents write access.
 * @param {string} version - The release version without the leading v.
 * @param {string} owner - Repository owner.
 * @param {string} repo - Repository name.
 * @param {string} sha - The tagged commit (CIRCLE_SHA1).
 * @returns {Promise<{id: number, uploadUrl: string, assets: Array<{id: number, name: string}>}>} The release.
 */
async function findOrCreateRelease(token, version, owner, repo, sha) {
	const tag = `v${version}`;
	const lookup = await fetch(`${API_BASE}/repos/${owner}/${repo}/releases/tags/${tag}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (lookup.ok) {
		const existing = await lookup.json();
		await assertTagTarget(token, owner, repo, tag, sha);
		return {
			id: existing.id,
			uploadUrl: existing.upload_url,
			assets: existing.assets.map((asset) => ({ id: asset.id, name: asset.name })),
		};
	}
	if (lookup.status !== 404) {
		throw new Error(`GitHub release lookup for ${tag} -> HTTP ${lookup.status}: ${await lookup.text()}`);
	}
	const tagLookup = await fetch(`${API_BASE}/repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (tagLookup.ok) {
		await assertTagTarget(token, owner, repo, tag, sha);
	} else if (tagLookup.status !== 404) {
		throw new Error(`GitHub tag lookup for ${tag} -> HTTP ${tagLookup.status}: ${await tagLookup.text()}`);
	}
	const created = await githubFetch(`/repos/${owner}/${repo}/releases`, token, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			tag_name: tag,
			target_commitish: sha,
			name: `Fleet Prime v${version}`,
			body: releaseNotes(version),
			prerelease: version.includes("-"),
		}),
	});
	const release = await created.json();
	await assertTagTarget(token, owner, repo, tag, sha);
	return {
		id: release.id,
		uploadUrl: release.upload_url,
		assets: [],
	};
}

/**
 * Uploads one release asset, replacing any same-named asset from a prior run.
 * @param {string} token - GitHub token with contents write access.
 * @param {{id: number, uploadUrl: string, assets: Array<{id: number, name: string}>}} release - The release to attach the asset to.
 * @param {string} name - The asset file name.
 * @param {string} path - Path to the asset file inside dist-release.
 */
async function uploadAsset(token, release, name, path) {
	const existing = release.assets.find((asset) => asset.name === name);
	if (existing) {
		await githubFetch(`/releases/assets/${existing.id}`, token, { method: "DELETE" });
	}
	const uploadBase = release.uploadUrl.replace(/\{.*\}/, "");
	const body = readFileSync(path);
	const uploaded = await githubFetch(`${uploadBase}?name=${encodeURIComponent(name)}`, token, {
		method: "POST",
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Length": body.length,
		},
		body,
	});
	const asset = await uploaded.json();
	console.log(`Uploaded ${asset.name} (${asset.size} bytes) to the release.`);
}

/**
 * Resolves the owner/repo pair for this repository from the launcher
 * package's repository.url, so the script does not depend on the VCS-derived
 * CircleCI environment variables.
 * @returns {{owner: string, repo: string}} The GitHub repository coordinates.
 * @throws {Error} If repository.url is missing or not a GitHub URL.
 */
function readRepository() {
	const manifest = JSON.parse(readFileSync("packages/fleet-prime/package.json", "utf8"));
	const url = manifest?.repository?.url ?? "";
	const match = url.match(/github\.com[/:]([^/#?]+)\/([^/#?.]+)/);
	if (!match) {
		throw new Error(`Cannot derive the GitHub repository from repository.url: ${url}`);
	}
	return { owner: match[1], repo: match[2] };
}

async function main() {
	for (const name of REQUIRED_ENV) {
		if (!process.env[name]) {
			throw new Error(`Missing environment variable ${name}.`);
		}
	}
	const token = process.env.GITHUB_TOKEN;
	const version = process.env.RELEASE_VERSION;
	const { owner, repo } = readRepository();
	const sha = process.env.CIRCLE_SHA1;

	const release = await findOrCreateRelease(token, version, owner, repo, sha);
	const artifactPath = process.env.RELEASE_ARTIFACT ?? `dist-release/qredence-fleet-${version}.tgz`;
	const checksumsPath = process.env.RELEASE_CHECKSUMS ?? "dist-release/SHA256SUMS";
	await uploadAsset(token, release, `qredence-fleet-${version}.tgz`, artifactPath);
	await uploadAsset(token, release, "SHA256SUMS", checksumsPath);
	console.log(`GitHub release v${version} published with the release artifacts.`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
