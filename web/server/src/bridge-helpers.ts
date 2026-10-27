import { realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
	buildOpenUIPrompt,
	type ChatMode,
	type ChatPlanAction,
	type ChatServiceTier,
	type ChatStreamEvent,
	type ChatThinkingLevel,
	type OpenUIPromptMode,
	type PrimeAgentArtifact,
	type PrimeAgentRlmChild,
	type PrimeAgentSessionPresentation,
	type PrimeAgentUserBash,
} from "@prime-agent/web-protocol";
import type { AgentConnection, AgentConnectionModel, ExtensionUIContext, ExtensionUIDialogOptions } from "prime-agent";
import type { DaemonSessionSummary as SessionSummary } from "./daemon-protocol";
import { sessionDirectoryForCwd } from "./daemon-runtime";
import type { RlmChildStatusOverride } from "./event-mapper";
import { readLegacySession } from "./legacy/prime-agent-sdk";
import type { PendingDialogRegistry } from "./pending-dialogs";
import {
	createEmptyPrimeAgentSessionPresentation,
	stablePresentationId,
	upsertArtifact,
} from "./prime-agent-presentation";

// ---------------------------------------------------------------------------
// Web UI context — a thin ExtensionUIContext backed by PendingDialogRegistry
// ---------------------------------------------------------------------------

const WEB_UI_UNSUPPORTED = "Not available in the web UI";

function unsupportedInWebUi(method: string): never {
	throw new Error(`${method}: ${WEB_UI_UNSUPPORTED}`);
}

export type UIContextCtorArgs = {
	sessionId: string;
	emitFrame: (frame: ChatStreamEvent) => void;
	dialogs: PendingDialogRegistry;
};

/**
 * The web port only needs the three dialog primitives from `ExtensionUIContext`.
 * Everything else (terminal input, theme management, custom widgets, footer
 * factories, the editor component, etc.) is terminal-only and we expose a
 * `Proxy` that throws a clear error. This keeps the type-checked interface
 * intact for callers that just dereference a field, while the bridge itself
 * only ever calls `select` / `confirm` / `input` / `notify` / `setStatus`.
 */
export function createWebUIContext({ sessionId, emitFrame, dialogs }: UIContextCtorArgs): ExtensionUIContext {
	const impl: Pick<ExtensionUIContext, "select" | "confirm" | "input" | "notify" | "setStatus"> = {
		async select(title: string, options: string[], _opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
			const toolCallId = crypto.randomUUID();
			const dialog = await dialogs.open<{ choice: string } | undefined>({
				sessionId,
				toolCallId,
				kind: "select",
				title,
				message: "",
				options,
				signalFrame: {
					type: "tool-Question",
					toolCallId,
					state: "input-streaming",
					input: { kind: "select", title, options },
				},
			});
			return (dialog as { choice: string } | undefined)?.choice;
		},
		async confirm(title: string, message: string, _opts?: ExtensionUIDialogOptions): Promise<boolean> {
			const toolCallId = crypto.randomUUID();
			const dialog = await dialogs.open<boolean>({
				sessionId,
				toolCallId,
				kind: "confirm",
				title,
				message,
				signalFrame: {
					type: "tool-Question",
					toolCallId,
					state: "input-streaming",
					input: { kind: "confirm", title, message },
				},
			});
			return Boolean(dialog);
		},
		async input(title: string, placeholder?: string, _opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
			const toolCallId = crypto.randomUUID();
			const dialog = await dialogs.open<{ text: string } | undefined>({
				sessionId,
				toolCallId,
				kind: "input",
				title,
				message: "",
				placeholder,
				signalFrame: {
					type: "tool-Question",
					toolCallId,
					state: "input-streaming",
					input: { kind: "text", title, placeholder },
				},
			});
			return (dialog as { text: string } | undefined)?.text;
		},
		notify(message: string, type: "info" | "warning" | "error" = "info"): void {
			const prefix = type === "info" ? "" : `${type.toUpperCase()}: `;
			emitFrame({
				type: "state",
				state: { name: "agent_start", message: `${prefix}${message}` },
			});
		},
		setStatus(key: string, text: string | undefined): void {
			emitFrame({
				type: "state",
				state: { name: "agent_start", message: `[${key}] ${text ?? ""}` },
			});
		},
	};
	return new Proxy(impl as unknown as ExtensionUIContext, {
		get(target, prop, receiver) {
			if (prop in target) return Reflect.get(target, prop, receiver);
			return () => unsupportedInWebUi(String(prop));
		},
	}) as ExtensionUIContext;
}

