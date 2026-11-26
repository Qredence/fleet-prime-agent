import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import { type DashboardRecord, DashboardRecordSchema } from "@prime-agent/web-protocol/dashboards";

type ArtifactRun = { artifacts: readonly PrimeAgentArtifact[] };

export function dashboardRecord(artifact: PrimeAgentArtifact): DashboardRecord | undefined {
	if (artifact.kind !== "openui-dashboard") return undefined;
	const parsed = DashboardRecordSchema.safeParse(artifact.output);
	return parsed.success ? parsed.data : undefined;
}

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
