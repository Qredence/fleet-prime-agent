/**
 * PrimeBridge — central server-side session coordinator.
 *
 * Owns:
 * - Live `AgentSession`s keyed by `sessionId` (prime-agent's session dir name)
 * - `ExtensionUIContext` per session (forwards UI dialogs to PendingDialogRegistry)
 * - Event subscription and forward into the ring buffer (SSE replay source)
 * - Kernel readiness gate via `IpythonKernelProvisioner.ensure()`
 *
 * No HTTP, no React — pure TypeScript. The route layer calls into this only.
 */

import { rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, UserMessage } from "@earendil-works/pi-ai";
import type {
	AgentSession,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	SessionEntry,
	SessionInfo,
	TerminalInputHandler,
	Theme,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
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
	type ChatStreamEvent,
	type OpenUIPromptMode,
} from "@prime-agent/web-protocol";

import {
	createEventMapperState,
	mapAgentSessionEvent,
	toChatMessageFromAssistant,
	toChatMessageFromUser,
} from "./event-mapper";
import { deleteManagedAttachmentsForSession } from "./managed-attachments";
import {
	copyManagedPlanPresentationsForFork,
	deleteManagedPlanPresentationsForSession,
} from "./managed-plan-presentations";
import { PendingDialogRegistry } from "./pending-dialogs";
import { getPrimeConfig } from "./prime-config";
import { RingBuffer } from "./ring-buffer";

type UIContextCtorArgs = {
	sessionId: string;
	emitFrame: (frame: ChatStreamEvent) => void;
	dialogs: PendingDialogRegistry;
};

class WebUIContext implements ExtensionUIContext {
	readonly #sessionId: string;
	readonly #emit: (frame: ChatStreamEvent) => void;
	readonly #dialogs: PendingDialogRegistry;

	constructor({ sessionId, emitFrame, dialogs }: UIContextCtorArgs) {
		this.#sessionId = sessionId;
		this.#emit = emitFrame;
		this.#dialogs = dialogs;
	}

	async select(title: string, options: string[], _opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
		const toolCallId = crypto.randomUUID();
		const dialog = await this.#dialogs.open<{ choice: string } | undefined>({
			sessionId: this.#sessionId,
			toolCallId,
			kind: "select",
			title,
			message: "",
			options,
			signalFrame: {
				type: "tool-Question",
				toolCallId,
				state: "input-streaming",
				input: {
					kind: "select",
					title,
					options,
				},
			},
		});
		return (dialog as { choice: string } | undefined)?.choice;
	}

	async confirm(title: string, message: string, _opts?: ExtensionUIDialogOptions): Promise<boolean> {
		const toolCallId = crypto.randomUUID();
		const dialog = await this.#dialogs.open<boolean>({
			sessionId: this.#sessionId,
			toolCallId,
			kind: "confirm",
			title,
			message,
			signalFrame: {
				type: "tool-Question",
				toolCallId,
				state: "input-streaming",
				input: {
					kind: "confirm",
					title,
					message,
				},
			},
		});
		return Boolean(dialog);
	}

	async input(title: string, placeholder?: string, _opts?: ExtensionUIDialogOptions): Promise<string | undefined> {
		const toolCallId = crypto.randomUUID();
		const dialog = await this.#dialogs.open<{ text: string } | undefined>({
			sessionId: this.#sessionId,
			toolCallId,
			kind: "input",
			title,
			message: "",
			placeholder,
			signalFrame: {
				type: "tool-Question",
				toolCallId,
				state: "input-streaming",
				input: {
					kind: "text",
					title,
					placeholder,
				},
			},
		});
		return (dialog as { text: string } | undefined)?.text;
	}

	notify(message: string, type: "info" | "warning" | "error" = "info"): void {
		const prefix = type === "info" ? "" : `${type.toUpperCase()}: `;
		this.#emit({
			type: "state",
			state: { name: "agent_start", message: `${prefix}${message}` },
		});
	}

	onTerminalInput(_handler: TerminalInputHandler): () => void {
		return () => {};
	}

	setStatus(key: string, text: string | undefined): void {
		this.#emit({
			type: "state",
			state: { name: "agent_start", message: `[${key}] ${text ?? ""}` },
		});
	}

	setWorkingMessage(_message?: string): void {}
	setWorkingVisible(_visible: boolean): void {}
	setWorkingIndicator(_options?: WorkingIndicatorOptions): void {}
	setHiddenThinkingLabel(_label?: string): void {}
	setWidget: ExtensionUIContext["setWidget"] = () => {};
	setFooter: ExtensionUIContext["setFooter"] = () => {};
	setHeader: ExtensionUIContext["setHeader"] = () => {};
	setTitle(_title: string): void {}
	custom: ExtensionUIContext["custom"] = async () => {
		throw new Error("Custom terminal UI components are not available in the web interface");
	};
	pasteToEditor(_text: string): void {}
	setEditorText(_text: string): void {}
	getEditorText(): string {
		return "";
	}
	editor(_title: string, _prefill?: string): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}
	addAutocompleteProvider: ExtensionUIContext["addAutocompleteProvider"] = () => {};
	setEditorComponent: ExtensionUIContext["setEditorComponent"] = () => {};
	getEditorComponent: ExtensionUIContext["getEditorComponent"] = () => undefined;
	get theme(): Theme {
		throw new Error("Terminal themes are not available in the web interface");
	}
	getAllThemes(): { name: string; path: string | undefined }[] {
		return [];
	}
	getTheme(_name: string): Theme | undefined {
		return undefined;
	}
	setTheme(_theme: string | Theme): { success: boolean; error?: string } {
		return { success: false, error: "not in browser" };
	}
	getToolsExpanded(): boolean {
		return true;
	}
	setToolsExpanded(_expanded: boolean): void {}
}

