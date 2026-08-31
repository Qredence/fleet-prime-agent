#!/usr/bin/env node

// Publishes the GitHub release for a Fleet release from the CircleCI release
// job: creates the release for the pushed tag (reusing it on re-runs) and
// uploads the packed tarball plus SHA256SUMS. Requires GITHUB_TOKEN,
// RELEASE_VERSION, CIRCLE_SHA1, CIRCLE_PROJECT_USERNAME, and
// CIRCLE_PROJECT_REPONAME from the CircleCI environment.

import { readFileSync } from "node:fs"

const API_BASE = "https://api.github.com"
const REQUIRED_ENV = [
	"GITHUB_TOKEN",
	"RELEASE_VERSION",
	"CIRCLE_SHA1",
	"CIRCLE_PROJECT_USERNAME",
	"CIRCLE_PROJECT_REPONAME",
]

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
	})
	if (!response.ok) {
		const detail = await response.text()
		throw new Error(`GitHub API ${path} -> HTTP ${response.status}: ${detail}`)
	}
	return response
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
	].join("\n")
}

/**
 * Finds the existing release for the tag, or creates it when missing.
 * @param {string} token - GitHub token with contents write access.
 * @param {string} version - The release version without the leading v.
 * @param {string} owner - Repository owner (CIRCLE_PROJECT_USERNAME).
 * @param {string} repo - Repository name (CIRCLE_PROJECT_REPONAME).
 * @param {string} sha - The tagged commit (CIRCLE_SHA1).
 * @returns {Promise<{id: number, uploadUrl: string, assets: Array<{id: number, name: string}>}>} The release.
 */
async function findOrCreateRelease(token, version, owner, repo, sha) {
	const tag = `v${version}`
	const lookup = await fetch(`${API_BASE}/repos/${owner}/${repo}/releases/tags/${tag}`, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	})
	if (lookup.ok) {
		const existing = await lookup.json()
		return {
			id: existing.id,
			uploadUrl: existing.upload_url,
			assets: existing.assets.map((asset) => ({ id: asset.id, name: asset.name })),
		}
	}
	if (lookup.status !== 404) {
		throw new Error(`GitHub release lookup for ${tag} -> HTTP ${lookup.status}: ${await lookup.text()}`)
	}
	const created = await githubFetch(`/repos/${owner}/${repo}/releases`, token, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			tag_name: tag,
			target_commitish: sha,
			name: tag,
			body: releaseNotes(version),
			prerelease: version.includes("-"),
		}),
	})
	const release = await created.json()
	return {
		id: release.id,
		uploadUrl: release.upload_url,
		assets: [],
	}
}

/**
 * Uploads one release asset, replacing any same-named asset from a prior run.
 * @param {string} token - GitHub token with contents write access.
 * @param {{id: number, uploadUrl: string, assets: Array<{id: number, name: string}>}} release - The release to attach the asset to.
 * @param {string} name - The asset file name.
 * @param {string} path - Path to the asset file inside dist-release.
 */
async function uploadAsset(token, release, name, path) {
	const existing = release.assets.find((asset) => asset.name === name)
	if (existing) {
		await githubFetch(`/releases/assets/${existing.id}`, token, { method: "DELETE" })
	}
	const uploadBase = release.uploadUrl.replace(/\{.*\}/, "")
	const body = readFileSync(path)
	const uploaded = await githubFetch(
		`${uploadBase}?name=${encodeURIComponent(name)}`,
		token,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Length": body.length,
			},
			body,
		},
	)
	const asset = await uploaded.json()
	console.log(`Uploaded ${asset.name} (${asset.size} bytes) to the release.`)
}

async function main() {
	for (const name of REQUIRED_ENV) {
		if (!process.env[name]) {
			throw new Error(`Missing environment variable ${name}.`)
		}
	}
	const token = process.env.GITHUB_TOKEN
	const version = process.env.RELEASE_VERSION
	const owner = process.env.CIRCLE_PROJECT_USERNAME
	const repo = process.env.CIRCLE_PROJECT_REPONAME
	const sha = process.env.CIRCLE_SHA1

	const release = await findOrCreateRelease(token, version, owner, repo, sha)
	await uploadAsset(token, release, `qredence-fleet-${version}.tgz`, `dist-release/qredence-fleet-${version}.tgz`)
	await uploadAsset(token, release, "SHA256SUMS", "dist-release/SHA256SUMS")
	console.log(`GitHub release v${version} published with the release artifacts.`)
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exit(1)
})
