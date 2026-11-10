/**
 * Stores a dashboard when an assistant message finishes.
 *
 * The bridge reports the finished message. This module owns the fence, the
 * Cloud call, and the presentation write. A throw after the fence is known is
 * stored as an error so the attachment does not stay on "Building".
 */
import type { PrimeAgentArtifact } from "@prime-agent/web-protocol";
import {
	type DashboardFence,
	type DashboardRecord,
	DashboardRecordSchema,
	type DashboardStatus,
	dashboardFenceKey,
	dashboardFences,
	dashboardIdFromResponse,
} from "@prime-agent/web-protocol/dashboards";
import { requireSession } from "../handlers/session-access";
import { stablePresentationId } from "../prime-agent-presentation";
import { getBridge } from "../singleton";
import { configuredDashboardService } from "./cloud";
import { dashboardMode } from "./credentials";
import { dashboardUserId } from "./user-id";

const KEY_REQUIRED = "Add a Thesys API key in Settings to build this dashboard.";
const EDIT_NEEDS_KEY = "This dashboard was built by OpenUI Cloud. Add the Thesys key back to change it.";
const NOT_A_CLOUD_BOARD = "That dashboard was not built by OpenUI Cloud.";

/**
 * A dashboard is generated in the background, so an edit that arrives while it
 * is still being built is refused with 409 rather than queued. That is a
 * transient state, not a failure: wait briefly for generation to settle so an
 * immediate follow-up succeeds instead of erroring at the user.
 */
const EDIT_SETTLE_ATTEMPTS = 8;
const EDIT_SETTLE_INTERVAL_MS = 1500;

const settling = new Map<string, Promise<PrimeAgentArtifact | undefined>>();

function statusOf(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
	const status = (error as { status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

function isStillGenerating(error: unknown): boolean {
	return statusOf(error) === 409;
}

async function editWhenSettled(edit: () => Promise<string>, signal: AbortSignal): Promise<string> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await edit();
		} catch (error) {
			if (!isStillGenerating(error) || attempt >= EDIT_SETTLE_ATTEMPTS || signal.aborted) throw error;
			await new Promise((resolve) => setTimeout(resolve, EDIT_SETTLE_INTERVAL_MS));
		}
	}
}

function publicDashboardError(error: unknown): string {
	const raw = error instanceof Error ? error.message : "Dashboard request failed.";
	const scrubbed = raw.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
	return /sk-|api[_-]?key|THESYS|fct_/i.test(scrubbed) ? "Dashboard request failed." : scrubbed.slice(0, 300);
}

function dashboardArtifactId(sessionId: string, identity: string): string {
	return stablePresentationId(`dashboard:${sessionId}:${identity}`);
}

function artifactFor(
	sessionId: string,
	artifactId: string,
	record: DashboardRecord,
	title: string,
	sourceMessageId?: string,
): PrimeAgentArtifact {
	return {
		id: artifactId,
		runId: stablePresentationId(`${sessionId}:dashboards`),
		sourceMessageId,
		kind: "openui-dashboard",
		title,
		status: record.response || record.program ? "success" : "error",
		input: { mode: record.mode, dashboardId: record.dashboardId },
		output: record,
		timestamp: Date.now(),
	};
}

export function storedRecord(artifact: PrimeAgentArtifact): DashboardRecord | undefined {
	const parsed = DashboardRecordSchema.safeParse(artifact.output);
	return parsed.success ? parsed.data : undefined;
}

/** Every dashboard artifact stored for a session, oldest first. */
function storedDashboards(sessionId: string): PrimeAgentArtifact[] {
	return getBridge()
		.getPresentation(sessionId)
		.artifactRuns.flatMap((run) => run.artifacts)
		.filter((artifact) => artifact.kind === "openui-dashboard");
}

/** The stored artifact a dashboard id points at: Fleet's id or the Cloud id. */
export function findEditableDashboard(sessionId: string, dashboardId: string): PrimeAgentArtifact | undefined {
	return storedDashboards(sessionId).find(
		(artifact) => artifact.id === dashboardId || storedRecord(artifact)?.dashboardId === dashboardId,
	);
}

function findByFenceKey(sessionId: string, fenceKey: string): PrimeAgentArtifact | undefined {
	return storedDashboards(sessionId).find((artifact) => storedRecord(artifact)?.fenceKey === fenceKey);
}

/** A board this version cannot read stays where it is. Settling must not send it to Cloud again. */
function savedByOlderVersion(sessionId: string, messageId: string): boolean {
	return storedDashboards(sessionId).some(
		(artifact) => artifact.sourceMessageId === messageId && storedRecord(artifact) === undefined,
	);
}

function alreadySettled(artifact: PrimeAgentArtifact | undefined, messageId: string): boolean {
	if (!artifact) return false;
	return storedRecord(artifact)?.settledMessageIds?.includes(messageId) === true;
}

function withSettledMessage(record: DashboardRecord, messageId: string): DashboardRecord {
	const settled = record.settledMessageIds ?? [];
	if (settled.includes(messageId)) return record;
	return { ...record, settledMessageIds: [...settled, messageId].slice(-50) };
}

