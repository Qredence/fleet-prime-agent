/**
 * PrimeBridge — central server-side session coordinator.
 *
 * Owns:
 * - daemon-backed `AgentConnection` instances (one per session) keyed by
 *   persisted `sessionId`
 * - the web dialog registry and event forwarder (SSE replay source)
 * - Fleet-only presentation sidecars and the kernel readiness gate
 *
 * The daemon is the sole active session writer. The bridge is only a headless
 * client of the public `AgentConnection` seam; the in-process adapter is
 * available only through an explicit test factory.
 *
 * No HTTP, no React — pure TypeScript. The route layer calls into this only.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ProjectId } from "@prime-agent/web-protocol";
import {
	buildOpenUIPrompt,
	type ChatMessage,
	type ChatMode,
	type ChatPendingDialog,
	type ChatPlanAction,
	type ChatQuestionAnswer,
	type ChatServiceTier,
	type ChatStreamEvent,
	type ChatThinkingLevel,
	type OpenUIPromptMode,
	type PrimeAgentArtifact,
	type PrimeAgentSessionPresentation,
	type PrimeAgentUserBash,
} from "@prime-agent/web-protocol";
import type {
	AgentConnection,
	AgentConnectionExtensionUiRequest,
	AgentConnectionModel,
	AgentSession,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
} from "prime-agent";
import { IpythonKernelProvisioner, SessionManager } from "prime-agent";
import {
	createDaemonWebAgentConnection,
	deleteDaemonSavedSession,
	listDaemonSessions,
	sessionDirectoryForCwd,
	type WebAgentConnection,
	type WebAgentConnectionFactory,
} from "./daemon-runtime";
import {
	createEventMapperState,
	mapAgentConnectionEvent,
	normalizeDaemonQuestions,
	normalizedQuestionsToClarification,
	normalizedQuestionsToWire,
	toChatMessagesFromAgentMessages,
} from "./event-mapper";
import { deleteManagedAttachmentsForSession } from "./managed-attachments";
import {
	copyManagedPlanPresentationsForFork,
	deleteManagedPlanPresentationsForSession,
} from "./managed-plan-presentations";
import { PendingDialogRegistry } from "./pending-dialogs";
import {
	createEmptyPrimeAgentSessionPresentation,
	loadManagedPrimePresentation,
	stablePresentationId,
	upsertArtifact,
	writeManagedPrimePresentation,
} from "./prime-agent-presentation";
import { getPrimeConfig } from "./prime-config";
import { RingBuffer } from "./ring-buffer";
import { parseBackendSessionCommand } from "./session-commands";

// ---------------------------------------------------------------------------
// Web UI context — a thin ExtensionUIContext backed by PendingDialogRegistry
// ---------------------------------------------------------------------------

const WEB_UI_UNSUPPORTED = "Not available in the web UI";

function unsupportedInWebUi(method: string): never {
	throw new Error(`${method}: ${WEB_UI_UNSUPPORTED}`);
}

type UIContextCtorArgs = {
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
function createWebUIContext({ sessionId, emitFrame, dialogs }: UIContextCtorArgs): ExtensionUIContext {
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

// ---------------------------------------------------------------------------
// Bridge types
// ---------------------------------------------------------------------------

export interface BridgeSession {
	readonly sessionId: string;
	readonly projectId: ProjectId | null;
	readonly cwd: string;
	readonly sessionPath: string;
	/**
	 * The only runtime entry point the bridge itself routes through.
	 * Owned by the bridge; do not store references outside the bridge.
	 */
	readonly connection: AgentConnection;
	/** Only populated by the explicit in-process test adapter. */
	readonly session?: AgentSession;
	readonly setOpenUIPrompt?: WebAgentConnection["setOpenUIPrompt"];
	readonly terminate?: WebAgentConnection["terminate"];
	readonly deleteSessionFile?: WebAgentConnection["deleteSessionFile"];
	/** Cached connection state used by synchronous HTTP admission helpers. */
	isStreaming: boolean;
	readonly openUIPrompt: OpenUIPromptSessionState;
	readonly mapperState: ReturnType<typeof createEventMapperState>;
	readonly uiContext: ExtensionUIContext;
	readonly unsubscribe: () => void;
}

export interface CreateSessionOptions {
	readonly cwd: string;
	readonly projectId?: ProjectId | null;
	readonly thinkingLevel?: ThinkingLevel;
	readonly mode?: ChatMode;
	readonly openUI?: boolean;
}

export type BridgeEventListener = (sessionId: string, frame: ChatStreamEvent) => void;

export interface ForkSessionResult {
	cancelled: boolean;
	selectedText?: string;
	newSessionId: string;
}

export interface RlmChildTranscript {
	readonly sessionId: string;
	readonly projectId: ProjectId | null;
	readonly messages: Array<ChatMessage>;
	readonly presentation: PrimeAgentSessionPresentation;
}

export interface PrimeBridgeOptions {
	readonly kernelTimeoutMs?: number;
	readonly ringBufferCapacity?: number;
	readonly dialogTimeoutMs?: number;
	readonly writePresentation?: typeof writeManagedPrimePresentation;
	/** Test seam; production always uses the shared Prime daemon. */
	readonly connectionFactory?: WebAgentConnectionFactory;
	/** Test seam for session discovery; production always uses the shared daemon. */
	readonly sessionLister?: typeof listDaemonSessions;
	/** Test seam for catalog deletion; production always uses the shared daemon. */
	readonly sessionFileDeleter?: typeof deleteDaemonSavedSession;
}

type KernelReadySnapshot = { ok: true } | { ok: false; reason: string };

export type OpenUIPromptSessionState = {
	enabled: boolean;
	mode: OpenUIPromptMode;
	prompt: string;
	artifact?: boolean;
};

function createOpenUIPromptSessionState(
	mode: OpenUIPromptMode = "agent",
	enabled = false,
	artifact = false,
): OpenUIPromptSessionState {
	return { enabled, mode, artifact, prompt: buildOpenUIPrompt(mode, { artifact }) };
}

function resolveOpenUIPromptMode(mode?: ChatMode, planAction?: ChatPlanAction): OpenUIPromptMode {
	if (planAction === "execute") return "plan-execution";
	if (planAction === "refine") return "plan";
	return mode ?? "agent";
}

function persistedBashStatus(message: Record<string, unknown>): PrimeAgentUserBash["status"] {
	if (message.cancelled === true) return "cancelled";
	if (message.errorMessage || (typeof message.exitCode === "number" && message.exitCode !== 0)) return "error";
	return "success";
}

