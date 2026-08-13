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

import type { AgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";
import type { AgentSession, AgentSessionEvent, SessionEntry, SessionInfo } from "@earendil-works/pi-coding-agent";
import { createAgentSession, IpythonKernelProvisioner, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ChatMessage, ChatQuestionAnswer, ChatStreamEvent } from "@prime-agent/web-protocol";

import { createEventMapperState, mapAgentSessionEvent } from "./event-mapper";
import { PendingDialogRegistry } from "./pending-dialogs";
import { getPrimeConfig } from "./prime-config";
import { RingBuffer } from "./ring-buffer";

// ---------------------------------------------------------------------------
// Local structural types — these match prime-agent's ExtensionUIContext but
// are re-declared here so we don't need runtime imports that might ride
// along beyond what the route layer actually triggers.
// ---------------------------------------------------------------------------

type UIContextCtorArgs = {
	sessionId: string;
	emitFrame: (frame: ChatStreamEvent) => void;
	dialogs: PendingDialogRegistry;
};

type UIConfirmOptions = { timeout?: number };
type UISelectOptions = { timeout?: number };
type UIInputOptions = { timeout?: number };

// A `ChatStreamEvent`-aware `ExtensionUIContext` — narrow structural type
// covering the methods prime-agent actually invokes. We don't import the
// full class to keep this file free of runtime imports (helps vitest).
class WebUIContext {
	readonly #sessionId: string;
	readonly #emit: (frame: ChatStreamEvent) => void;
	readonly #dialogs: PendingDialogRegistry;

	constructor({ sessionId, emitFrame, dialogs }: UIContextCtorArgs) {
		this.#sessionId = sessionId;
		this.#emit = emitFrame;
		this.#dialogs = dialogs;
	}

	async select(title: string, options: readonly string[], _opts?: UISelectOptions): Promise<string | undefined> {
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

	async confirm(title: string, message: string, _opts?: UIConfirmOptions): Promise<boolean> {
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

	async input(title: string, placeholder?: string, _opts?: UIInputOptions): Promise<string | undefined> {
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

	onTerminalInput(_handler: unknown): () => void {
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
	setWorkingIndicator(_options?: unknown): void {}
	setHiddenThinkingLabel(_label?: string): void {}
	setWidget(_key: string, _content?: unknown, _options?: unknown): void {}
	setFooter(_factory?: unknown): void {}
	setHeader(_factory?: unknown): void {}
	setTitle(_title: string): void {}
	custom<T>(_factory: unknown, _options?: unknown): Promise<T> {
		return Promise.resolve(undefined as unknown as T);
	}
	pasteToEditor(_text: string): void {}
	setEditorText(_text: string): void {}
	getEditorText(): string {
		return "";
	}
	editor(_title: string, _prefill?: string): Promise<string | undefined> {
		return Promise.resolve(undefined);
	}
	addAutocompleteProvider(_factory: unknown): void {}
	setEditorComponent(_factory: unknown): void {}
	getEditorComponent(): unknown {
		return undefined;
	}
	readonly theme = {} as never;
	getAllThemes(): { name: string; path: string | undefined }[] {
		return [];
	}
	getTheme(_name: string): unknown {
		return undefined;
	}
	setTheme(_theme: string | unknown): { success: boolean; error?: string } {
		return { success: false, error: "not in browser" };
	}
	getToolsExpanded(): boolean {
		return true;
	}
	setToolsExpanded(_expanded: boolean): void {}
}

// Cast our class to the broader ExtensionUIContext type so AgentSession
// accepts it. The structural missing members would only matter if
// prime-agent's runtime *accessed* them — ExtensionUIContext is otherwise an
// interface prime-agent calls through, not constructs.
function asExtensionUIContext(ctx: WebUIContext): unknown {
	return ctx as unknown;
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
	readonly cwd: string;
	readonly sessionPath: string;
	readonly session: AgentSession;
	readonly mapperState: ReturnType<typeof createEventMapperState>;
	readonly uiContext: WebUIContext;
}

export interface CreateSessionOptions {
	readonly cwd: string;
	readonly model?: unknown;
	readonly thinkingLevel?: ThinkingLevel;
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

export class PrimeBridge {
	readonly #sessions = new Map<string, BridgeSession>();
	readonly #listeners = new Set<BridgeEventListener>();
	readonly #ringBuffers = new Map<string, RingBuffer>();
	readonly #dialogs: PendingDialogRegistry;
	readonly #kernelTimeoutMs: number;
	readonly #ringBufferCapacity: number;
	#kernelReady: Promise<void> | null = null;

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
		if (!this.#kernelReady) {
			this.#kernelReady = (async () => {
				// IpythonKernelProvisioner takes the session's cwd; for the boot-time
				// readiness gate we use the server's working directory as a probe.
				const provisioner = new IpythonKernelProvisioner(cwd ?? process.cwd());
				const timeout = new Promise<never>((_r, reject) =>
					setTimeout(() => reject(new Error("IPython kernel bootstrap timeout")), this.#kernelTimeoutMs),
				);
				await Promise.race([provisioner.ensure(), timeout]);
			})();
		}
		return this.#kernelReady;
	}

	kernelReadyState(): { ok: boolean; reason?: string } {
		if (this.#kernelReady === null) return { ok: false, reason: "not-started" };
		let done = false;
		let error: unknown;
		this.#kernelReady
			.then(() => {
				done = true;
			})
			.catch((err) => {
				done = true;
				error = err;
			});
		if (!done) return { ok: false, reason: "pending" };
		if (error) {
			return {
				ok: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
		return { ok: true };
	}

	addEventListener(listener: BridgeEventListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Emit a frame to ring buffer (SSE replay) and all live listeners. */
	#dispatch(sessionId: string, frame: ChatStreamEvent): void {
		const buffer = this.#ringBuffers.get(sessionId);
		if (buffer) {
			buffer.push({ sessionId, frame });
		}
		for (const listener of this.#listeners) {
			listener(sessionId, frame);
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
		this.#sessions.clear();
		this.#listeners.clear();
		this.#ringBuffers.clear();
		this.#kernelReady = null;
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
		void this.ensureKernelReady().catch(() => {
			/* backgrounded; failures surface on first tool use */
		});
		const { session, extensionsResult: _ext } = await createAgentSession({
			cwd: options.cwd,
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
		);
		if (options.model) {
			await session.setModel(options.model as Parameters<typeof session.setModel>[0]);
		}
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
	async #registerSession(session: AgentSession, cwd: string, sessionPath: string): Promise<BridgeSession> {
		const sessionId = session.sessionManager.getSessionId();
		const uiContext = new WebUIContext({
			sessionId,
			emitFrame: (frame) => this.#dispatch(sessionId, frame),
			dialogs: this.#dialogs,
		});
		await session.bindExtensions({
			uiContext: asExtensionUIContext(uiContext) as never,
		});

		const mapperState = createEventMapperState();
		const bridgeSession: BridgeSession = {
			sessionId,
			cwd,
			sessionPath,
			session,
			mapperState,
			uiContext,
		};

		// Subscribe session events → mapper → ring buffer.
		session.subscribe((event) => {
			if (process.env.PRIME_BRIDGE_DEBUG === "1") {
				try {
					process.stderr.write(
						`[bridge:${sessionId.slice(0, 8)}] event ${event.type} ${JSON.stringify(event).slice(0, 200)}\n`,
					);
				} catch {
					/* ignore */
				}
			}
			const frames = mapAgentSessionEvent(mapperState, event as AgentSessionEvent);
			for (const frame of frames) {
				this.#dispatch(sessionId, frame);
			}
		});

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
		const agentSessionResult = await createAgentSession({
			cwd: sessionManager.getCwd(),
			sessionManager,
		});
		return this.#registerSession(agentSessionResult.session, sessionManager.getCwd(), sessionPath);
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
		if (!existing) return false;
		this.#dialogs.cancelAll(sessionId, "server-shutdown");
		this.#sessions.delete(sessionId);
		this.#ringBuffers.delete(sessionId);
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
		},
	): Promise<void> {
		const session = this.#requireSession(sessionId);
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

	async setModel(sessionId: string, model: unknown): Promise<void> {
		const session = this.#requireSession(sessionId);
		// Hydrate the model against the registry so `api` (and any other canonical
		// field the client omits) is always present. The web client sends a
		// `{provider, id}` pair; the ModelRegistry is the single source of truth
		// for the resolved `Model` the kernel needs to stream with.
		let resolved = model as Parameters<typeof session.session.setModel>[0];
		if (model && typeof model === "object" && !Array.isArray(model) && "provider" in model && "id" in model) {
			const { provider, id, ...rest } = model as {
				provider: string;
				id: string;
			};
			try {
				const config = getPrimeConfig();
				const found = config.modelRegistry.find(provider, id) as Record<string, unknown> | undefined;
				if (found) {
					resolved = { ...found, ...rest } as Parameters<typeof session.session.setModel>[0];
				}
			} catch {
				/* fall through with raw model */
			}
		}
		await session.session.setModel(resolved);
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		for (const session of this.#sessions.values()) {
			await session.session.setThinkingLevel(level);
		}
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
		for (const session of this.#sessions.values()) {
			await session.session.reload();
		}
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

		const { session: forked } = await createAgentSession({
			cwd: bridge.cwd,
			sessionManager: side,
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

		await this.#registerSession(forked, bridge.cwd, forked.sessionManager.getSessionFile() ?? "");
		return {
			cancelled: false,
			selectedText,
			newSessionId: forked.sessionManager.getSessionId(),
		};
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
			const assistantMsg = msg as AssistantMessage;
			const parts: ChatMessage["parts"] = [];
			for (const block of assistantMsg.content) {
				if (block.type === "text") {
					parts.push({ type: "text", text: block.text });
				} else if (block.type === "thinking") {
					parts.push({
						type: "tool-Thinking",
						state: "output-available",
						input: { text: block.thinking },
						output: { text: block.thinking },
					} as const);
				} else if (block.type === "toolCall") {
					parts.push({
						type: `tool-${block.name.charAt(0).toUpperCase()}${block.name.slice(1)}`,
						toolCallId: block.id,
						state: "output-available",
						input: block.arguments,
					} as const);
				}
			}
			return { id, role: "assistant", parts };
		}
		if (msg.role === "user") {
			const user = msg as UserMessage;
			const parts: ChatMessage["parts"] = [];
			if (typeof user.content === "string") {
				parts.push({ type: "text", text: user.content });
			} else if (Array.isArray(user.content)) {
				for (const block of user.content) {
					if (block && typeof block === "object" && "type" in block && block.type === "text") {
						parts.push({
							type: "text",
							text: (block as TextContent).text,
						});
					}
				}
			}
			return { id, role: "user", parts };
		}
		// toolResult / custom — drop for v1.
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