async function storeDashboard(sessionId: string, artifact: PrimeAgentArtifact): Promise<PrimeAgentArtifact> {
	await getBridge().upsertPresentationArtifact(sessionId, artifact);
	return artifact;
}

function logSettleFailure(error: unknown): void {
	const detail = error instanceof Error ? error.message : "unknown";
	process.stderr.write(`[dashboards] settle failed: ${detail}\n`);
}

async function storeSettleFailure(
	sessionId: string,
	messageId: string,
	fence: DashboardFence,
	error: unknown,
): Promise<PrimeAgentArtifact | undefined> {
	const session = await requireSession(sessionId);
	if (!session) return undefined;
	const fenceKey = dashboardFenceKey(fence);
	const existing = fence.id
		? findEditableDashboard(session.sessionId, fence.id)
		: findByFenceKey(session.sessionId, fenceKey);
	const previous = existing ? storedRecord(existing) : undefined;
	const title = fence.title ?? existing?.title ?? "Dashboard";
	const base: DashboardRecord = previous ?? {
		mode: fence.program ? "local" : "cloud",
		fenceKey,
		...(fence.dataset ? { dataset: fence.dataset } : {}),
	};
	return storeDashboard(
		session.sessionId,
		artifactFor(
			session.sessionId,
			existing?.id ?? dashboardArtifactId(session.sessionId, fenceKey),
			withSettledMessage({ ...base, error: publicDashboardError(error) }, messageId),
			existing?.title || title,
			existing?.sourceMessageId ?? messageId,
		),
	);
}

/**
 * Store one dashboard when an assistant message finishes.
 *
 * A program fence is stored locally and does not call Cloud. A prompt fence calls
 * Cloud once when a key is configured. The same message is settled once, so a
 * replay does not call the builder again. A board this version cannot read is left
 * in place.
 */
export async function settleDashboardMessage(
	sessionId: string,
	messageId: string,
	content: string,
): Promise<PrimeAgentArtifact | undefined> {
	const fence = dashboardFences(content)[0];
	if (!fence) return undefined;
	// One board per fence. Overlapping messages with the same fence must share
	// this claim, or both call Cloud before either artifact is stored.
	const claim = `${sessionId}:${dashboardFenceKey(fence)}`;
	const inFlight = settling.get(claim);
	if (inFlight) {
		await inFlight;
		return settleDashboardMessage(sessionId, messageId, content);
	}
	const run = settleFenceOrFailure(sessionId, messageId, fence);
	settling.set(claim, run);
	try {
		return await run;
	} finally {
		if (settling.get(claim) === run) settling.delete(claim);
	}
}

async function settleFenceOrFailure(
	sessionId: string,
	messageId: string,
	fence: DashboardFence,
): Promise<PrimeAgentArtifact | undefined> {
	try {
		return await settleFence(sessionId, messageId, fence);
	} catch (error) {
		try {
			return await storeSettleFailure(sessionId, messageId, fence, error);
		} catch (storeError) {
			logSettleFailure(storeError);
			return undefined;
		}
	}
}

async function settleFence(
	sessionId: string,
	messageId: string,
	fence: DashboardFence,
): Promise<PrimeAgentArtifact | undefined> {
	const session = await requireSession(sessionId);
	if (!session) return undefined;
	if (savedByOlderVersion(session.sessionId, messageId)) return undefined;
	if (fence.program) return await settleLocal(session.sessionId, messageId, fence);
	if (!fence.prompt) return undefined;
	const mode = await dashboardMode();
	if (fence.id) return await settleEdit(session.sessionId, messageId, fence, mode);
	return await settleCreate(session.sessionId, messageId, fence, mode);
}

async function settleLocal(
	sessionId: string,
	messageId: string,
	fence: DashboardFence,
): Promise<PrimeAgentArtifact | undefined> {
	const program = fence.program;
	if (!program) return undefined;
	const fenceKey = dashboardFenceKey(fence);
	const existing = fence.id ? findEditableDashboard(sessionId, fence.id) : findByFenceKey(sessionId, fenceKey);
	if (alreadySettled(existing, messageId)) return existing;
	const previous = existing ? storedRecord(existing) : undefined;
	if (existing && previous?.mode === "cloud") return existing;
	const title = fence.title ?? existing?.title ?? "Dashboard";
	const localTarget = previous?.mode === "local" && existing ? existing : undefined;
	const record: DashboardRecord = withSettledMessage(
		{
			mode: "local",
			program,
			fenceKey: previous?.mode === "local" ? previous.fenceKey : fenceKey,
			dataset: fence.dataset ?? previous?.dataset,
		},
		messageId,
	);
	return storeDashboard(
		sessionId,
		artifactFor(
			sessionId,
			localTarget?.id ?? dashboardArtifactId(sessionId, fenceKey),
			record,
			localTarget?.title || title,
			localTarget?.sourceMessageId ?? messageId,
		),
	);
}

