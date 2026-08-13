const ARTIFACTS_SCOPE_SUFFIX = "artifacts";

/** Relative tree path of the artifacts folder. Matches workspace node paths. */
export function getArtifactsScopePath(_root?: string) {
	return ARTIFACTS_SCOPE_SUFFIX;
}
