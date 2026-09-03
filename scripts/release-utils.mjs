const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const NPM_REGISTRY = "https://registry.npmjs.org/";
export const RELEASE_REPOSITORY = Object.freeze({ owner: "Qredence", repo: "fleet-prime-agent" });

/**
 * Validates and parses a stable semantic version.
 * @param {string} version - The version in major.minor.patch format without leading zeros.
 * @returns {number[]} The numeric major, minor, and patch components.
 * @throws {Error} If the version is not a valid stable semantic version.
 */
export function parseStableVersion(version) {
	const match = STABLE_VERSION_RE.exec(version);
	if (!match) {
		throw new Error(`Expected a stable semver version, received: ${version}`);
	}
	return match.slice(1).map(Number);
}

/**
 * Compares two stable semantic versions.
 * @param {string} left - The first version to compare.
 * @param {string} right - The second version to compare.
 * @return {number} `1` if the first version is newer, `-1` if it is older, or `0` if the versions are equal.
 */
export function compareVersions(left, right) {
	const leftParts = parseStableVersion(left);
	const rightParts = parseStableVersion(right);
	for (let index = 0; index < leftParts.length; index += 1) {
		if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
	}
	return 0;
}

/**
 * Validates that a package release version is stable and newer than the published version.
 * @param {object} release - Release version details.
 * @param {string} release.packageName - The package name used in release errors.
 * @param {string} release.packageVersion - The proposed stable version.
 * @param {string} [release.publishedLatest] - The currently published latest version.
 */
export function assertReleaseVersion({ packageName, packageVersion, publishedLatest }) {
	parseStableVersion(packageVersion);
	if (publishedLatest && compareVersions(packageVersion, publishedLatest) <= 0) {
		throw new Error(
			`${packageName}@${packageVersion} is not newer than the npm latest version ${publishedLatest}. ` +
				"A release must be versioned through Changesets before it reaches main.",
		);
	}
}

/**
 * Builds the registry URL for a specific package version.
 * @param {string} registry - The package registry base URL.
 * @param {string} packageName - The package name to encode in the URL.
 * @param {string} version - The package version.
 * @return {string} The package-version registry URL.
 */
export function registryPackageUrl(registry, packageName, version) {
	const encodedName = encodeURIComponent(packageName);
	return `${registry.replace(/\/$/, "")}/${encodedName}/${version}`;
}
