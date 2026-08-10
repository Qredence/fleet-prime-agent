const ARTIFACTS_SCOPE_SUFFIX = "artifacts";

export function getArtifactsScopePath(root: string) {
	return `${root}/${ARTIFACTS_SCOPE_SUFFIX}`;
}