export type OpenUIPromptSessionState = {
	enabled: boolean;
	mode: OpenUIPromptMode;
	prompt: string;
	artifact?: boolean;
};

export function createOpenUIPromptSessionState(
	mode: OpenUIPromptMode = "agent",
	enabled = false,
	artifact = false,
): OpenUIPromptSessionState {
	return { enabled, mode, artifact, prompt: buildOpenUIPrompt(mode, { artifact }) };
}

export function resolveOpenUIPromptMode(mode?: ChatMode, planAction?: ChatPlanAction): OpenUIPromptMode {
	if (planAction === "execute") return "plan-execution";
	if (planAction === "refine") return "plan";
	return mode ?? "agent";
}

function persistedBashStatus(message: Record<string, unknown>): PrimeAgentUserBash["status"] {
	if (message.cancelled === true) return "cancelled";
	if (message.errorMessage || (typeof message.exitCode === "number" && message.exitCode !== 0)) return "error";
	return "success";
}

export function presentationArtifactsEqual(left: PrimeAgentArtifact, right: PrimeAgentArtifact): boolean {
	return (
		left.id === right.id &&
		left.runId === right.runId &&
		left.sourceMessageId === right.sourceMessageId &&
		left.kind === right.kind &&
		left.title === right.title &&
		left.status === right.status &&
		JSON.stringify(left.input) === JSON.stringify(right.input) &&
		JSON.stringify(left.output) === JSON.stringify(right.output)
	);
}

export function initialPresentationForSession(
	messages: readonly AgentMessage[],
	sessionName: string | undefined,
	thinkingLevel: ChatThinkingLevel | undefined,
	serviceTier: ChatServiceTier | undefined,
	recap: string | undefined,
	sessionId: string,
	base?: PrimeAgentSessionPresentation,
): PrimeAgentSessionPresentation {
	if (base) return base;
	const presentation = createEmptyPrimeAgentSessionPresentation({
		...(sessionName ? { sessionName } : {}),
		...(thinkingLevel ? { thinkingLevel } : {}),
		...(serviceTier ? { serviceTier } : {}),
		...(recap ? { recap } : {}),
	});
	let bashIndex = 0;
	for (const message of messages) {
		const value = message as unknown as Record<string, unknown>;
		if (value.role !== "bashExecution") continue;
		const command = typeof value.command === "string" ? value.command : "";
		const output = typeof value.output === "string" ? value.output : "";
		const timestamp = typeof value.timestamp === "number" ? value.timestamp : Date.now();
		const runId = stablePresentationId(`persisted-bash:${sessionId}:${bashIndex++}:${timestamp}:${command}`);
		const entry: PrimeAgentUserBash = {
			id: stablePresentationId(`user-bash:${runId}`),
			runId,
			command,
			output,
			status: persistedBashStatus(value),
			...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
			cancelled: value.cancelled === true,
			truncated: value.truncated === true,
			excludeFromContext: value.excludeFromContext === true,
			startedAt: timestamp,
			endedAt: timestamp,
		};
		presentation.userBash.push(entry);
		const artifact = {
			id: stablePresentationId(`${runId}:bash`),
			runId,
			sourceToolCallId: runId,
			kind: "bash" as const,
			title: command || "Bash",
			status: entry.status,
			input: { command, excludeFromContext: entry.excludeFromContext },
			output: { stdout: output, ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}) },
			timestamp,
		};
		presentation.artifactRuns = upsertArtifact(presentation, artifact).artifactRuns;
	}
	return presentation;
}

export interface BridgeSessionCache {
	sessionName: string | undefined;
	thinkingLevel: ThinkingLevel | undefined;
	serviceTier: ChatServiceTier | undefined;
	systemPrompt: string;
	contextUsage: unknown;
	tree: { tree: unknown[]; leafId: string | null } | undefined;
	isStreaming: boolean;
}

export function emptyCache(): BridgeSessionCache {
	return {
		sessionName: undefined,
		thinkingLevel: undefined,
		serviceTier: undefined,
		systemPrompt: "",
		contextUsage: undefined,
		tree: undefined,
		isStreaming: false,
	};
}