/**
 * Verbatim port of `extractUserMessageText` from agent-session-runtime.ts —
 * joins the text parts of a user message's content for fork pre-fill.
 */
function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

// ---------------------------------------------------------------------------
// Bridge types
// ---------------------------------------------------------------------------

export interface BridgeSession {
	readonly sessionId: string;
	readonly projectId: ProjectId | null;
	readonly cwd: string;
	readonly sessionPath: string;
	readonly session: AgentSession;
	readonly openUIPrompt: OpenUIPromptSessionState;
	readonly mapperState: ReturnType<typeof createEventMapperState>;
	readonly uiContext: WebUIContext;
	readonly unsubscribe: () => void;
}

export interface CreateSessionOptions {
	readonly cwd: string;
	readonly projectId?: ProjectId | null;
	readonly thinkingLevel?: ThinkingLevel;
	readonly mode?: ChatMode;
}

export type BridgeEventListener = (sessionId: string, frame: ChatStreamEvent) => void;

/**
 * Structural mirror of prime-agent's `SessionTreeNode` (not re-exported from
 * the package index). `SessionManager.getTree()` returns this shape.
 */
export interface SessionTreeNode {
	entry: SessionEntry;
	label?: string;
	labelTimestamp?: string;
	children: SessionTreeNode[];
}

export interface ForkSessionResult {
	cancelled: boolean;
	selectedText?: string;
	newSessionId: string;
}

export interface PrimeBridgeOptions {
	readonly kernelTimeoutMs?: number;
	readonly ringBufferCapacity?: number;
	readonly dialogTimeoutMs?: number;
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

async function createWebAgentSession(options: {
	cwd: string;
	sessionManager?: SessionManager;
	openUIPrompt: OpenUIPromptSessionState;
}) {
	const authStorage = AuthStorage.create();
	const services = await createAgentSessionServices({
		cwd: options.cwd,
		authStorage,
		// The web bridge historically used the bare SDK path. Keep its telemetry
		// and built-in Herdr behavior unchanged while adding the web-only prompt.
		noBuiltinHerdrReporter: true,
		telemetryDisabled: true,
		resourceLoaderOptions: {
			appendSystemPromptOverride: (base) =>
				options.openUIPrompt.enabled ? [...base, options.openUIPrompt.prompt] : base,
		},
	});
	const result = await createAgentSessionFromServices({
		services,
		sessionManager: options.sessionManager ?? SessionManager.create(options.cwd),
		telemetryDisabled: true,
	});
	return { ...result, openUIPrompt: options.openUIPrompt };
}

export class PrimeBridge {
	readonly #sessions = new Map<string, BridgeSession>();
	readonly #listeners = new Set<BridgeEventListener>();
	readonly #ringBuffers = new Map<string, RingBuffer>();
	readonly #dialogs: PendingDialogRegistry;
	readonly #kernelTimeoutMs: number;
	readonly #ringBufferCapacity: number;
	#kernelReadyByCwd = new Map<string, Promise<void>>();
	#kernelStateByCwd = new Map<string, KernelReadySnapshot>();