function presentationArtifactsEqual(left: PrimeAgentArtifact, right: PrimeAgentArtifact): boolean {
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

function initialPresentationForSession(
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

// ---------------------------------------------------------------------------
// Per-session cached surface (keeps the public bridge API synchronous)
// ---------------------------------------------------------------------------

/**
 * BridgeSessionCache — cached subset of the connection state used by the
 * sync bridge methods. The AgentConnection API is async; the chat-command
 * handler (out of this PR's scope) calls these methods synchronously, so the
 * bridge maintains a fresh-enough cache and refreshes it on every
 * `session_replaced` and the relevant `session_event` mutations.
 */
interface BridgeSessionCache {
	sessionName: string | undefined;
	thinkingLevel: ThinkingLevel | undefined;
	serviceTier: ChatServiceTier | undefined;
	systemPrompt: string;
	contextUsage: unknown;
	tree: { tree: unknown[]; leafId: string | null } | undefined;
	isStreaming: boolean;
}

function emptyCache(): BridgeSessionCache {
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

async function refreshCache(connection: AgentConnection): Promise<BridgeSessionCache> {
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

function fallbackSessionPath(connectionState: Awaited<ReturnType<AgentConnection["getState"]>>, cwd: string): string {
	if (connectionState.sessionFile) return resolve(connectionState.sessionFile);
	const sessionDir = connectionState.sessionDir ?? sessionDirectoryForCwd(cwd);
	return resolve(sessionDir, `${connectionState.sessionId}.jsonl`);
}

type SessionTreeEntry = Awaited<ReturnType<AgentConnection["getSessionTree"]>>["tree"][number]["entry"];

function findSessionTreeEntry(
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

function selectedTextFromSessionEntry(entry: SessionTreeEntry): string | undefined {
	if (entry.type !== "message" || entry.message.role !== "user") return undefined;
	const content = entry.message.content;
	if (typeof content === "string") return content;
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/**
 * prime-agent falls back to an `unknown/unknown` placeholder model when no
 * real model can be resolved (e.g. no provider auth configured). Attempting
 * to carry that placeholder over to a forked session makes `setModel` throw
 * "Model not found"; skip it so the fork resolves its own default.
 */
function isUnresolvedPlaceholderModel(model: AgentConnectionModel | undefined): boolean {
	return model?.provider === "unknown" && model?.id === "unknown";
}

/**
 * The daemon reports free-form strings for transcripts it cannot resume (a
 * worker that starts without a persisted root session, a transcript that
 * vanished after listing). Shape-match them like the transport patterns in
 * `wrap-api-handler` so a listed-but-unresumable session flows into the
 * handlers' existing 404 branches instead of surfacing as a generic 500.
 */
const SESSION_NOT_RESUMABLE_PATTERNS = [
	/session worker started without a root session/i,
	/requested session transcript is unavailable/i,
];

function isSessionNotResumableError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return SESSION_NOT_RESUMABLE_PATTERNS.some((pattern) => pattern.test(message));
}

function sessionSummaryIdentifiers(summary: Record<string, unknown>): Array<string> {
	return ["id", "sessionId", "activeSessionId"].flatMap((key) => {
		const value = summary[key];
		return typeof value === "string" && value.length > 0 ? [value] : [];
	});
}

function sessionSummaryParentIdentifiers(summary: Record<string, unknown>): Array<string> {
	return ["parentSessionId", "parentActiveSessionId"].flatMap((key) => {
		const value = summary[key];
		return typeof value === "string" && value.length > 0 ? [value] : [];
	});
}

/** Follow daemon lineage metadata so nested RLM children remain authorized. */
function hasSessionLineage(
	candidate: Record<string, unknown>,
	rootSessionId: string,
	sessionsByIdentifier: ReadonlyMap<string, Record<string, unknown>>,
): boolean {
	const pending = [candidate];
	const visited = new Set<Record<string, unknown>>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || visited.has(current)) continue;
		visited.add(current);
		for (const parentId of sessionSummaryParentIdentifiers(current)) {
			if (parentId === rootSessionId) return true;
			const parent = sessionsByIdentifier.get(parentId);
			if (parent && !visited.has(parent)) pending.push(parent);
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
// PrimeBridge
// ---------------------------------------------------------------------------

export class PrimeBridge {
	readonly #sessions = new Map<string, BridgeSession>();
	readonly #listeners = new Set<BridgeEventListener>();
	readonly #ringBuffers = new Map<string, RingBuffer>();
	readonly #dialogs: PendingDialogRegistry;
	readonly #kernelTimeoutMs: number;
	readonly #ringBufferCapacity: number;
	readonly #presentationWrites = new Map<string, Promise<void>>();
	readonly #presentationGenerations = new Map<string, number>();
	readonly #writePresentation: typeof writeManagedPrimePresentation;
	readonly #connectionFactory: WebAgentConnectionFactory;
	readonly #sessionLister: typeof listDaemonSessions;
	readonly #sessionFileDeleter: typeof deleteDaemonSavedSession;
	readonly #caches = new Map<string, BridgeSessionCache>();
	readonly #openUIPromptTransitions = new Map<string, Promise<void>>();
	readonly #daemonDialogs = new Map<string, { connection: AgentConnection; method: string }>();
	readonly #auxiliaryWarnings = new Set<string>();
	#kernelReadyByCwd = new Map<string, Promise<void>>();
	#kernelStateByCwd = new Map<string, KernelReadySnapshot>();

	constructor(options: PrimeBridgeOptions = {}) {
		this.#kernelTimeoutMs = options.kernelTimeoutMs ?? 30_000;
		this.#ringBufferCapacity = options.ringBufferCapacity ?? 500;
		this.#writePresentation = options.writePresentation ?? writeManagedPrimePresentation;
		this.#connectionFactory = options.connectionFactory ?? createDaemonWebAgentConnection;
		this.#sessionLister = options.sessionLister ?? listDaemonSessions;
		this.#sessionFileDeleter = options.sessionFileDeleter ?? deleteDaemonSavedSession;
		this.#dialogs = new PendingDialogRegistry({
			defaultTimeoutMs: options.dialogTimeoutMs ?? 60_000,
			emitFrame: (sessionId, frame) => this.#dispatch(sessionId, frame),
		});
	}

	/** Late-boot kernel readiness gate. Boot-time callers await this; failures cause `/api/chat` to 503. */
	async ensureKernelReady(cwd?: string): Promise<void> {
		const key = resolve(cwd ?? process.cwd());
		const existing = this.#kernelReadyByCwd.get(key);
		if (existing) return existing;
		this.#kernelStateByCwd.set(key, { ok: false, reason: "pending" });
		const ready = (async () => {
			// IpythonKernelProvisioner takes the session's cwd; for the boot-time
			// readiness gate we use the server's working directory as a probe.
			const provisioner = new IpythonKernelProvisioner(key);
			const timeout = new Promise<never>((_r, reject) =>
				setTimeout(() => reject(new Error("IPython kernel bootstrap timeout")), this.#kernelTimeoutMs),
			);
			await Promise.race([provisioner.ensure(), timeout]);
		})();
		this.#kernelReadyByCwd.set(key, ready);
		void ready.then(
			() => {
				this.#kernelStateByCwd.set(key, { ok: true });
			},
			(error: unknown) => {
				this.#kernelStateByCwd.set(key, {
					ok: false,
					reason: error instanceof Error ? error.message : String(error),
				});
			},
		);
		return ready;
	}

	kernelReadyState(cwd?: string): { ok: boolean; reason?: string } {
		return this.#kernelStateByCwd.get(resolve(cwd ?? process.cwd())) ?? { ok: false, reason: "not-started" };
	}

	addEventListener(listener: BridgeEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Emit a frame to ring buffer (SSE replay) and all live listeners. */
	#dispatch(sessionId: string, frame: ChatStreamEvent): void {
		const next = frame.type === "done" && !(frame.sessionId ?? "").trim() ? { ...frame, sessionId } : frame;
		const buffer = this.#ringBuffers.get(sessionId);
		if (buffer) {
			buffer.push(next);
		}
		for (const listener of this.#listeners) {
			listener(sessionId, next);
		}
	}

	#ringBufferFor(sessionId: string): RingBuffer {
		let existing = this.#ringBuffers.get(sessionId);
		if (!existing) {
			existing = new RingBuffer(this.#ringBufferCapacity);
			this.#ringBuffers.set(sessionId, existing);
		}
		return existing;
	}

	/** Replay buffered frames since `lastEventId`. */
	replaySince(
		sessionId: string,
		lastEventId: number,
	): { replayed: readonly { seq: number; event: unknown }[]; overflowed: boolean } {
		const buffer = this.#ringBufferFor(sessionId);
		return buffer.replaySince(lastEventId);
	}

	/** Test-only: reset state. */
	resetForTests(): void {
		for (const session of this.#sessions.values()) {
			session.unsubscribe();
			void session.connection.dispose().catch(() => undefined);
		}
		this.#sessions.clear();
		this.#listeners.clear();
		this.#ringBuffers.clear();
		this.#presentationWrites.clear();
		this.#presentationGenerations.clear();
		this.#caches.clear();
		this.#openUIPromptTransitions.clear();
		this.#daemonDialogs.clear();
		this.#auxiliaryWarnings.clear();
		this.#kernelReadyByCwd.clear();
		this.#kernelStateByCwd.clear();
	}

	// -----------------------------------------------------------------------
	// Session lifecycle
	// -----------------------------------------------------------------------

	async createSession(options: CreateSessionOptions): Promise<BridgeSession> {
		// Don't block session creation on the IPython kernel — kernel readiness is
		// lazily awaited by the ipython tool itself (and only on first use).
		// Booting kernel takes ~30s on a cold venv and the user shouldn't wait
		// behind a UI dialog for it. Fire-and-forget the prewarm so the kernel is
		// warm by the time the agent emits its first tool call.
		void this.ensureKernelReady(options.cwd).catch(() => {
			/* backgrounded; failures surface on first tool use */
		});
		const webAgent = await this.#connectionFactory({
			cwd: options.cwd,
			openUIPrompt: createOpenUIPromptSessionState(resolveOpenUIPromptMode(options.mode), options.openUI === true),
			...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
		});
		return this.#registerConnection(
			webAgent,
			options.cwd,
			undefined,
			options.projectId ?? (await getPrimeConfig().projectRegistry.projectIdForCwd(options.cwd)),
		);
	}

	#handleDaemonExtensionUiRequest(
		sessionId: string,
		connection: AgentConnection,
		request: AgentConnectionExtensionUiRequest,
	): boolean {
		const title = typeof request.payload.title === "string" ? request.payload.title : "Prime Agent asks";
		const timeoutMs = typeof request.payload.timeout === "number" ? request.payload.timeout : undefined;
		const options = Array.isArray(request.payload.options)
			? request.payload.options.filter((option): option is string => typeof option === "string")
			: undefined;
		const message = typeof request.payload.message === "string" ? request.payload.message : "";
		const placeholder =
			typeof request.payload.placeholder === "string"
				? request.payload.placeholder
				: typeof request.payload.prefill === "string"
					? request.payload.prefill
					: undefined;

		if (request.method === "notify") {
			this.#dispatch(sessionId, {
				type: "state",
				state: {
					name: "agent_start",
					message: message || title,
				},
			});
			return true;
		}
		if (request.method === "setStatus") {
			this.#dispatch(sessionId, {
				type: "state",
				state: {
					name: "agent_start",
					message: `[${typeof request.payload.statusKey === "string" ? request.payload.statusKey : "status"}] ${typeof request.payload.statusText === "string" ? request.payload.statusText : ""}`,
				},
			});
			return true;
		}

		const normalizedQuestions = normalizeDaemonQuestions(request.payload.questions);
		const registryQuestions = normalizedQuestionsToClarification(normalizedQuestions);
		const wireQuestions = normalizedQuestionsToWire(normalizedQuestions);

		const hasQuestions =
			request.method === "questions" ||
			request.method === "ask_question" ||
			Boolean(registryQuestions && registryQuestions.length > 0);

		if (
			!hasQuestions &&
			request.method !== "select" &&
			request.method !== "confirm" &&
			request.method !== "input" &&
			request.method !== "editor"
		) {
			return false;
		}

		const kind = hasQuestions
			? "questions"
			: request.method === "select"
				? "select"
				: request.method === "confirm"
					? "confirm"
					: "input";
		this.#daemonDialogs.set(request.id, { connection, method: request.method });
		const pending = this.#dialogs.open<unknown>({
			sessionId,
			toolCallId: request.id,
			kind,
			title,
			message,
			...(options ? { options } : {}),
			...(registryQuestions ? { questions: registryQuestions } : {}),
			...(placeholder ? { placeholder } : {}),
			...(timeoutMs !== undefined ? { timeoutMs } : {}),
			signalFrame: {
				type: "tool-Question",
				toolCallId: request.id,
				state: "input-streaming",
				input: {
					kind: hasQuestions
						? "questions"
						: request.method === "select"
							? "select"
							: request.method === "confirm"
								? "confirm"
								: "text",
					title,
					...(message ? { message } : {}),
					...(options ? { options } : {}),
					...(wireQuestions ? { questions: wireQuestions } : {}),
					...(placeholder ? { placeholder } : {}),
					method: request.method,
				},
			},
		});
		void pending
			.then((value) => {
				if (request.method === "confirm") {
					return connection.respondToExtensionUiRequest(request.id, { confirmed: Boolean(value) });
				}
				if (hasQuestions) {
					if (value && typeof value === "object") {
						return connection.respondToExtensionUiRequest(request.id, {
							value: JSON.stringify(value),
						});
					}
					return connection.respondToExtensionUiRequest(request.id, {
						value: typeof value === "string" ? value : "",
					});
				}
				const text =
					value && typeof value === "object" && "choice" in value
						? (value as { choice?: unknown }).choice
						: value && typeof value === "object" && "choices" in value
							? (value as { choices?: unknown }).choices
							: value && typeof value === "object" && "text" in value
								? (value as { text?: unknown }).text
								: undefined;
				return connection.respondToExtensionUiRequest(request.id, {
					value: typeof text === "string" ? text : Array.isArray(text) ? text.join(",") : "",
				});
			})
			.catch(() => connection.respondToExtensionUiRequest(request.id, { cancelled: true }).catch(() => undefined))
			.finally(() => this.#daemonDialogs.delete(request.id));
		return true;
	}

	/**
	 * Shared registration path for every session the bridge owns (create, resume,
	 * fork). Binds the web UI context, subscribes to `AgentConnectionEvent`,
	 * forwards frames into the ring buffer, and tracks the session in
	 * `#sessions`.
	 */
	async #registerConnection(
		webAgent: WebAgentConnection,
		cwd: string,
		sessionPathHint?: string,
		projectId?: ProjectId | null,
	): Promise<BridgeSession> {
		const { connection, openUIPrompt } = webAgent;
		const state = await connection.getState();
		const sessionId = state.sessionId;
		const sessionCwd = state.cwd || cwd;
		const sessionPath = resolve(state.sessionFile ?? sessionPathHint ?? fallbackSessionPath(state, sessionCwd));
		const resolvedProjectId =
			projectId ?? (await getPrimeConfig().projectRegistry.projectIdForSession(sessionId, sessionCwd));
		await getPrimeConfig().projectRegistry.assignSession(sessionId, resolvedProjectId);
		const uiContext = createWebUIContext({
			sessionId,
			emitFrame: (frame) => this.#dispatch(sessionId, frame),
			dialogs: this.#dialogs,
		});
		await webAgent.bindUiContext?.(uiContext);

		const initialMessages = await connection.getMessages();
		const cache = await refreshCache(connection);
		this.#caches.set(sessionId, cache);
		const persistedPresentation = await loadManagedPrimePresentation({ sessionPath });
		const mapperState = createEventMapperState({
			sessionId,
			presentation: initialPresentationForSession(
				initialMessages,
				cache.sessionName,
				(cache.thinkingLevel ?? "off") as ChatThinkingLevel,
				cache.serviceTier,
				undefined,
				sessionId,
				persistedPresentation,
			),
		});

		const unsubscribe = connection.subscribe((event) => {
			if (event.type === "extension_ui_request" && !webAgent.bindUiContext) {
				if (this.#handleDaemonExtensionUiRequest(sessionId, connection, event.request)) return;
			}
			if (event.type === "session_event" && event.event.type === "compaction_end") {
				// Compaction rewrites the transcript prefix, shifting the positional
				// `${sessionId}-mN` ids the plan sidecar keys on. Invalidate records
				// rather than let them rebind to unrelated messages.
				void deleteManagedPlanPresentationsForSession(sessionId, sessionPath).catch(() => undefined);
			}
			if (event.type === "session_replaced" || event.type === "session_resynced") {
				// The runtime rebuilt; refresh the cache from the new session state.
				void refreshCache(connection)
					.then((next) => {
						this.#caches.set(sessionId, next);
						const current = this.#sessions.get(sessionId);
						if (current) current.isStreaming = next.isStreaming;
					})
					.catch(() => undefined);
			}
			if (event.type === "session_event") {
				const current = this.#sessions.get(sessionId);
				if (current && (event.event.type === "agent_start" || event.event.type === "turn_start")) {
					current.isStreaming = true;
				} else if (current && (event.event.type === "agent_end" || event.event.type === "turn_end")) {
					current.isStreaming = false;
				}
			}
			if (process.env.PRIME_BRIDGE_DEBUG === "1") {
				try {
					process.stderr.write(
						`[bridge:${sessionId.slice(0, 8)}] conn-event ${event.type} ${JSON.stringify(event).slice(0, 200)}\n`,
					);
				} catch {
					/* ignore */
				}
			}
			const frames = mapAgentConnectionEvent(mapperState, event);
			for (const frame of frames) {
				if (frame.type === "presentation") this.#persistPresentation(sessionId, sessionPath, frame.presentation);
				this.#dispatch(sessionId, frame);
			}
		});
		const bridgeSession: BridgeSession = {
			sessionId,
			projectId: resolvedProjectId,
			cwd: sessionCwd,
			sessionPath,
			connection,
			session: webAgent.session,
			setOpenUIPrompt: webAgent.setOpenUIPrompt,
			terminate: webAgent.terminate,
			deleteSessionFile: webAgent.deleteSessionFile,
			isStreaming: cache.isStreaming,
			openUIPrompt,
			mapperState,
			uiContext,
			unsubscribe,
		};

		this.#sessions.set(sessionId, bridgeSession);
		this.#ringBufferFor(sessionId); // Pre-create so SSE attaches safely.
		this.#persistPresentation(sessionId, sessionPath, mapperState.presentation);
		return bridgeSession;
	}

	#persistPresentation(
		sessionId: string,
		sessionPath: string,
		presentation: PrimeAgentSessionPresentation,
	): Promise<void> {
		const generation = this.#presentationGenerations.get(sessionId) ?? 0;
		const previous = this.#presentationWrites.get(sessionId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(() => {
				const live = this.#sessions.get(sessionId);
				if (
					live?.sessionPath !== sessionPath ||
					(this.#presentationGenerations.get(sessionId) ?? 0) !== generation
				) {
					return;
				}
				return this.#writePresentation({ sessionPath }, presentation);
			})
			.catch(() => {
				if (this.#auxiliaryWarnings.has(sessionId)) return;
				this.#auxiliaryWarnings.add(sessionId);
				this.#dispatch(sessionId, {
					type: "state",
					state: {
						name: "agent_start",
						message:
							"Some Fleet session details could not be saved. Your transcript is safe; they will be retried later.",
					},
				});
			});
		this.#presentationWrites.set(sessionId, next);
		void next.finally(() => {
			if (this.#presentationWrites.get(sessionId) === next) this.#presentationWrites.delete(sessionId);
		});
		return next;
	}

	/** Hot-lookup by id; reuse the live session if we already have one loaded. */
	getSession(sessionId: string): BridgeSession | undefined {
		return this.#sessions.get(sessionId);
	}

	/** Resume a persisted prime-agent session from its JSONL transcript. */
	async resumeSessionByPath(sessionPath: string, options?: { readonly openUI?: boolean }): Promise<BridgeSession> {
		const resolvedSessionPath = resolve(sessionPath);
		// If a live session already owns this path, reuse it.
		for (const [sessionId, session] of this.#sessions) {
			if (resolve(session.sessionPath) === resolvedSessionPath) {
				return this.#sessions.get(sessionId)!;
			}
		}
		if (!existsSync(resolvedSessionPath)) throw new Error("The requested session transcript is unavailable");
		const sessionManager = await SessionManager.openAsync(resolvedSessionPath);
		const sessionCwd = sessionManager.getCwd();
		const expectedSessionDir = resolve(sessionDirectoryForCwd(sessionCwd));
		if (dirname(resolvedSessionPath) !== expectedSessionDir) {
			throw new Error("The requested session is outside the configured Prime session store");
		}
		const webAgent = await this.#connectionFactory({
			cwd: sessionCwd,
			sessionPath: resolvedSessionPath,
			openUIPrompt: createOpenUIPromptSessionState("agent", options?.openUI === true),
		});
		return this.#registerConnection(
			webAgent,
			sessionCwd,
			resolvedSessionPath,
			await getPrimeConfig().projectRegistry.projectIdForSession(sessionManager.getSessionId(), sessionCwd),
		);
	}

	async resumeSessionById(
		sessionId: string,
		requestedProjectId?: ProjectId | null,
		options?: { readonly openUI?: boolean },
	): Promise<BridgeSession | undefined> {
		const live = this.#sessions.get(sessionId);
		if (live) {
			if (requestedProjectId && live.projectId !== requestedProjectId) {
				const forkedId = await this.forkSessionIntoProject(sessionId, requestedProjectId);
				return this.#requireSession(forkedId);
			}
			return live;
		}
		const all = await this.#sessionLister();
		const match = all.find((info) => info.sessionId === sessionId || info.id === sessionId);
		if (!match) return undefined;
		if (!match.sessionFile) return undefined;
		let resumed: BridgeSession;
		try {
			resumed = await this.resumeSessionByPath(match.sessionFile, options);
		} catch (error) {
			// A listed transcript the runtime cannot resume is an unknown session
			// for the caller, not a server failure.
			if (isSessionNotResumableError(error)) return undefined;
			throw error;
		}
		if (requestedProjectId && resumed.projectId !== requestedProjectId) {
			const forkedId = await this.forkSessionIntoProject(resumed.sessionId, requestedProjectId);
			return this.#requireSession(forkedId);
		}
		return resumed;
	}

	async listSessions(cwd?: string) {
		return this.#sessionLister(cwd);
	}

	/**
	 * Load a completed RLM child without resuming it as a live session.
	 *
	 * Child transcripts can be stored outside the parent's configured session
	 * directory. Authorization is therefore based on both the live parent's
	 * presentation and the daemon's lineage metadata, never on a browser-
	 * supplied filesystem path.
	 */
	async loadRlmChildTranscript(parentSessionId: string, childId: string): Promise<RlmChildTranscript | undefined> {
		const parent = this.#sessions.get(parentSessionId);
		if (!parent || !parent.mapperState.presentation.rlmChildren.some((child) => child.id === childId)) {
			return undefined;
		}

		const sessions = await this.#sessionLister();
		const sessionRecords = sessions.map((candidate) => candidate as unknown as Record<string, unknown>);
		const sessionsByIdentifier = new Map<string, Record<string, unknown>>();
		for (const record of sessionRecords) {
			for (const identifier of sessionSummaryIdentifiers(record)) {
				if (!sessionsByIdentifier.has(identifier)) sessionsByIdentifier.set(identifier, record);
			}
		}
		const child = sessions.find((candidate) => {
			const raw = candidate as unknown as Record<string, unknown>;
			return (
				raw.rlmChildId === childId &&
				typeof raw.sessionFile === "string" &&
				hasSessionLineage(raw, parentSessionId, sessionsByIdentifier)
			);
		});
		if (!child?.sessionFile) return undefined;

		const sessionManager = await SessionManager.openAsync(child.sessionFile);
		const sessionId = sessionManager.getSessionId();
		if (sessionId !== child.sessionId && sessionId !== child.id) return undefined;

		const agentMessages = sessionManager.buildSessionContext().messages;
		const messages = toChatMessagesFromAgentMessages(agentMessages, sessionId);
		const persistedPresentation = await loadManagedPrimePresentation({ sessionPath: child.sessionFile });
		const presentation = initialPresentationForSession(
			agentMessages,
			undefined,
			undefined,
			undefined,
			undefined,
			sessionId,
			persistedPresentation,
		);
		const projectId = await getPrimeConfig().projectRegistry.projectIdForSession(sessionId, sessionManager.getCwd());

		return { sessionId, projectId, messages, presentation };
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		let existing = this.#sessions.get(sessionId);
		if (!existing) {
			const sessions = await this.#sessionLister();
			const listed = sessions.find((session) => session.sessionId === sessionId || session.id === sessionId);
			const sessionPath = listed?.sessionFile;
			if (!sessionPath) return false;
			try {
				existing = await this.resumeSessionByPath(sessionPath);
			} catch (error) {
				if (!isSessionNotResumableError(error)) throw error;
				// The transcript is listed but cannot be resumed. Delete it through
				// the daemon catalog so a broken entry never becomes undeletable.
				const result = await this.#sessionFileDeleter(getPrimeConfig().defaultCwd, sessionPath);
				if (!result.ok) throw new Error(result.error);
				// Mirror the managed-session cleanup from the live path below.
				const listedSessionId = listed?.sessionId ?? sessionId;
				await deleteManagedAttachmentsForSession(listedSessionId, sessionPath);
				await deleteManagedPlanPresentationsForSession(listedSessionId, sessionPath);
				await getPrimeConfig().projectRegistry.assignSession(listedSessionId, null);
				return true;
			}
		}
		const sessionPath = existing.sessionPath;
		this.#presentationGenerations.set(
			existing.sessionId,
			(this.#presentationGenerations.get(existing.sessionId) ?? 0) + 1,
		);
		const pendingPresentationWrite = this.#presentationWrites.get(existing.sessionId);
		await pendingPresentationWrite?.catch(() => undefined);
		if (this.#presentationWrites.get(existing.sessionId) === pendingPresentationWrite) {
			this.#presentationWrites.delete(existing.sessionId);
		}
		this.#dialogs.cancelAll(existing.sessionId, "server-shutdown");
		existing.unsubscribe();
		await existing.connection.abort().catch(() => undefined);
		await this.#openUIPromptTransitions.get(existing.sessionId)?.catch(() => undefined);
		try {
			await existing.terminate?.();
			const result = await (existing.deleteSessionFile?.(sessionPath) ??
				existing.connection.deleteSavedSession(sessionPath));
			if (!result.ok) throw new Error(result.error);
		} finally {
			await existing.connection.dispose().catch(() => undefined);
			this.#sessions.delete(existing.sessionId);
			this.#ringBuffers.delete(existing.sessionId);
			this.#caches.delete(existing.sessionId);
			this.#openUIPromptTransitions.delete(existing.sessionId);
		}
		await deleteManagedAttachmentsForSession(existing.sessionId, sessionPath);
		await deleteManagedPlanPresentationsForSession(existing.sessionId, sessionPath);
		await getPrimeConfig().projectRegistry.assignSession(existing.sessionId, null);
		return true;
	}

	// -----------------------------------------------------------------------
	// Session actions
	// -----------------------------------------------------------------------

	async prompt(
		sessionId: string,
		text: string,
		options?: {
			images?: ImageContent[];
			streamingBehavior?: "steer" | "followUp";
			mode?: ChatMode;
			openUI?: boolean;
			openUIArtifact?: boolean;
			planAction?: ChatPlanAction;
		},
	): Promise<void> {
		const session = this.#requireSession(sessionId);
		const backendSessionCommand = parseBackendSessionCommand(text);
		const openUIEnabled = options?.openUI === true;
		const openUIMode = resolveOpenUIPromptMode(options?.mode, options?.planAction);
		const openUIArtifact = options?.openUIArtifact === true;
		const openUIStateChanged =
			session.openUIPrompt.enabled !== openUIEnabled ||
			session.openUIPrompt.mode !== openUIMode ||
			(session.openUIPrompt.artifact ?? false) !== openUIArtifact;
		const hasPendingOpenUITransition = this.#openUIPromptTransitions.has(sessionId);
		const wasStreaming = session.isStreaming;
		const promptOptions = {
			images: options?.images,
			streamingBehavior: options?.streamingBehavior,
			queueIfBusy: true,
		};

		if (!wasStreaming && (openUIStateChanged || hasPendingOpenUITransition)) {
			// Preserve the idle ordering: commit the prompt state before admitting
			// the next prompt. The transition queue also waits for an earlier active
			// prompt's safe-boundary reconfiguration.
			await this.#scheduleOpenUIPromptState(session, openUIEnabled, openUIMode, openUIArtifact);
		}
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			void (async () => {
				const state = await session.connection.getState().catch(() => undefined);
				process.stderr.write(
					`[bridge:${sessionId.slice(0, 8)}] prompt model=${state?.model?.provider ?? "?"}/${state?.model?.id ?? "?"} thinkingLevel=${state?.thinkingLevel ?? "?"}\n`,
				);
			})();
		}
		// `promptAndWait` mirrors the legacy `session.prompt(...)` semantics:
		// resolves when the turn settles (including any queued session commands).
		// The `queueIfBusy` flag keeps steer/followUp admission behavior
		// identical to the previous bridge. When a prompt is already streaming,
		// admit it before waiting for the OpenUI transition; the transition then
		// runs at the next safe idle boundary.
		let promptError: unknown;
		let promptFailed = false;
		try {
			await session.connection.promptAndWait(text, promptOptions);
			// For a session command (e.g. /refine) queued behind an active turn, wait
			// until input is idle so the HTTP stream can emit its terminal frame
			// after the command has actually run.
			if (backendSessionCommand) await session.connection.waitForIdle();
		} catch (error) {
			promptFailed = true;
			promptError = error;
		}
		if (wasStreaming && (openUIStateChanged || hasPendingOpenUITransition)) {
			await this.#scheduleOpenUIPromptState(session, openUIEnabled, openUIMode, openUIArtifact);
		}
		if (promptFailed) throw promptError;
	}

	#scheduleOpenUIPromptState(
		session: BridgeSession,
		enabled: boolean,
		mode: OpenUIPromptMode,
		artifact: boolean,
	): Promise<void> {
		const previous = this.#openUIPromptTransitions.get(session.sessionId) ?? Promise.resolve();
		const transition = previous
			.catch(() => undefined)
			.then(() => this.#setOpenUIPromptState(session, enabled, mode, artifact));
		this.#openUIPromptTransitions.set(session.sessionId, transition);
		void transition
			.finally(() => {
				if (this.#openUIPromptTransitions.get(session.sessionId) === transition) {
					this.#openUIPromptTransitions.delete(session.sessionId);
				}
			})
			.catch(() => undefined);
		return transition;
	}

	async #setOpenUIPromptState(
		session: BridgeSession,
		enabled: boolean,
		mode: OpenUIPromptMode,
		artifact = false,
	): Promise<void> {
		if (
			session.openUIPrompt.enabled === enabled &&
			session.openUIPrompt.mode === mode &&
			(session.openUIPrompt.artifact ?? false) === artifact
		)
			return;
		const previousPrompt = session.openUIPrompt.prompt;
		const nextPrompt = buildOpenUIPrompt(mode, { artifact });
		const nextState: OpenUIPromptSessionState = { enabled, mode, artifact, prompt: nextPrompt };
		if (session.setOpenUIPrompt) {
			await session.setOpenUIPrompt(nextState);
			const cache = this.#caches.get(session.sessionId) ?? emptyCache();
			const withoutPreviousPrompt = cache.systemPrompt.replace(previousPrompt, "").trim();
			cache.systemPrompt = enabled
				? `${withoutPreviousPrompt}${withoutPreviousPrompt ? "\n\n" : ""}${nextPrompt}`
				: withoutPreviousPrompt;
			this.#caches.set(session.sessionId, cache);
		} else if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			process.stderr.write(
				`[bridge:${session.sessionId.slice(0, 8)}] OpenUI prompt state changed but this connection cannot update prompts after creation; recreate the session to apply it\n`,
			);
		}
		session.openUIPrompt.enabled = enabled;
		session.openUIPrompt.mode = mode;
		session.openUIPrompt.artifact = artifact;
		session.openUIPrompt.prompt = nextPrompt;
	}

	async steer(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.connection.steer(text);
	}

	async followUp(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.connection.followUp(text);
	}

	async deleteQueuedMessage(
		sessionId: string,
		lane: "steering" | "followUp",
		index: number,
		expectedText: string,
	): Promise<{
		status: "applied" | "rejected" | "invalid" | "unsupported";
		queue: { steering: string[]; followUp: string[] };
	}> {
		const session = this.#requireSession(sessionId);
		const status = await session.connection.mutateQueuedMessage(lane, index, expectedText, { type: "delete" });
		const queue = await session.connection.getQueue();
		return {
			status,
			queue: {
				steering: [...queue.steering],
				followUp: [...queue.followUp],
			},
		};
	}

	async abort(sessionId: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		this.#dialogs.cancelAll(sessionId, "user-abort");
		await session.connection.abort();
	}

	async setModel(sessionId: string, model: { provider: string; id: string }): Promise<void> {
		const session = this.#requireSession(sessionId);
		const resolved = getPrimeConfig().modelRegistry.find(model.provider, model.id);
		if (!resolved) throw new Error(`Unknown model: ${model.provider}/${model.id}`);
		await session.connection.setModel(model.provider, model.id);
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await Promise.all([...this.#sessions.values()].map((session) => session.connection.setThinkingLevel(level)));
	}

	// -----------------------------------------------------------------------
	// Dialog answering
	// -----------------------------------------------------------------------

	/**
	 * Resolve a pending `ExtensionUIContext` dialog. Returns true iff the
	 * `toolCallId` was registered and answered.
	 */
	answerDialog(sessionId: string, toolCallId: string, answer: ChatQuestionAnswer): boolean {
		if (answer.kind === "skip") {
			return this.#dialogs.cancel(sessionId, toolCallId, "user-abort");
		}
		if (answer.kind === "questions" && answer.answers) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				answers: answer.answers,
			});
		}
		if (answer.kind === "single" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choice: answer.selectedIds[0],
			});
		}
		if (answer.kind === "multi" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choices: answer.selectedIds,
				choice: answer.selectedIds[0],
			});
		}
		if (answer.kind === "text" && typeof answer.text === "string") {
			return this.#dialogs.answer(sessionId, toolCallId, { text: answer.text });
		}
		// Unknown shape → reject so the agent loop sees a cancelled dialog.
		return this.#dialogs.cancel(sessionId, toolCallId, "user-abort");
	}

	pendingDialogsFor(sessionId: string): readonly ChatPendingDialog[] {
		return this.#dialogs.snapshot(sessionId);
	}

	// -----------------------------------------------------------------------
	// Slash-command surface (TUI parity)
	// -----------------------------------------------------------------------

	/** /context — context-window usage for the session's current branch. */
	getContextUsage(sessionId: string): unknown {
		this.#requireSession(sessionId);
		return this.#caches.get(sessionId)?.contextUsage;
	}

	/** /system-prompt — the exact system prompt sent to the model for the active turn. */
	getSystemPrompt(sessionId: string): string {
		this.#requireSession(sessionId);
		const cached = this.#caches.get(sessionId)?.systemPrompt;
		return cached ?? "";
	}

	/** /name — set or show the session display name. */
	setSessionName(sessionId: string, name: string | undefined): void {
		const session = this.#requireSession(sessionId);
		if (!name) return;
		const cache = this.#caches.get(sessionId) ?? emptyCache();
		cache.sessionName = name;
		this.#caches.set(sessionId, cache);
		void session.connection.setSessionName(name).catch(() => undefined);
	}

	getSessionName(sessionId: string): string | undefined {
		this.#requireSession(sessionId);
		return this.#caches.get(sessionId)?.sessionName;
	}

	/** /export — write the session to HTML (default) or JSONL (path ends with .jsonl). */
	async exportSession(sessionId: string, outputPath?: string): Promise<{ path: string; format: "html" | "jsonl" }> {
		const session = this.#requireSession(sessionId);
		if (outputPath?.endsWith(".jsonl")) {
			const path = await session.connection.exportToJsonl(outputPath);
			return { path, format: "jsonl" };
		}
		const path = await session.connection.exportToHtml(outputPath);
		return { path, format: "html" };
	}

	/** /reload — re-scan keybindings, extensions, skills, prompts, themes. */
	async reloadResources(_sessionId?: string): Promise<void> {
		await Promise.all([...this.#sessions.values()].map((session) => session.connection.reload?.()));
	}

	/** /tree — session-tree navigation via navigateTree (requires entry id). */
	async navigateTree(sessionId: string, targetId: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.connection.navigateTree(targetId, {});
		// Hydrated message ids are positional (${sessionId}-mN): branch navigation
		// rewrites the transcript branch, so any existing plan records now point at
		// unrelated messages. Invalidate instead of rendering the wrong card.
		await deleteManagedPlanPresentationsForSession(sessionId, session.sessionPath);
	}

	/** /tree — the session's entry tree plus the current leaf, for pickers. */
	getSessionTree(sessionId: string): { tree: unknown[]; leafId: string | null } {
		this.#requireSession(sessionId);
		const cached = this.#caches.get(sessionId)?.tree;
		if (cached) return cached;
		return { tree: [], leafId: null };
	}

	/**
	 * /fork and /clone — branch the session at `entryId` into a NEW live session.
	 *
	 * Mirrors `AgentSessionRuntime.fork` (agent-session-runtime.ts) minus the
	 * runtime-specific teardown: the TUI replaces its session in-slot, while the
	 * bridge keeps the SOURCE session running in `#sessions` and registers the
	 * fork alongside it under its fresh id.
	 *
	 * The fork flow:
	 *   1. Resolve the source entry (parent for `before`, target for `at`) and
	 *      pre-compute the user-message text for `position: "before"`.
	 *   2. Eagerly flush the source session so the side `SessionManager` (which
	 *      re-reads the file) sees the full branch.
	 *   3. Open a side `SessionManager` on the source file and create a branched
	 *      session, or open a fresh session parented on the source for the
	 *      "no recorded entries" case.
	 *   4. Build a new connection over the side manager, carry the source's
	 *      model/thinking/service-tier, and force-flush the fork header.
	 */
	async forkSession(
		sessionId: string,
		entryId: string,
		position: "before" | "at" = "before",
	): Promise<ForkSessionResult> {
		const bridge = this.#requireSession(sessionId);
		await bridge.connection.waitForIdle();
		const sourceState = await bridge.connection.getState();
		const selectedEntry = findSessionTreeEntry((await bridge.connection.getSessionTree()).tree, entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}
		let targetLeafId: string | null;
		let selectedText: string | undefined;
		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			selectedText = selectedTextFromSessionEntry(selectedEntry);
			if (selectedText === undefined) {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
		}

		const currentFile = sourceState.sessionFile;
		if (!currentFile) {
			throw new Error("Cannot fork an unpersisted session");
		}
		const sessionDir = sourceState.sessionDir ?? dirname(currentFile);

		let side: SessionManager;
		let forkedPath: string | undefined;
		if (targetLeafId) {
			// The side manager only creates the new transcript; the source remains
			// exclusively owned by the daemon.
			side = SessionManager.open(currentFile, sessionDir);
			forkedPath = side.createBranchedSession(targetLeafId) ?? undefined;
			if (!forkedPath) {
				throw new Error("Failed to create forked session");
			}
		} else {
			side = SessionManager.create(bridge.cwd, sessionDir);
			const sourceHeader = await bridge.connection.getSessionHeader();
			side.newSession({
				parentSession: currentFile,
				...(sourceHeader?.rlmDepth !== undefined ? { rlmDepth: sourceHeader.rlmDepth } : {}),
			});
			forkedPath = side.getSessionFile();
		}
		if (!forkedPath) throw new Error("Failed to create forked session");
		// The daemon becomes the sole writer once it opens the target. This initial
		// materialization makes a user-only fork durable before that handoff.
		side.flushNow();

		const webAgent = await this.#connectionFactory({
			cwd: bridge.cwd,
			sessionPath: forkedPath,
			thinkingLevel: sourceState.thinkingLevel,
			openUIPrompt: createOpenUIPromptSessionState(
				bridge.openUIPrompt.mode,
				bridge.openUIPrompt.enabled,
				bridge.openUIPrompt.artifact ?? false,
			),
		});
		// Carry the source session's model/thinking/service-tier over so the fork
		// doesn't silently fall back to defaults (provider/settings may differ).
		if (sourceState.model && !isUnresolvedPlaceholderModel(sourceState.model)) {
			await webAgent.connection.setModel(sourceState.model.provider, sourceState.model.id);
		}
		await webAgent.connection.setThinkingLevel(sourceState.thinkingLevel);
		await webAgent.connection.setServiceTier(sourceState.serviceTier ?? "default");

		const forkedBridge = await this.#registerConnection(webAgent, bridge.cwd, forkedPath, bridge.projectId);
		const forkedMessages = await this.getMessages(forkedBridge.sessionId);
		await copyManagedPlanPresentationsForFork(bridge, forkedBridge, forkedMessages.length);
		return {
			cancelled: false,
			selectedText,
			newSessionId: forkedBridge.sessionId,
		};
	}

	/** Fork the complete persisted history into another registered project. */
	async forkSessionIntoProject(sessionId: string, targetProjectId: ProjectId): Promise<string> {
		const source = this.#sessions.get(sessionId) ?? (await this.resumeSessionById(sessionId));
		if (!source) throw new Error(`Unknown session: ${sessionId}`);
		const targetCwd = await getPrimeConfig().projectRegistry.cwdForProject(targetProjectId);
		await source.connection.waitForIdle();
		const sourceState = await source.connection.getState();
		const sourcePath = sourceState.sessionFile;
		if (!sourcePath) throw new Error("Cannot fork an unpersisted session");
		const targetSessionDir = sessionDirectoryForCwd(targetCwd);
		const manager = SessionManager.forkFrom(sourcePath, targetCwd, targetSessionDir);
		const forkedPath = manager.getSessionFile();
		if (!forkedPath) throw new Error("Failed to create project fork");
		const webAgent = await this.#connectionFactory({
			cwd: targetCwd,
			sessionPath: forkedPath,
			thinkingLevel: sourceState.thinkingLevel,
			openUIPrompt: createOpenUIPromptSessionState(
				source.openUIPrompt.mode,
				source.openUIPrompt.enabled,
				source.openUIPrompt.artifact ?? false,
			),
		});
		if (sourceState.model && !isUnresolvedPlaceholderModel(sourceState.model)) {
			await webAgent.connection.setModel(sourceState.model.provider, sourceState.model.id);
		}
		await webAgent.connection.setThinkingLevel(sourceState.thinkingLevel);
		await webAgent.connection.setServiceTier(sourceState.serviceTier ?? "default");
		const forked = await this.#registerConnection(webAgent, targetCwd, forkedPath, targetProjectId);
		const forkedMessages = await this.getMessages(forked.sessionId);
		await copyManagedPlanPresentationsForFork(source, forked, forkedMessages.length);
		forked.mapperState.presentation = source.mapperState.presentation;
		this.#persistPresentation(forked.sessionId, forked.sessionPath, forked.mapperState.presentation);
		return forked.sessionId;
	}

	// -----------------------------------------------------------------------
	// Message hydration (for /session eager-load on the client)
	// -----------------------------------------------------------------------

	/** Reads message history from a live session, or from the JSONL transcript for a cold session. */
	async getMessages(sessionId: string): Promise<readonly ChatMessage[]> {
		const live = this.#sessions.get(sessionId);
		const messages: readonly AgentMessage[] = live
			? await live.connection.getMessages()
			: await this.#loadColdMessages(sessionId);
		return toChatMessagesFromAgentMessages(messages, sessionId);
	}

	getPresentation(sessionId: string): PrimeAgentSessionPresentation {
		return this.#sessions.get(sessionId)?.mapperState.presentation ?? createEmptyPrimeAgentSessionPresentation();
	}

	/**
	 * Add or replace one durable presentation artifact. The deterministic id is
	 * supplied by the handler, so retries of the same artifact are idempotent.
	 */
	async upsertPresentationArtifact(
		sessionId: string,
		artifact: PrimeAgentArtifact,
	): Promise<PrimeAgentSessionPresentation> {
		const session = this.#requireSession(sessionId);
		const current = session.mapperState.presentation;
		const existing = current.artifactRuns
			.flatMap((run) => run.artifacts)
			.find((candidate) => candidate.id === artifact.id);
		if (existing && presentationArtifactsEqual(existing, artifact)) return current;

		const next = {
			...upsertArtifact(current, artifact),
			revision: current.revision + 1,
		};
		session.mapperState.presentation = next;
		await this.#persistPresentation(sessionId, session.sessionPath, next);
		this.#dispatch(sessionId, { type: "presentation", sessionId, presentation: next });
		return next;
	}

	async #loadColdMessages(sessionId: string): Promise<readonly AgentMessage[]> {
		const all = await this.#sessionLister();
		const match = all.find((info) => info.sessionId === sessionId || info.id === sessionId);
		if (!match?.sessionFile) return [];
		const sessionManager = await SessionManager.openAsync(match.sessionFile);
		return sessionManager.buildSessionContext().messages;
	}

	#requireSession(sessionId: string): BridgeSession {
		const session = this.#sessions.get(sessionId);
		if (!session) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		return session;
	}
}