export async function refreshCache(connection: AgentConnection): Promise<BridgeSessionCache> {
	const [state, systemPrompt, stats, tree] = await Promise.all([
		connection.getState(),
		connection.getSystemPrompt().catch(() => ""),
		connection.getSessionStats().catch(() => undefined),
		connection.getSessionTree().catch(() => ({ tree: [], leafId: null })),
	]);
	return {
		sessionName: state.sessionName,
		thinkingLevel: state.thinkingLevel,
		serviceTier: state.serviceTier ?? undefined,
		systemPrompt,
		contextUsage: stats?.contextUsage,
		tree: { tree: tree.tree as unknown[], leafId: tree.leafId },
		isStreaming: state.isStreaming,
	};
}

export function fallbackSessionPath(
	connectionState: Awaited<ReturnType<AgentConnection["getState"]>>,
	cwd: string,
): string {
	if (connectionState.sessionFile) return resolve(connectionState.sessionFile);
	const sessionDir = connectionState.sessionDir ?? sessionDirectoryForCwd(cwd);
	return resolve(sessionDir, `${connectionState.sessionId}.jsonl`);
}

/**
 * Thrown when an explicit /export path escapes the session's project
 * directory. The 400 status lets `wrapApiHandler` answer Bad Request; the
 * message carries no paths (API errors are scrubbed for paths anyway).
 */
export class SessionExportPathError extends Error {
	readonly status: 400 = 400;

	constructor() {
		super("Export path must stay inside the session project directory");
		this.name = "SessionExportPathError";
	}
}

export async function confineSessionExportPath(
	connection: AgentConnection,
	outputPath: string | undefined,
): Promise<string | undefined> {
	if (outputPath === undefined) return undefined;
	const { cwd } = await connection.getState();
	const root = resolve(cwd);
	const canonicalRoot = await realpath(root).catch(() => root);
	const candidate = resolve(root, outputPath);
	const existingCandidate = await realpath(candidate).catch(() => undefined);
	if (
		existingCandidate &&
		existingCandidate !== canonicalRoot &&
		!existingCandidate.startsWith(`${canonicalRoot}${sep}`)
	) {
		throw new SessionExportPathError();
	}
	let ancestor = dirname(candidate);
	while (true) {
		const resolvedAncestor = await realpath(ancestor).catch(() => undefined);
		if (resolvedAncestor) {
			if (resolvedAncestor !== canonicalRoot && !resolvedAncestor.startsWith(`${canonicalRoot}${sep}`)) {
				throw new SessionExportPathError();
			}
			break;
		}
		const parent = dirname(ancestor);
		if (parent === ancestor) throw new SessionExportPathError();
		ancestor = parent;
	}
	return candidate;
}

type SessionTreeEntry = Awaited<ReturnType<AgentConnection["getSessionTree"]>>["tree"][number]["entry"];

export function findSessionTreeEntry(
	nodes: Awaited<ReturnType<AgentConnection["getSessionTree"]>>["tree"],
	entryId: string,
): SessionTreeEntry | undefined {
	for (const node of nodes) {
		if (node.entry.id === entryId) return node.entry;
		const nested = findSessionTreeEntry(node.children, entryId);
		if (nested) return nested;
	}
	return undefined;
}

export function selectedTextFromSessionEntry(entry: SessionTreeEntry): string | undefined {
	if (entry.type !== "message" || entry.message.role !== "user") return undefined;
	const content = entry.message.content;
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

export function isUnresolvedPlaceholderModel(model: AgentConnectionModel | undefined): boolean {
	return model?.provider === "unknown" && model?.id === "unknown";
}

const SESSION_NOT_RESUMABLE_PATTERNS = [
	/session worker started without a root session/i,
	/requested session transcript is unavailable/i,
];

export function isSessionNotResumableError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return SESSION_NOT_RESUMABLE_PATTERNS.some((pattern) => pattern.test(message));
}

export function sessionSummaryIdentifiers(summary: SessionSummary): Array<string> {
	return [summary.id, summary.sessionId, summary.activeSessionId].flatMap((value) =>
		typeof value === "string" && value.length > 0 ? [value] : [],
	);
}

export function sessionSummaryParentIdentifiers(summary: SessionSummary): Array<string> {
	return [summary.parentSessionId, summary.parentActiveSessionId].flatMap((value) =>
		typeof value === "string" && value.length > 0 ? [value] : [],
	);
}

