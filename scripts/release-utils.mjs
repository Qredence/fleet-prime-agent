const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const NPM_REGISTRY = "https://registry.npmjs.org/";
export const RELEASE_REPOSITORY = Object.freeze({ owner: "Qredence", repo: "fleet-prime-agent" });

export function parseStableVersion(version) {
	const match = STABLE_VERSION_RE.exec(version);
	if (!match) {
		throw new Error(`Expected a stable semver version, received: ${version}`);
	}
	return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
	const leftParts = parseStableVersion(left);
	const rightParts = parseStableVersion(right);
	for (let index = 0; index < leftParts.length; index += 1) {
		if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
	}
	return 0;
}

export function assertReleaseVersion({ packageName, packageVersion, publishedLatest }) {
	parseStableVersion(packageVersion);
	if (publishedLatest && compareVersions(packageVersion, publishedLatest) <= 0) {
		throw new Error(
			`${packageName}@${packageVersion} is not newer than the npm latest version ${publishedLatest}. ` +
				"A release must be versioned through Changesets before it reaches main.",
		);
	}
}

export function registryPackageUrl(registry, packageName, version) {
	const encodedName = encodeURIComponent(packageName);
	return `${registry.replace(/\/$/, "")}/${encodedName}/${version}`;
}
