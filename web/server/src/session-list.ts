import type { SessionInfo, SessionSummary } from "prime-agent";

export type SessionListSource = SessionInfo | SessionSummary;

export interface NormalizedSessionListRow {
	readonly source: SessionListSource;
	readonly sessionId: string;
	readonly cwd: string;
	readonly title: string | undefined;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly messageCount: number;
	readonly firstMessage: string;
	readonly isSubagent: boolean;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timestampValue(value: unknown): string | undefined {
	if (value instanceof Date) return value.toISOString();
	return stringValue(value);
}

function messageCountValue(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/**
 * Normalize session rows across a Vite HMR boundary. A pre-upgrade global
 * bridge returns SessionInfo (`id`/`name`/Date), while the daemon bridge
 * returns SessionSummary (`sessionId`/`sessionName`/ISO strings).
 */
export function normalizeSessionListRow(source: SessionListSource): NormalizedSessionListRow {
	const raw = source as unknown as Record<string, unknown>;
	const sessionId = stringValue(raw.sessionId) ?? stringValue(raw.id);
	const cwd = stringValue(raw.cwd);
	if (!sessionId || !cwd) {
		throw new Error("The Prime Agent session listing returned an invalid session entry");
	}

	const createdAt = timestampValue(raw.created) ?? timestampValue(raw.modified) ?? new Date().toISOString();
	const updatedAt = timestampValue(raw.modified) ?? timestampValue(raw.created) ?? createdAt;
	const isSubagent =
		typeof raw.runtimeKind === "string"
			? raw.runtimeKind === "subagent"
			: Boolean(
					raw.rlmChildId ??
						raw.rlmParentNodeId ??
						raw.parentActiveSessionId ??
						raw.parentSessionId ??
						raw.parentSessionPath,
				);

	return {
		source,
		sessionId,
		cwd,
		title: stringValue(raw.sessionName) ?? stringValue(raw.name),
		createdAt,
		updatedAt,
		messageCount: messageCountValue(raw.messageCount),
		firstMessage: typeof raw.firstMessage === "string" ? raw.firstMessage : "",
		isSubagent,
	};
}