export function sessionSummaryPath(summary: SessionSummary): string | undefined {
	return typeof summary.sessionFile === "string" && summary.sessionFile.length > 0
		? resolve(summary.sessionFile)
		: undefined;
}

export function sessionSummaryParentPaths(summary: SessionSummary): Array<string> {
	return [summary.parentSessionPath].flatMap((value) =>
		typeof value === "string" && value.length > 0 ? [resolve(value)] : [],
	);
}

export function hasSessionLineage(
	candidate: SessionSummary,
	rootIdentifiers: ReadonlySet<string>,
	rootPaths: ReadonlySet<string>,
	sessionsByIdentifier: ReadonlyMap<string, SessionSummary>,
	sessionsByPath: ReadonlyMap<string, SessionSummary>,
): boolean {
	const pending: SessionSummary[] = [candidate];
	const visited = new Set<SessionSummary>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		for (const parentId of sessionSummaryParentIdentifiers(current)) {
			if (rootIdentifiers.has(parentId)) return true;
			const parent = sessionsByIdentifier.get(parentId);
			if (parent && !visited.has(parent)) pending.push(parent);
		}
		for (const parentPath of sessionSummaryParentPaths(current)) {
			if (rootPaths.has(parentPath)) return true;
			const parent = sessionsByPath.get(parentPath);
			if (parent && !visited.has(parent)) pending.push(parent);
		}
	}
	return false;
}

export async function sessionLineagePaths(sessionPath: string): Promise<ReadonlySet<string>> {
	const paths = new Set<string>();
	let currentPath = resolve(sessionPath);
	while (!paths.has(currentPath)) {
		paths.add(currentPath);
		try {
			const parentSession = (await readLegacySession(currentPath))?.header.parentSession;
			if (!parentSession) break;
			currentPath = resolve(dirname(currentPath), parentSession);
		} catch {
			break;
		}
	}
	return paths;
}

export type RlmLineage = {
	sessionsByIdentifier: ReadonlyMap<string, SessionSummary>;
	sessionsByPath: ReadonlyMap<string, SessionSummary>;
	rootIdentifiers: ReadonlySet<string>;
	rootPaths: ReadonlySet<string>;
};

export async function resolveRlmLineage(
	sessions: SessionSummary[],
	rootSessionId: string,
	rootSessionPath: string,
): Promise<RlmLineage> {
	const sessionsByIdentifier = new Map<string, SessionSummary>();
	const sessionsByPath = new Map<string, SessionSummary>();
	for (const session of sessions) {
		for (const identifier of sessionSummaryIdentifiers(session)) {
			if (!sessionsByIdentifier.has(identifier)) sessionsByIdentifier.set(identifier, session);
		}
		const path = sessionSummaryPath(session);
		if (path && !sessionsByPath.has(path)) sessionsByPath.set(path, session);
	}
	const rootIdentifiers = new Set([rootSessionId]);
	const rootPaths = new Set(await sessionLineagePaths(rootSessionPath));
	const rootSummary = sessionsByIdentifier.get(rootSessionId);
	if (rootSummary) {
		for (const identifier of sessionSummaryIdentifiers(rootSummary)) rootIdentifiers.add(identifier);
		for (const path of sessionSummaryParentPaths(rootSummary)) rootPaths.add(path);
	}
	for (const rootPath of rootPaths) {
		const rootAncestor = sessionsByPath.get(rootPath);
		if (!rootAncestor) continue;
		for (const identifier of sessionSummaryIdentifiers(rootAncestor)) rootIdentifiers.add(identifier);
	}
	return { sessionsByIdentifier, sessionsByPath, rootIdentifiers, rootPaths };
}

export function rlmChildStatusOverride(summary: SessionSummary): RlmChildStatusOverride {
	const status =
		summary.statusLabel === "failed" || summary.workerState === "failed"
			? "failed"
			: summary.statusLabel === "recovering" || summary.workerState === "recovering"
				? "recovering"
				: undefined;
	const lastHeardFrom = summary.lastHeardFromAt ? Date.parse(summary.lastHeardFromAt) : Number.NaN;
	return {
		...(status ? { status } : {}),
		...(Number.isFinite(lastHeardFrom) ? { lastHeardFrom } : {}),
	};
}

export function effectiveRlmChildStatus(
	child: PrimeAgentRlmChild,
	summary: SessionSummary,
): PrimeAgentRlmChild["status"] {
	return rlmChildStatusOverride(summary).status ?? child.status;
}
