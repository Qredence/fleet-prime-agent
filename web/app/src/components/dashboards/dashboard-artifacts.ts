import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";

type ArtifactRun = { artifacts: readonly PrimeAgentArtifact[] };

/** Presentation artifacts replace live-run copies of the same id. */
export function mergeArtifactsById(
	runs: readonly ArtifactRun[],
	presentationRuns: readonly ArtifactRun[] | undefined,
): PrimeAgentArtifact[] {
	const byId = new Map<string, PrimeAgentArtifact>();
	for (const artifact of [
		...runs.flatMap((run) => run.artifacts),
		...(presentationRuns?.flatMap((run) => run.artifacts) ?? []),
	]) {
		byId.set(artifact.id, artifact);
	}
	return [...byId.values()];
}
