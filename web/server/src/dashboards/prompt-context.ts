import type { OpenUIDashboardPrompt } from "@prime-agent/web-protocol";
import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { dashboardMode } from "./credentials";

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function dashboardArtifacts(presentation: PrimeAgentSessionPresentation) {
	return presentation.artifactRuns.flatMap((run) => run.artifacts);
}

export function latestDashboardId(presentation: PrimeAgentSessionPresentation): string | undefined {
	const artifacts = dashboardArtifacts(presentation);
	for (let index = artifacts.length - 1; index >= 0; index -= 1) {
		const artifact = artifacts[index];
		if (artifact?.kind !== "openui-dashboard") continue;
		const input = record(artifact.input);
		const output = record(artifact.output);
		const id = input?.dashboardId ?? output?.dashboardId;
		if (typeof id === "string" && id.trim()) return id;
	}
	return undefined;
}

/** Fleet artifact id of the newest local board. An edit fence sends this id back. */
function latestLocalDashboardId(presentation: PrimeAgentSessionPresentation): string | undefined {
	const artifacts = dashboardArtifacts(presentation);
	for (let index = artifacts.length - 1; index >= 0; index -= 1) {
		const artifact = artifacts[index];
		if (artifact?.kind !== "openui-dashboard" || !artifact.id.trim()) continue;
		const output = record(artifact.output);
		if (output?.mode === "local") return artifact.id;
	}
	return undefined;
}

export async function dashboardPromptContext(
	presentation: PrimeAgentSessionPresentation,
): Promise<OpenUIDashboardPrompt> {
	const mode = await dashboardMode();
	const latest = mode === "cloud" ? latestDashboardId(presentation) : latestLocalDashboardId(presentation);
	return latest ? { mode, latestDashboardId: latest } : { mode };
}
