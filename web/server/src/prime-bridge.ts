/**
 * PrimeBridge — central server-side session coordinator.
 *
 * Owns:
 * - Live `AgentConnection` instances (one per session) keyed by `sessionId`
 * - `ExtensionUIContext` per session (forwards UI dialogs to PendingDialogRegistry)
 * - Event subscription and forward into the ring buffer (SSE replay source)
 * - Kernel readiness gate via `IpythonKernelProvisioner.ensure()`
 *
 * The bridge is a **headless client** of the runtime. Per upstream
 * `packages/coding-agent/dist/docs/agent-connection.md`, the runtime seam
 * here is `InProcessAgentConnection(runtime)` — the same `AgentConnection`
 * interface that the TUI, ACP, RPC, and print modes all consume. The bridge
 * itself never reaches into `AgentSession`, `SessionManager`, or
 * `AgentSessionRuntime` directly: every operation goes through the connection
 * (e.g. `connection.promptAndWait(text)`, `connection.getMessages()`,
 * `connection.fork(entryId, opts)`). A few low-level needs
 * (`sessionManager.materializeSessionFile()` / `flushNow()` and the
 * `session` reference exposed to handlers outside this PR's scope) reach
 * through the concrete `InProcessAgentConnection.session` field; the latter
 * is documented as a back-compat shim for the handler migration that
 * follows in a separate PR.
 *
 * No HTTP, no React — pure TypeScript. The route layer calls into this only.
 */

import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
	AgentConnection,
	AgentSession,
	CreateAgentSessionRuntimeFactory,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
} from "@earendil-works/pi-coding-agent";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	InProcessAgentConnection,
	IpythonKernelProvisioner,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ProjectId } from "@prime-agent/web-protocol";
import {
	buildOpenUIPrompt,
	type ChatMessage,
	type ChatMode,
	type ChatPlanAction,
	type ChatQuestionAnswer,
	type ChatServiceTier,
	type ChatStreamEvent,
	type ChatThinkingLevel,
	type OpenUIPromptMode,
	type PrimeAgentSessionPresentation,
	type PrimeAgentUserBash,
} from "@prime-agent/web-protocol";

import { createEventMapperState, mapAgentConnectionEvent, toChatMessagesFromAgentMessages } from "./event-mapper";
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
	/**
	 * Back-compat surface for handlers outside this PR's scope. New code in
	 * the bridge and test must use `connection`; this field is preserved so
	 * `web/server/src/handlers/chat*.ts`, `prime-agent-presentation.ts`, and
	 * `managed-*.ts` can be migrated in a follow-up.
	 */
	readonly session: AgentSession;
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
}

export type BridgeEventListener = (sessionId: string, frame: ChatStreamEvent) => void;

export interface ForkSessionResult {
	cancelled: boolean;
	selectedText?: string;
	newSessionId: string;
}

export interface PrimeBridgeOptions {
	readonly kernelTimeoutMs?: number;
	readonly ringBufferCapacity?: number;
	readonly dialogTimeoutMs?: number;
	readonly writePresentation?: typeof writeManagedPrimePresentation;
}

type KernelReadySnapshot = { ok: true } | { ok: false; reason: string };

type OpenUIPromptSessionState = {
	enabled: boolean;
	mode: OpenUIPromptMode;
	prompt: string;
};

function createOpenUIPromptSessionState(mode: OpenUIPromptMode = "agent", enabled = false): OpenUIPromptSessionState {
	return { enabled, mode, prompt: buildOpenUIPrompt(mode) };
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
// Web agent session factory (uses the runtime seam)
// ---------------------------------------------------------------------------

async function createWebAgentConnection(options: {
	cwd: string;
	sessionManager?: SessionManager;
	openUIPrompt: OpenUIPromptSessionState;
}): Promise<{
	connection: AgentConnection;
	openUIPrompt: OpenUIPromptSessionState;
}> {
	const authStorage = AuthStorage.create();
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
		// Recreate cwd-bound services inside the factory so a runtime replacement
		// (new / switch / fork / import) can re-resolve them against the new cwd.
		const inner = await createAgentSessionServices({
			cwd,
			authStorage,
			noBuiltinHerdrReporter: true,
			telemetryDisabled: true,
			resourceLoaderOptions: {
				appendSystemPromptOverride: (base) =>
					options.openUIPrompt.enabled ? [...base, options.openUIPrompt.prompt] : base,
			},
		});
		const result = await createAgentSessionFromServices({
			services: inner,
			sessionManager,
			sessionStartEvent,
			telemetryDisabled: true,
		});
		return {
			session: result.session,
			extensionsResult: result.extensionsResult,
			modelFallbackMessage: result.modelFallbackMessage,
			services: inner,
			diagnostics: inner.diagnostics,
		};
	};
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: options.cwd,
		agentDir: getAgentDir(),
		sessionManager: options.sessionManager ?? SessionManager.create(options.cwd),
	});
	return { connection: new InProcessAgentConnection(runtime), openUIPrompt: options.openUIPrompt };
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
}

