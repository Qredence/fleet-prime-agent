import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type {
	PrimeAgentArtifact,
	PrimeAgentArtifactRun,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol";
import { PrimeAgentSessionPresentationSchema } from "@prime-agent/web-protocol/chat-protocol.zod";

export function createEmptyPrimeAgentSessionPresentation(
	initial: Partial<PrimeAgentSessionPresentation> = {},
): PrimeAgentSessionPresentation {
	return {
		revision: 0,
		userBash: [],
		rlmChildren: [],
		refinements: [],
		artifactRuns: [],
		...initial,
	};
}

/** Stable, non-secret identifier for browser presentation records. */
export function stablePresentationId(seed: string): string {
	let hash = 2166136261;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return `${seed.replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 96)}-${(hash >>> 0).toString(36)}`;
}

export function upsertArtifact(
	presentation: PrimeAgentSessionPresentation,
	artifact: PrimeAgentArtifact,
): PrimeAgentSessionPresentation {
	const existingRunIndex = presentation.artifactRuns.findIndex((run) => run.runId === artifact.runId);
	const nextRuns = presentation.artifactRuns.map((run) => ({
		...run,
		artifacts: [...run.artifacts],
	}));
	if (existingRunIndex < 0) {
		const nextRun: PrimeAgentArtifactRun = {
			id: stablePresentationId(`artifact-run:${artifact.runId}`),
			runId: artifact.runId,
			artifacts: [artifact],
			startedAt: artifact.timestamp,
		};
		nextRuns.push(nextRun);
	} else {
		const run = nextRuns[existingRunIndex]!;
		const artifactIndex = run.artifacts.findIndex((item) => item.id === artifact.id);
		if (artifactIndex < 0) run.artifacts.push(artifact);
		else run.artifacts[artifactIndex] = artifact;
		if (artifact.status !== "running") run.endedAt = artifact.timestamp;
	}
	return { ...presentation, artifactRuns: nextRuns };
}

type ManagedPresentationSession = {
	session: {
		sessionManager: {
			getSessionArtifactDir(): string | undefined;
		};
	};
	sessionPath: string;
};

function presentationPath(session: ManagedPresentationSession): string | undefined {
	const managedDir = session.session.sessionManager.getSessionArtifactDir();
	if (managedDir) return join(managedDir, "presentation.json");
	if (!session.sessionPath) return undefined;
	return join(
		dirname(dirname(session.sessionPath)),
		"session-artifacts",
		basename(session.sessionPath, ".jsonl"),
		"presentation.json",
	);
}

export async function loadManagedPrimePresentation(
	session: ManagedPresentationSession,
): Promise<PrimeAgentSessionPresentation | undefined> {
	const path = presentationPath(session);
	if (!path) return undefined;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
		const validated = PrimeAgentSessionPresentationSchema.safeParse(parsed);
		return validated.success ? validated.data : undefined;
	} catch {
		return undefined;
	}
}

export async function writeManagedPrimePresentation(
	session: ManagedPresentationSession,
	presentation: PrimeAgentSessionPresentation,
): Promise<void> {
	const path = presentationPath(session);
	if (!path) return;
	const validated = PrimeAgentSessionPresentationSchema.parse(presentation);
	const directory = dirname(path);
	await mkdir(directory, { recursive: true });
	const temporaryPath = join(
		directory,
		`.presentation-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
	);
	try {
		await writeFile(temporaryPath, `${JSON.stringify(validated)}\n`, "utf8");
		await rename(temporaryPath, path);
	} finally {
		await rm(temporaryPath, { force: true }).catch(() => undefined);
	}
}