	constructor(options: PrimeBridgeOptions = {}) {
		this.#kernelTimeoutMs = options.kernelTimeoutMs ?? 30_000;
		this.#ringBufferCapacity = options.ringBufferCapacity ?? 500;
		this.#dialogs = new PendingDialogRegistry({
			defaultTimeoutMs: options.dialogTimeoutMs ?? 60_000,
			emitFrame: (sessionId, frame) => this.#dispatch(sessionId, frame),
		});
	}

	/** Late-boot kernel readiness gate. Boot-time callers await this; failures cause `/api/chat/new` to 503. */
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
		const {
			session,
			extensionsResult: _ext,
			openUIPrompt,
		} = await createWebAgentSession({
			cwd: options.cwd,
			openUIPrompt: createOpenUIPromptSessionState(resolveOpenUIPromptMode(options.mode)),
		});
		// Force-flush the session header to disk eagerly so /api/chat/sessions and
		// future `resumeSessionById` calls (across Vite SSR restarts) can find it.
		// `materializeSessionFile()` returns the planned path but skips the actual
		// write — `_persist()` defers all writes until the first assistant message
		// (anti dangling-session guard for the interactive CLI). For the web bridge
		// we want the header durable *now*, so we call `flushNow()` instead, which
		// bypasses that guard intentionally.
		session.sessionManager.materializeSessionFile();
		session.sessionManager.flushNow();
		const bridgeSession = await this.#registerSession(
			session,
			options.cwd,
			session.sessionManager.getSessionFile() ?? "",
			openUIPrompt,
			options.projectId ?? (await getPrimeConfig().projectRegistry.projectIdForCwd(options.cwd)),
		);
		if (options.thinkingLevel) {
			await session.setThinkingLevel(options.thinkingLevel);
		}
		return bridgeSession;
	}

	/**
	 * Shared registration path for every session the bridge owns (create, resume,
	 * fork). Binds the web UI context, forwards session events into the ring
	 * buffer, and tracks the session in `#sessions`.
	 */
	async #registerSession(
		session: AgentSession,
		cwd: string,
		sessionPath: string,
		openUIPrompt: OpenUIPromptSessionState,
		projectId: ProjectId | null,
	): Promise<BridgeSession> {
		const sessionId = session.sessionManager.getSessionId();
		const resolvedProjectId =
			projectId ?? (await getPrimeConfig().projectRegistry.projectIdForSession(sessionId, cwd));
		await getPrimeConfig().projectRegistry.assignSession(sessionId, resolvedProjectId);
		const uiContext = new WebUIContext({
			sessionId,
			emitFrame: (frame) => this.#dispatch(sessionId, frame),
			dialogs: this.#dialogs,
		});
		await session.bindExtensions({
			uiContext,
		});

		const mapperState = createEventMapperState({ sessionId });
		const unsubscribe = session.subscribe((event) => {
			if (process.env.PRIME_BRIDGE_DEBUG === "1") {
				try {
					process.stderr.write(
						`[bridge:${sessionId.slice(0, 8)}] event ${event.type} ${JSON.stringify(event).slice(0, 200)}\n`,
					);
				} catch {
					/* ignore */
				}
			}
			const frames = mapAgentSessionEvent(mapperState, event);
			for (const frame of frames) {
				this.#dispatch(sessionId, frame);
			}
		});
		const bridgeSession: BridgeSession = {
			sessionId,
			projectId: resolvedProjectId,
			cwd,
			sessionPath,
			session,
			openUIPrompt,
			mapperState,
			uiContext,
			unsubscribe,
		};

		this.#sessions.set(sessionId, bridgeSession);
		this.#ringBufferFor(sessionId); // Pre-create so SSE attaches safely.
		return bridgeSession;
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
		const agentSessionResult = await createWebAgentSession({
			cwd: sessionManager.getCwd(),
			sessionManager,
			openUIPrompt: createOpenUIPromptSessionState(),
		});
		return this.#registerSession(
			agentSessionResult.session,
			sessionManager.getCwd(),
			sessionPath,
			agentSessionResult.openUIPrompt,
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

	async listSessions(cwd?: string): Promise<readonly SessionInfo[]> {
		if (cwd) {
			return await SessionManager.list(cwd);
		}
		return await SessionManager.listAll();
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		const existing = this.#sessions.get(sessionId);
		const sessions = existing ? undefined : await SessionManager.listAll();
		const sessionPath = existing?.sessionPath ?? sessions?.find((session) => session.id === sessionId)?.path;
		if (!sessionPath) return false;
		if (existing) {
			this.#dialogs.cancelAll(sessionId, "server-shutdown");
			existing.unsubscribe();
			await existing.session.abort().catch(() => undefined);
			this.#sessions.delete(sessionId);
			this.#ringBuffers.delete(sessionId);
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
		this.#setOpenUIPromptState(
			session,
			options?.openUI === true,
			resolveOpenUIPromptMode(options?.mode, options?.planAction),
		);
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			process.stderr.write(
				`[bridge:${sessionId.slice(0, 8)}] prompt model=${session.session.agent?.state?.model?.provider ?? "?"}/${session.session.agent?.state?.model?.id ?? "?"} thinkingLevel=${session.session.agent?.state?.thinkingLevel ?? "?"}\n`,
			);
		}
		await session.session.prompt(text, {
			images: options?.images,
			streamingBehavior: options?.streamingBehavior,
		});
	}

	#setOpenUIPromptState(session: BridgeSession, enabled: boolean, mode: OpenUIPromptMode): void {
		if (session.openUIPrompt.enabled === enabled && session.openUIPrompt.mode === mode) return;

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
	}

	async steer(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.session.steer(text);
	}

	async followUp(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.session.followUp(text);
	}

	async abort(sessionId: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		this.#dialogs.cancelAll(sessionId, "user-abort");
		await session.session.abort();
	}

	async setModel(sessionId: string, model: { provider: string; id: string }): Promise<void> {
		const session = this.#requireSession(sessionId);
		const resolved = getPrimeConfig().modelRegistry.find(model.provider, model.id);
		if (!resolved) throw new Error(`Unknown model: ${model.provider}/${model.id}`);
		await session.session.setModel(resolved);
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		await Promise.all([...this.#sessions.values()].map((session) => session.session.setThinkingLevel(level)));
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
	getContextUsage(sessionId: string) {
		const session = this.#requireSession(sessionId);
		return session.session.getContextUsage();
	}

	/** /system-prompt — the exact system prompt sent to the model for the active turn. */
	getSystemPrompt(sessionId: string): string {
		const session = this.#requireSession(sessionId);
		return session.session.systemPrompt;
	}

	/** /name — set or show the session display name. */
	setSessionName(sessionId: string, name: string | undefined): void {
		const session = this.#requireSession(sessionId);
		if (!name) return;
		session.session.setSessionName(name);
	}

	getSessionName(sessionId: string): string | undefined {
		const session = this.#requireSession(sessionId);
		return session.session.sessionName;
	}

	/** /export — write the session to HTML (default) or JSONL (path ends with .jsonl). */
	async exportSession(sessionId: string, outputPath?: string): Promise<{ path: string; format: "html" | "jsonl" }> {
		const session = this.#requireSession(sessionId);
		if (outputPath?.endsWith(".jsonl")) {
			const path = session.session.exportToJsonl(outputPath);
			return { path, format: "jsonl" };
		}
		const path = await session.session.exportToHtml(outputPath);
		return { path, format: "html" };
	}

	/** /reload — re-scan keybindings, extensions, skills, prompts, themes. */
	async reloadResources(_sessionId?: string): Promise<void> {
		// The resource loader is per-cwd inside `createAgentSession`, and the TUI's
		// `/reload` reloads the *current* session's world via `session.reload()`.
		// For the web port we reload every attached session's loader so new
		// skills/prompts/themes show up on next prompt.
		await Promise.all([...this.#sessions.values()].map((session) => session.session.reload()));
	}

	/** /tree — session-tree navigation via navigateTree (requires entry id). */
	async navigateTree(sessionId: string, targetId: string): Promise<void> {
		const session = this.#requireSession(sessionId);
		await session.session.navigateTree(targetId, {});
	}

	/** /tree — the session's entry tree plus the current leaf, for pickers. */
	getSessionTree(sessionId: string): {
		tree: SessionTreeNode[];
		leafId: string | null;
	} {
		const session = this.#requireSession(sessionId);
		return {
			tree: session.session.sessionManager.getTree() as SessionTreeNode[],
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
	 * Safety rail from the runtime trace: `createBranchedSession` mutates its
	 * manager in place (re-ids it to the fork), so the branch is always computed
	 * on a SIDE `SessionManager` opened over the same file — never on the live
	 * `session.sessionManager`.
	 */
	async forkSession(
		sessionId: string,
		entryId: string,
		position: "before" | "at" = "before",
	): Promise<ForkSessionResult> {
		const bridge = this.#requireSession(sessionId);
		const sourceManager = bridge.session.sessionManager;

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
			selectedText = extractUserMessageText(selectedEntry.message.content);
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

		const { session: forked, openUIPrompt } = await createWebAgentSession({
			cwd: bridge.cwd,
			sessionManager: side,
			openUIPrompt: createOpenUIPromptSessionState(bridge.openUIPrompt.mode, bridge.openUIPrompt.enabled),
		});
		// Carry the source session's model/thinking/service-tier over so the fork
		// doesn't silently fall back to defaults (provider/settings may differ).
		// setModel appends a model_change entry even when unchanged, so skip the
		// call when session restore already landed on the same model.
		const sourceModel = bridge.session.model;
		if (sourceModel && (forked.model?.id !== sourceModel.id || forked.model?.provider !== sourceModel.provider)) {
			await forked.setModel(sourceModel);
		}
		await forked.setThinkingLevel(bridge.session.thinkingLevel);
		forked.setServiceTier(bridge.session.serviceTier);

		// Persist the fork header now so cold resume (/api/chat/sessions after an
		// SSR restart) can discover it — bridge durability policy.
		forked.sessionManager.materializeSessionFile();
		forked.sessionManager.flushNow();

		const forkedBridge = await this.#registerSession(
			forked,
			bridge.cwd,
			forked.sessionManager.getSessionFile() ?? "",
			openUIPrompt,
			bridge.projectId,
		);
		const forkedMessages = await this.getMessages(forkedBridge.sessionId);
		await copyManagedPlanPresentationsForFork(bridge, forkedBridge, forkedMessages.length);
		return {
			cancelled: false,
			selectedText,
			newSessionId: forked.sessionManager.getSessionId(),
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
		const result = await createWebAgentSession({
			cwd: targetCwd,
			sessionManager: manager,
			openUIPrompt: createOpenUIPromptSessionState(source.openUIPrompt.mode, source.openUIPrompt.enabled),
		});
		if (
			source.session.model &&
			(result.session.model?.id !== source.session.model.id ||
				result.session.model?.provider !== source.session.model.provider)
		) {
			await result.session.setModel(source.session.model);
		}
		await result.session.setThinkingLevel(source.session.thinkingLevel);
		result.session.setServiceTier(source.session.serviceTier);
		manager.materializeSessionFile();
		manager.flushNow();
		const forked = await this.#registerSession(
			result.session,
			targetCwd,
			manager.getSessionFile() ?? "",
			result.openUIPrompt,
			targetProjectId,
		);
		const forkedMessages = await this.getMessages(forked.sessionId);
		await copyManagedPlanPresentationsForFork(source, forked, forkedMessages.length);
		return forked.sessionId;
	}

	// -----------------------------------------------------------------------
	// Message hydration (for /session eager-load on the client)
	// -----------------------------------------------------------------------

	/** Reads message history from a live session, or from the JSONL transcript for a cold session. */
	async getMessages(sessionId: string): Promise<readonly ChatMessage[]> {
		const live = this.#sessions.get(sessionId);
		const messages: readonly AgentMessage[] = live
			? live.session.sessionManager.buildSessionContext().messages
			: await this.#loadColdMessages(sessionId);
		return messages.map((msg, idx) => this.#toChatMessage(sessionId, msg, idx));
	}

	async #loadColdMessages(sessionId: string): Promise<readonly AgentMessage[]> {
		const all = await SessionManager.listAll();
		const match = all.find((info) => info.id === sessionId);
		if (!match) return [];
		const sessionManager = await SessionManager.openAsync(match.path);
		const context = sessionManager.buildSessionContext();
		return context.messages;
	}

	#toChatMessage(sessionId: string, msg: AgentMessage, index: number): ChatMessage {
		const id = `${sessionId}-m${index}`;
		if (msg.role === "assistant") {
			return toChatMessageFromAssistant(msg as AssistantMessage, id);
		}
		if (msg.role === "user") {
			return toChatMessageFromUser(msg as UserMessage, id);
		}
		return { id, role: "assistant", parts: [] };
	}

	#requireSession(sessionId: string): BridgeSession {
		const session = this.#sessions.get(sessionId);
		if (!session) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		return session;
	}
}
