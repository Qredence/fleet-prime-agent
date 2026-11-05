import { parseStableVersion } from "./release-utils.mjs";

const GITHUB_API_ORIGIN = "https://api.github.com";
const NPM_REGISTRY_HOST = "registry.npmjs.org";
const FLEET_PINNED_RELEASE_HOST = "pub-728493de92a943e2a9b2d17b4719f318.r2.dev";
const PINNED_RUST_RELEASE_HOSTS = new Set([FLEET_PINNED_RELEASE_HOST]);

/**
 * Builds a GitHub REST URL from a repository-relative API path.
 * @param {string} path - Path beginning with `/repos/...`.
 * @returns {string} Absolute GitHub API URL.
 */
export function githubApiUrl(path) {
	if (path.startsWith("http://") || path.startsWith("https://")) {
		const url = new URL(path);
		if (url.origin !== GITHUB_API_ORIGIN) {
			throw new Error(`Refusing GitHub request outside ${GITHUB_API_ORIGIN}`);
		}
		return url.href;
	}
	if (!path.startsWith("/")) throw new Error(`GitHub API path must start with /: ${path}`);
	return `${GITHUB_API_ORIGIN}${path}`;
}

/**
 * @param {string} url - npm tarball URL from registry metadata.
 */
export function assertNpmRegistryTarballUrl(url) {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:" || parsed.hostname !== NPM_REGISTRY_HOST) {
		throw new Error(`Refusing tarball download outside ${NPM_REGISTRY_HOST}`);
	}
}

/**
 * @param {string} baseUrl - Rust runtime base URL from the pinned manifest.
 * @param {string} archive - Archive file name from the pinned manifest.
 * @returns {string} Verified download URL for the archive.
 */
export function pinnedRustArchiveUrl(baseUrl, archive) {
	if (typeof baseUrl !== "string" || typeof archive !== "string" || !archive || archive.includes("/")) {
		throw new Error("Invalid pinned Rust runtime archive reference");
	}
	const parsed = new URL(baseUrl);
	if (parsed.protocol !== "https:" || !PINNED_RUST_RELEASE_HOSTS.has(parsed.hostname)) {
		throw new Error("Rust runtime baseUrl is not a pinned Fleet release host");
	}
	return `${parsed.href.replace(/\/$/, "")}/${archive}`;
}

/**
 * @param {string} tarballUrl - Legacy TypeScript runtime tarball URL from the manifest.
 */
export function assertPinnedLegacyTarballUrl(tarballUrl) {
	const parsed = new URL(tarballUrl);
	if (parsed.protocol !== "https:" || !PINNED_RUST_RELEASE_HOSTS.has(parsed.hostname)) {
		throw new Error("Runtime tarball URL is not a pinned Fleet release host");
	}
	if (!parsed.pathname.includes("/releases/") || !parsed.pathname.endsWith(".tgz")) {
		throw new Error("Runtime tarball URL must point at a versioned release archive");
	}
}

/**
 * @param {string} uploadUrl - GitHub asset upload URL from the release metadata.
 * @param {string} owner - Expected repository owner.
 * @param {string} repo - Expected repository name.
 * @returns {string} Normalized upload URL without template query parameters.
 */
export function githubReleaseUploadUrl(uploadUrl, owner, repo) {
	const brace = uploadUrl.indexOf("{");
	const normalized = brace === -1 ? uploadUrl : uploadUrl.slice(0, brace);
	const parsed = new URL(normalized);
	if (parsed.protocol !== "https:" || parsed.hostname !== "uploads.github.com") {
		throw new Error("Refusing release asset upload outside uploads.github.com");
	}
	const prefix = `/repos/${owner}/${repo}/releases/`;
	if (!parsed.pathname.startsWith(prefix)) {
		throw new Error("Refusing release asset upload for an unexpected repository");
	}
	return normalized;
}

/**
 * @param {string} version - npm dist-tag value written to local marker state.
 */
export function assertStableVersionString(version) {
	parseStableVersion(version);
}