function emptyCache(): BridgeSessionCache {
	return {
		sessionName: undefined,
		thinkingLevel: undefined,
		serviceTier: undefined,
		systemPrompt: "",
		contextUsage: undefined,
		tree: undefined,
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
	};
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
	readonly #caches = new Map<string, BridgeSessionCache>();
	#kernelReadyByCwd = new Map<string, Promise<void>>();
	#kernelStateByCwd = new Map<string, KernelReadySnapshot>();

	constructor(options: PrimeBridgeOptions = {}) {
		this.#kernelTimeoutMs = options.kernelTimeoutMs ?? 30_000;
		this.#ringBufferCapacity = options.ringBufferCapacity ?? 500;
		this.#writePresentation = options.writePresentation ?? writeManagedPrimePresentation;
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
			buffer.push({ sessionId, frame: next });
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
		for (const session of this.#sessions.values()) session.unsubscribe();
		this.#sessions.clear();
		this.#listeners.clear();
		this.#ringBuffers.clear();
		this.#presentationWrites.clear();
		this.#presentationGenerations.clear();
		this.#caches.clear();
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
		const { connection, openUIPrompt } = await createWebAgentConnection({
			cwd: options.cwd,
			openUIPrompt: createOpenUIPromptSessionState(resolveOpenUIPromptMode(options.mode)),
		});
		// Force-flush the session header to disk eagerly so /api/chat/sessions and
		// future `resumeSessionById` calls (across Vite SSR restarts) can find it.
		// `AgentConnection` does not expose `flushNow()` (it is intentionally
		// session-runtime-private per the AgentConnection contract). The
		// `materializeSessionFile()` + `flushNow()` pair lives on
		// `SessionManager`; we reach it via the in-process connection's
		// `session` field — documented as a back-compat shim for the
		// session-runtime-private state that the connection does not surface.
		const liveSession = (connection as unknown as { session: AgentSession }).session;
		liveSession.sessionManager.materializeSessionFile();
		liveSession.sessionManager.flushNow();
		const bridgeSession = await this.#registerConnection(
			connection,
			options.cwd,
			liveSession.sessionManager.getSessionFile() ?? "",
			openUIPrompt,
			options.projectId ?? (await getPrimeConfig().projectRegistry.projectIdForCwd(options.cwd)),
		);
		if (options.thinkingLevel) {
			await connection.setThinkingLevel(options.thinkingLevel);
		}
		return bridgeSession;
	}

	/**
	 * Shared registration path for every session the bridge owns (create, resume,
	 * fork). Binds the web UI context, subscribes to `AgentConnectionEvent`,
	 * forwards frames into the ring buffer, and tracks the session in
	 * `#sessions`.
	 */
	async #registerConnection(
		connection: AgentConnection,
		cwd: string,
		sessionPath: string,
		openUIPrompt: OpenUIPromptSessionState,
		projectId: ProjectId | null,
	): Promise<BridgeSession> {
		const liveSession = (connection as unknown as { session: AgentSession }).session;
		const sessionId = liveSession.sessionManager.getSessionId();
		const resolvedProjectId =
			projectId ?? (await getPrimeConfig().projectRegistry.projectIdForSession(sessionId, cwd));
		await getPrimeConfig().projectRegistry.assignSession(sessionId, resolvedProjectId);
		const uiContext = createWebUIContext({
			sessionId,
			emitFrame: (frame) => this.#dispatch(sessionId, frame),
			dialogs: this.#dialogs,
		});
		// `bindHeadlessExtensions` is the InProcessAgentConnection entry point for
		// the UI context. It re-binds on every session_replaced automatically.
		// The bridge only ever constructs `InProcessAgentConnection` (see
		// `createWebAgentConnection`), so the cast is sound.
		await (connection as InProcessAgentConnection).bindHeadlessExtensions({ uiContext });

		const initialMessages = await connection.getMessages();
		const cache = await refreshCache(connection);
		this.#caches.set(sessionId, cache);
		const persistedPresentation = await loadManagedPrimePresentation({ session: liveSession, sessionPath });
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
			if (event.type === "session_event" && event.event.type === "compaction_end") {
				// Compaction rewrites the transcript prefix, shifting the positional
				// `${sessionId}-mN` ids the plan sidecar keys on. Invalidate records
				// rather than let them rebind to unrelated messages.
				void deleteManagedPlanPresentationsForSession(sessionId, sessionPath).catch(() => undefined);
			}
			if (event.type === "session_replaced" || event.type === "session_resynced") {
				// The runtime rebuilt; refresh the cache from the new session state.
				void refreshCache(connection)
					.then((next) => this.#caches.set(sessionId, next))
					.catch(() => undefined);
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
				if (frame.type === "presentation")
					this.#persistPresentation(sessionId, liveSession, sessionPath, frame.presentation);
				this.#dispatch(sessionId, frame);
			}
		});
		const bridgeSession: BridgeSession = {
			sessionId,
			projectId: resolvedProjectId,
			cwd,
			sessionPath,
			connection,
			session: liveSession,
			openUIPrompt,
			mapperState,
			uiContext,
			unsubscribe,
		};

		this.#sessions.set(sessionId, bridgeSession);
		this.#ringBufferFor(sessionId); // Pre-create so SSE attaches safely.
		this.#persistPresentation(sessionId, liveSession, sessionPath, mapperState.presentation);
		return bridgeSession;
	}

	#persistPresentation(
		sessionId: string,
		session: AgentSession,
		sessionPath: string,
		presentation: PrimeAgentSessionPresentation,
	): void {
		const generation = this.#presentationGenerations.get(sessionId) ?? 0;
		const previous = this.#presentationWrites.get(sessionId) ?? Promise.resolve();
		const next = previous
			.catch(() => undefined)
			.then(() => {
				const live = this.#sessions.get(sessionId);
				if (live?.session !== session || (this.#presentationGenerations.get(sessionId) ?? 0) !== generation) {
					return;
				}
				return this.#writePresentation({ session, sessionPath }, presentation);
			})
			.catch(() => undefined);
		this.#presentationWrites.set(sessionId, next);
		void next.finally(() => {
			if (this.#presentationWrites.get(sessionId) === next) this.#presentationWrites.delete(sessionId);
		});
	}

	/** Hot-lookup by id; reuse the live session if we already have one loaded. */
	getSession(sessionId: string): BridgeSession | undefined {
		return this.#sessions.get(sessionId);
	}

	/** Resume a persisted prime-agent session from its JSONL transcript. */
	async resumeSessionByPath(sessionPath: string): Promise<BridgeSession> {
		// If a live session already owns this path, reuse it.
		for (const [sessionId, session] of this.#sessions) {
			if (session.sessionPath === sessionPath) {
				return this.#sessions.get(sessionId)!;
			}
		}
		const sessionManager = await SessionManager.openAsync(sessionPath);
		const { connection, openUIPrompt } = await createWebAgentConnection({
			cwd: sessionManager.getCwd(),
			sessionManager,
			openUIPrompt: createOpenUIPromptSessionState(),
		});
		return this.#registerConnection(
			connection,
			sessionManager.getCwd(),
			sessionPath,
			openUIPrompt,
			await getPrimeConfig().projectRegistry.projectIdForSession(
				sessionManager.getSessionId(),
				sessionManager.getCwd(),
			),
		);
	}

	async resumeSessionById(sessionId: string): Promise<BridgeSession | undefined> {
		const live = this.#sessions.get(sessionId);
		if (live) return live;
		const all = await SessionManager.listAll();
		const match = all.find((info) => info.id === sessionId);
		if (!match) return undefined;
		return this.resumeSessionByPath(match.path);
	}

	async listSessions(cwd?: string) {
		// Delegate to the existing SessionManager.list() surface; the bridge has
		// no per-connection session listing in the AgentConnection interface for
		// arbitrary cwds, so the persistent registry is the right source.
		return await (cwd ? SessionManager.list(cwd) : SessionManager.listAll());
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		const existing = this.#sessions.get(sessionId);
		const sessions = existing ? undefined : await SessionManager.listAll();
		const sessionPath = existing?.sessionPath ?? sessions?.find((session) => session.id === sessionId)?.path;
		if (!sessionPath) return false;
		if (existing) {
			this.#dialogs.cancelAll(sessionId, "server-shutdown");
			existing.unsubscribe();
			await existing.connection.abort().catch(() => undefined);
			this.#sessions.delete(sessionId);
			this.#ringBuffers.delete(sessionId);
			this.#caches.delete(sessionId);
		}
		this.#presentationGenerations.set(sessionId, (this.#presentationGenerations.get(sessionId) ?? 0) + 1);
		const pendingPresentationWrite = this.#presentationWrites.get(sessionId);
		await pendingPresentationWrite?.catch(() => undefined);
		if (this.#presentationWrites.get(sessionId) === pendingPresentationWrite) {
			this.#presentationWrites.delete(sessionId);
		}
		await deleteManagedAttachmentsForSession(sessionId, sessionPath);
		await deleteManagedPlanPresentationsForSession(sessionId, sessionPath);
		await rm(sessionPath, { force: true });
		const artifactDir = join(dirname(dirname(sessionPath)), "session-artifacts", basename(sessionPath, ".jsonl"));
		await rm(artifactDir, { recursive: true, force: true });
		await getPrimeConfig().projectRegistry.assignSession(sessionId, null);
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
			planAction?: ChatPlanAction;
		},
	): Promise<void> {
		const session = this.#requireSession(sessionId);
		const backendSessionCommand = parseBackendSessionCommand(text);
		this.#setOpenUIPromptState(
			session,
			options?.openUI === true,
			resolveOpenUIPromptMode(options?.mode, options?.planAction),
		);
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
		// identical to the previous bridge.
		await session.connection.promptAndWait(text, {
			images: options?.images,
			streamingBehavior: options?.streamingBehavior,
			queueIfBusy: true,
		});
		// For a session command (e.g. /refine) queued behind an active turn, wait
		// until input is idle so the HTTP stream can emit its terminal frame
		// after the command has actually run.
		if (backendSessionCommand) await session.connection.waitForIdle();
	}

	#setOpenUIPromptState(session: BridgeSession, enabled: boolean, mode: OpenUIPromptMode): void {
		if (session.openUIPrompt.enabled === enabled && session.openUIPrompt.mode === mode) return;
		// The legacy bridge mutated the resource loader's `appendSystemPrompt` and
		// poked `setActiveToolsByName` to force a system-prompt rebuild. The
		// AgentConnection seam does not expose the resource loader (it lives
		// behind the runtime), so the bridge reaches through the back-compat
		// `session` field — documented in `BridgeSession.session` — to keep the
		// system-prompt mutation behaviour identical to the previous bridge.
		const nextPrompt = buildOpenUIPrompt(mode);
		const appendSystemPrompt = session.session.resourceLoader.getAppendSystemPrompt();
		const currentPromptIndex = appendSystemPrompt.lastIndexOf(session.openUIPrompt.prompt);
		if (!enabled && currentPromptIndex >= 0) {
			appendSystemPrompt.splice(currentPromptIndex, 1);
		} else if (enabled && currentPromptIndex >= 0) {
			appendSystemPrompt[currentPromptIndex] = nextPrompt;
		} else if (enabled) {
			appendSystemPrompt.push(nextPrompt);
		}
		session.openUIPrompt.enabled = enabled;
		session.openUIPrompt.mode = mode;
		session.openUIPrompt.prompt = nextPrompt;
		session.session.setActiveToolsByName(session.session.getActiveToolNames());
		// Invalidate the cached system prompt; the next read recomputes from
		// the resource loader.
		const cache = this.#caches.get(session.sessionId) ?? emptyCache();
		cache.systemPrompt = "";
		this.#caches.set(session.sessionId, cache);
	}

	async steer(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.connection.steer(text);
	}

	async followUp(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.connection.followUp(text);
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
		if (answer.kind === "single" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choice: answer.selectedIds[0],
			});
		}
		if (answer.kind === "multi" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choice: answer.selectedIds[0],
			});
		}
		if (answer.kind === "text" && typeof answer.text === "string") {
			return this.#dialogs.answer(sessionId, toolCallId, { text: answer.text });
		}
		// Unknown shape → reject so the agent loop sees a cancelled dialog.
		return this.#dialogs.cancel(sessionId, toolCallId, "user-abort");
	}

	pendingDialogsFor(sessionId: string) {
		return this.#dialogs.list(sessionId);
	}

	// -----------------------------------------------------------------------
	// Slash-command surface (TUI parity)
	// -----------------------------------------------------------------------

	/** /context — context-window usage for the session's current branch. */
	getContextUsage(sessionId: string): unknown {
		const session = this.#requireSession(sessionId);
		return this.#caches.get(sessionId)?.contextUsage ?? session.session.getContextUsage();
	}

	/** /system-prompt — the exact system prompt sent to the model for the active turn. */
	getSystemPrompt(sessionId: string): string {
		const session = this.#requireSession(sessionId);
		const cached = this.#caches.get(sessionId)?.systemPrompt;
		return cached && cached.length > 0 ? cached : session.session.systemPrompt;
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
		const session = this.#requireSession(sessionId);
		return this.#caches.get(sessionId)?.sessionName ?? session.session.sessionName;
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
		const session = this.#requireSession(sessionId);
		const cached = this.#caches.get(sessionId)?.tree;
		if (cached) return cached;
		// Cold fallback: read the underlying sessionManager directly. The bridge
		// would normally refresh its cache on session_replaced, but a caller
		// before any session event has fired will see the live read here.
		return {
			tree: session.session.sessionManager.getTree() as unknown[],
			leafId: session.session.sessionManager.getLeafId(),
		};
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
		const liveSession = (bridge.connection as unknown as { session: AgentSession }).session;
		const sourceManager = liveSession.sessionManager;

		// Entry resolution ported from AgentSessionRuntime.fork (lines 532-545).
		const selectedEntry = sourceManager.getEntry(entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}
		let targetLeafId: string | null;
		let selectedText: string | undefined;
		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
			const content = selectedEntry.message.content;
			if (typeof content === "string") {
				selectedText = content;
			} else {
				selectedText = content
					.filter(
						(part): part is { type: "text"; text: string } =>
							part.type === "text" && typeof part.text === "string",
					)
					.map((part) => part.text)
					.join("");
			}
		}

		const currentFile = sourceManager.getSessionFile();
		if (!currentFile) {
			throw new Error("Cannot fork an unpersisted session");
		}
		const sessionDir = sourceManager.getSessionDir();

		// `_persist` holds back pre-assistant entries from disk; flush the source
		// so the side manager (which re-reads the file) sees the full branch.
		sourceManager.flushNow();

		let side: SessionManager;
		if (targetLeafId) {
			// Branch the recorded path root→leaf into a fresh session file. The
			// call re-ids `side` in place to the forked session.
			side = SessionManager.open(currentFile, sessionDir);
			const forkedPath = side.createBranchedSession(targetLeafId);
			if (!forkedPath) {
				throw new Error("Failed to create forked session");
			}
		} else {
			// `/fork` on the first user message (position "before"): no recorded
			// entries to carry over, so start a fresh empty session parented on
			// the source file — same as runtime.fork's targetLeafId === null path.
			side = SessionManager.create(bridge.cwd, sessionDir);
			const sourceRlmDepth = sourceManager.getHeader()?.rlmDepth;
			side.newSession({
				parentSession: currentFile,
				// `newSession` derives depth from the parent file on its own when
				// the key is absent; an explicit `undefined` would suppress that.
				...(sourceRlmDepth !== undefined ? { rlmDepth: sourceRlmDepth } : {}),
			});
		}

		const { connection, openUIPrompt } = await createWebAgentConnection({
			cwd: bridge.cwd,
			sessionManager: side,
			openUIPrompt: createOpenUIPromptSessionState(bridge.openUIPrompt.mode, bridge.openUIPrompt.enabled),
		});
		const forkedSession = (connection as unknown as { session: AgentSession }).session;
		// Carry the source session's model/thinking/service-tier over so the fork
		// doesn't silently fall back to defaults (provider/settings may differ).
		const sourceState = await bridge.connection.getState();
		if (
			sourceState.model &&
			(forkedSession.model?.id !== sourceState.model.id ||
				forkedSession.model?.provider !== sourceState.model.provider)
		) {
			await connection.setModel(sourceState.model.provider, sourceState.model.id);
		}
		await connection.setThinkingLevel(sourceState.thinkingLevel);
		await connection.setServiceTier(sourceState.serviceTier ?? "default");

		// Persist the fork header now so cold resume (/api/chat/sessions after an
		// SSR restart) can discover it — bridge durability policy. The
		// connection does not expose `flushNow()` (intentionally per the
		// AgentConnection contract); use the back-compat session reference.
		forkedSession.sessionManager.materializeSessionFile();
		forkedSession.sessionManager.flushNow();

		const forkedBridge = await this.#registerConnection(
			connection,
			bridge.cwd,
			forkedSession.sessionManager.getSessionFile() ?? "",
			openUIPrompt,
			bridge.projectId,
		);
		const forkedMessages = await this.getMessages(forkedBridge.sessionId);
		await copyManagedPlanPresentationsForFork(bridge, forkedBridge, forkedMessages.length);
		return {
			cancelled: false,
			selectedText,
			newSessionId: forkedSession.sessionManager.getSessionId(),
		};
	}

	/** Fork the complete persisted history into another registered project. */
	async forkSessionIntoProject(sessionId: string, targetProjectId: ProjectId): Promise<string> {
		const source = this.#sessions.get(sessionId) ?? (await this.resumeSessionById(sessionId));
		if (!source) throw new Error(`Unknown session: ${sessionId}`);
		const targetCwd = await getPrimeConfig().projectRegistry.cwdForProject(targetProjectId);
		const sourcePath = source.session.sessionManager.getSessionFile();
		if (!sourcePath) throw new Error("Cannot fork an unpersisted session");
		const manager = SessionManager.forkFrom(sourcePath, targetCwd);
		const { connection, openUIPrompt } = await createWebAgentConnection({
			cwd: targetCwd,
			sessionManager: manager,
			openUIPrompt: createOpenUIPromptSessionState(source.openUIPrompt.mode, source.openUIPrompt.enabled),
		});
		const forkedSession = (connection as unknown as { session: AgentSession }).session;
		const sourceState = await source.connection.getState();
		if (
			sourceState.model &&
			(forkedSession.model?.id !== sourceState.model.id ||
				forkedSession.model?.provider !== sourceState.model.provider)
		) {
			await connection.setModel(sourceState.model.provider, sourceState.model.id);
		}
		await connection.setThinkingLevel(sourceState.thinkingLevel);
		await connection.setServiceTier(sourceState.serviceTier ?? "default");
		manager.materializeSessionFile();
		manager.flushNow();
		const forked = await this.#registerConnection(
			connection,
			targetCwd,
			manager.getSessionFile() ?? "",
			openUIPrompt,
			targetProjectId,
		);
		const forkedMessages = await this.getMessages(forked.sessionId);
		await copyManagedPlanPresentationsForFork(source, forked, forkedMessages.length);
		forked.mapperState.presentation = source.mapperState.presentation;
		this.#persistPresentation(forked.sessionId, forked.session, forked.sessionPath, forked.mapperState.presentation);
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

	async #loadColdMessages(sessionId: string): Promise<readonly AgentMessage[]> {
		const all = await SessionManager.listAll();
		const match = all.find((info) => info.id === sessionId);
		if (!match) return [];
		const sessionManager = await SessionManager.openAsync(match.path);
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