async function settleCreate(
	sessionId: string,
	messageId: string,
	fence: DashboardFence,
	mode: DashboardStatus["mode"],
): Promise<PrimeAgentArtifact | undefined> {
	const prompt = fence.prompt;
	if (!prompt) return undefined;
	const fenceKey = dashboardFenceKey(fence);
	const existing = findByFenceKey(sessionId, fenceKey);
	if (alreadySettled(existing, messageId)) return existing;
	const title = fence.title ?? existing?.title ?? "Dashboard";
	// A missing key must not replace a board that was already built.
	if (existing && storedRecord(existing)?.response) return existing;
	if (mode !== "cloud") {
		return storeDashboard(
			sessionId,
			artifactFor(
				sessionId,
				existing?.id ?? dashboardArtifactId(sessionId, fenceKey),
				withSettledMessage({ mode: "cloud", fenceKey, dataset: fence.dataset, error: KEY_REQUIRED }, messageId),
				title,
				existing?.sourceMessageId ?? messageId,
			),
		);
	}

	const service = await configuredDashboardService();
	if (!service) {
		return storeDashboard(
			sessionId,
			artifactFor(
				sessionId,
				existing?.id ?? dashboardArtifactId(sessionId, fenceKey),
				withSettledMessage({ mode: "cloud", fenceKey, dataset: fence.dataset, error: KEY_REQUIRED }, messageId),
				title,
				messageId,
			),
		);
	}

	const context = { userId: await dashboardUserId(), sessionId, dataset: fence.dataset };
	try {
		const response = await service.create({ title, prompt }, context, { signal: AbortSignal.timeout(120_000) });
		const record: DashboardRecord = withSettledMessage(
			{
				mode: "cloud",
				response,
				dashboardId: dashboardIdFromResponse(response),
				dataset: fence.dataset,
				fenceKey,
			},
			messageId,
		);
		return storeDashboard(
			sessionId,
			artifactFor(sessionId, existing?.id ?? dashboardArtifactId(sessionId, fenceKey), record, title, messageId),
		);
	} catch (error) {
		const record: DashboardRecord = withSettledMessage(
			{ mode: "cloud", fenceKey, dataset: fence.dataset, error: publicDashboardError(error) },
			messageId,
		);
		return storeDashboard(
			sessionId,
			artifactFor(
				sessionId,
				existing?.id ?? dashboardArtifactId(sessionId, fenceKey),
				record,
				title,
				existing?.sourceMessageId ?? messageId,
			),
		);
	}
}

async function settleEdit(
	sessionId: string,
	messageId: string,
	fence: DashboardFence,
	mode: DashboardStatus["mode"],
): Promise<PrimeAgentArtifact | undefined> {
	const prompt = fence.prompt;
	const dashboardId = fence.id;
	if (!prompt || !dashboardId) return undefined;
	const target = findEditableDashboard(sessionId, dashboardId);
	if (alreadySettled(target, messageId)) return target;
	const record = target ? storedRecord(target) : undefined;
	const cloudId = record?.dashboardId;
	const title = fence.title ?? target?.title ?? "Dashboard";
	if (!target || !record || !cloudId) {
		const fenceKey = dashboardFenceKey(fence);
		return storeDashboard(
			sessionId,
			artifactFor(
				sessionId,
				dashboardArtifactId(sessionId, fenceKey),
				withSettledMessage({ mode: "cloud", fenceKey, error: NOT_A_CLOUD_BOARD }, messageId),
				title,
				messageId,
			),
		);
	}

	const service = mode === "cloud" ? await configuredDashboardService() : null;
	if (!service) {
		return storeDashboard(
			sessionId,
			artifactFor(
				sessionId,
				target.id,
				withSettledMessage({ ...record, error: EDIT_NEEDS_KEY }, messageId),
				target.title || title,
				target.sourceMessageId,
			),
		);
	}

	const dataset = fence.dataset ?? record.dataset;
	const context = { userId: await dashboardUserId(), sessionId, dashboardId: target.id, dataset };
	const signal = AbortSignal.timeout(120_000);
	try {
		const response = await editWhenSettled(() => service.edit({ id: cloudId, prompt }, context, { signal }), signal);
		const next: DashboardRecord = withSettledMessage(
			{
				mode: "cloud",
				response,
				dashboardId: cloudId,
				dataset,
				fenceKey: record.fenceKey,
			},
			messageId,
		);
		return storeDashboard(
			sessionId,
			artifactFor(sessionId, target.id, next, target.title || title, target.sourceMessageId),
		);
	} catch (error) {
		const next: DashboardRecord = withSettledMessage({ ...record, error: publicDashboardError(error) }, messageId);
		return storeDashboard(
			sessionId,
			artifactFor(sessionId, target.id, next, target.title || title, target.sourceMessageId),
		);
	}
}

/** Attach settlement to the process bridge. The bridge does not import this module. */
export function registerDashboardSettlement(): void {
	getBridge().setAssistantDoneListener((sessionId, messageId, content) => {
		void settleDashboardMessage(sessionId, messageId, content);
	});
}
