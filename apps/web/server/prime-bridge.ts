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
import type {
	AgentSession,
	AgentSessionEvent,
	SessionInfo,
} from "@earendil-works/pi-coding-agent"
import {
	createAgentSession,
	SessionManager,
} from "@earendil-works/pi-coding-agent"
import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type {
	AssistantMessage,
	ImageContent,
	TextContent,
	UserMessage,
} from "@earendil-works/pi-ai"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import { IpythonKernelProvisioner } from "@earendil-works/pi-coding-agent"
import type {
	ChatMessage,
	ChatQuestionAnswer,
	ChatStreamEvent,
} from "@prime-agent/web-protocol"

import { createEventMapperState, mapAgentSessionEvent } from "./event-mapper"
import { RingBuffer } from "./ring-buffer"
import { PendingDialogRegistry } from "./pending-dialogs"

// ---------------------------------------------------------------------------
// Local structural types — these match prime-agent's ExtensionUIContext but
// are re-declared here so we don't need runtime imports that might ride
// along beyond what the route layer actually triggers.
// ---------------------------------------------------------------------------

type UIContextCtorArgs = {
	sessionId: string
	emitFrame: (frame: ChatStreamEvent) => void
	dialogs: PendingDialogRegistry
}

type UIConfirmOptions = { timeout?: number }
type UISelectOptions = { timeout?: number }
type UIInputOptions = { timeout?: number }

// A `ChatStreamEvent`-aware `ExtensionUIContext` — narrow structural type
// covering the methods prime-agent actually invokes. We don't import the
// full class to keep this file free of runtime imports (helps vitest).
class WebUIContext {
	readonly #sessionId: string
	readonly #emit: (frame: ChatStreamEvent) => void
	readonly #dialogs: PendingDialogRegistry

	constructor({ sessionId, emitFrame, dialogs }: UIContextCtorArgs) {
		this.#sessionId = sessionId
		this.#emit = emitFrame
		this.#dialogs = dialogs
	}

	async select(
		title: string,
		options: readonly string[],
		_opts?: UISelectOptions,
	): Promise<string | undefined> {
		const toolCallId = crypto.randomUUID()
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
		})
		return (dialog as { choice: string } | undefined)?.choice
	}

	async confirm(
		title: string,
		message: string,
		_opts?: UIConfirmOptions,
	): Promise<boolean> {
		const toolCallId = crypto.randomUUID()
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
		})
		return Boolean(dialog)
	}

	async input(
		title: string,
		placeholder?: string,
		_opts?: UIInputOptions,
	): Promise<string | undefined> {
		const toolCallId = crypto.randomUUID()
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
		})
		return (dialog as { text: string } | undefined)?.text
	}

	notify(message: string, type: "info" | "warning" | "error" = "info"): void {
		const prefix = type === "info" ? "" : `${type.toUpperCase()}: `
		this.#emit({
			type: "state",
			state: { name: "agent_start", message: `${prefix}${message}` },
		})
	}

	onTerminalInput(_handler: unknown): () => void {
		return () => {}
	}

	setStatus(key: string, text: string | undefined): void {
		this.#emit({
			type: "state",
			state: { name: "agent_start", message: `[${key}] ${text ?? ""}` },
		})
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
		return Promise.resolve(undefined as unknown as T)
	}
	pasteToEditor(_text: string): void {}
	setEditorText(_text: string): void {}
	getEditorText(): string {
		return ""
	}
	editor(_title: string, _prefill?: string): Promise<string | undefined> {
		return Promise.resolve(undefined)
	}
	addAutocompleteProvider(_factory: unknown): void {}
	setEditorComponent(_factory: unknown): void {}
	getEditorComponent(): unknown {
		return undefined
	}
	readonly theme = {} as never
	getAllThemes(): { name: string; path: string | undefined }[] {
		return []
	}
	getTheme(_name: string): unknown {
		return undefined
	}
	setTheme(_theme: string | unknown): { success: boolean; error?: string } {
		return { success: false, error: "not in browser" }
	}
	getToolsExpanded(): boolean {
		return true
	}
	setToolsExpanded(_expanded: boolean): void {}
}

// Cast our class to the broader ExtensionUIContext type so AgentSession
// accepts it. The structural missing members would only matter if
// prime-agent's runtime *accessed* them — ExtensionUIContext is otherwise an
// interface prime-agent calls through, not constructs.
function asExtensionUIContext(ctx: WebUIContext): unknown {
	return ctx as unknown
}

// ---------------------------------------------------------------------------
// Bridge types
// ---------------------------------------------------------------------------

export interface BridgeSession {
	readonly sessionId: string
	readonly cwd: string
	readonly sessionPath: string
	readonly session: AgentSession
	readonly mapperState: ReturnType<typeof createEventMapperState>
	readonly uiContext: WebUIContext
}

export interface CreateSessionOptions {
	readonly cwd: string
	readonly model?: unknown
	readonly thinkingLevel?: ThinkingLevel
}

export type BridgeEventListener = (
	sessionId: string,
	frame: ChatStreamEvent,
) => void

export interface PrimeBridgeOptions {
	readonly kernelTimeoutMs?: number
	readonly ringBufferCapacity?: number
	readonly dialogTimeoutMs?: number
}

export class PrimeBridge {
	readonly #sessions = new Map<string, BridgeSession>()
	readonly #listeners = new Set<BridgeEventListener>()
	readonly #ringBuffers = new Map<string, RingBuffer>()
	readonly #dialogs: PendingDialogRegistry
	readonly #kernelTimeoutMs: number
	readonly #ringBufferCapacity: number
	#kernelReady: Promise<void> | null = null

	constructor(options: PrimeBridgeOptions = {}) {
		this.#kernelTimeoutMs = options.kernelTimeoutMs ?? 30_000
		this.#ringBufferCapacity = options.ringBufferCapacity ?? 500
		this.#dialogs = new PendingDialogRegistry({
			defaultTimeoutMs: options.dialogTimeoutMs ?? 60_000,
			emitFrame: (sessionId, frame) => this.#dispatch(sessionId, frame),
		})
	}

	/** Late-boot kernel readiness gate. Boot-time callers await this; failures cause `/api/chat/new` to 503. */
	async ensureKernelReady(cwd?: string): Promise<void> {
		if (!this.#kernelReady) {
			this.#kernelReady = (async () => {
				// IpythonKernelProvisioner takes the session's cwd; for the boot-time
				// readiness gate we use the server's working directory as a probe.
				const provisioner = new IpythonKernelProvisioner(cwd ?? process.cwd())
				const timeout = new Promise<never>((_r, reject) =>
					setTimeout(
						() => reject(new Error("IPython kernel bootstrap timeout")),
						this.#kernelTimeoutMs,
					),
				)
				await Promise.race([provisioner.ensure(), timeout])
			})()
		}
		return this.#kernelReady
	}

	kernelReadyState(): { ok: boolean; reason?: string } {
		if (this.#kernelReady === null) return { ok: false, reason: "not-started" }
		let done = false
		let error: unknown = undefined
		this.#kernelReady
			.then(() => {
				done = true
			})
			.catch((err) => {
				done = true
				error = err
			})
		if (!done) return { ok: false, reason: "pending" }
		if (error) {
			return {
				ok: false,
				reason: error instanceof Error ? error.message : String(error),
			}
		}
		return { ok: true }
	}

	addEventListener(listener: BridgeEventListener): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	/** Emit a frame to ring buffer (SSE replay) and all live listeners. */
	#dispatch(sessionId: string, frame: ChatStreamEvent): void {
		const buffer = this.#ringBuffers.get(sessionId)
		if (buffer) {
			buffer.push({ sessionId, frame })
		}
		for (const listener of this.#listeners) {
			listener(sessionId, frame)
		}
	}

	#ringBufferFor(sessionId: string): RingBuffer {
		let existing = this.#ringBuffers.get(sessionId)
		if (!existing) {
			existing = new RingBuffer(this.#ringBufferCapacity)
			this.#ringBuffers.set(sessionId, existing)
		}
		return existing
	}

	/** Replay buffered frames since `lastEventId`. */
	replaySince(
		sessionId: string,
		lastEventId: number,
	): { replayed: readonly { seq: number; event: unknown }[]; overflowed: boolean } {
		const buffer = this.#ringBufferFor(sessionId)
		return buffer.replaySince(lastEventId)
	}

	/** Test-only: reset state. */
	resetForTests(): void {
		this.#sessions.clear()
		this.#listeners.clear()
		this.#ringBuffers.clear()
		this.#kernelReady = null
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
		})
		const { session, extensionsResult: _ext } = await createAgentSession({
			cwd: options.cwd,
		})
		// Force-flush the session header to disk eagerly so /api/chat/sessions and
		// future `resumeSessionById` calls (across Vite SSR restarts) can find it.
		// `materializeSessionFile()` returns the planned path but skips the actual
		// write — `_persist()` defers all writes until the first assistant message
		// (anti dangling-session guard for the interactive CLI). For the web bridge
		// we want the header durable *now*, so we call `flushNow()` instead, which
		// bypasses that guard intentionally.
		const sessionFile = session.sessionManager.materializeSessionFile()
		session.sessionManager.flushNow()
		const sessionId = session.sessionManager.getSessionId()
		const uiContext = new WebUIContext({
			sessionId,
			emitFrame: (frame) => this.#dispatch(sessionId, frame),
			dialogs: this.#dialogs,
		})
		await session.bindExtensions({
			uiContext: asExtensionUIContext(uiContext) as never,
		})

		const mapperState = createEventMapperState()
		const bridgeSession: BridgeSession = {
			sessionId,
			cwd: options.cwd,
			sessionPath: sessionFile,
			session,
			mapperState,
			uiContext,
		}

		// Subscribe session events → mapper → ring buffer.
		session.subscribe((event) => {
			if (process.env.PRIME_BRIDGE_DEBUG === "1") {
				try {
					process.stderr.write(
						`[bridge:${sessionId.slice(0, 8)}] event ${event.type} ${JSON.stringify(event).slice(0, 200)}\n`,
					)
				} catch {
					/* ignore */
				}
			}
			const frames = mapAgentSessionEvent(mapperState, event as AgentSessionEvent)
			for (const frame of frames) {
				this.#dispatch(sessionId, frame)
			}
		})

		if (options.model) {
			await session.setModel(options.model as Parameters<typeof session.setModel>[0])
		}
		if (options.thinkingLevel) {
			await session.setThinkingLevel(options.thinkingLevel)
		}

		this.#sessions.set(sessionId, bridgeSession)
		this.#ringBufferFor(sessionId) // Pre-create so SSE attaches safely.
		return bridgeSession
	}

	/** Hot-lookup by id; reuse the live session if we already have one loaded. */
	getSession(sessionId: string): BridgeSession | undefined {
		return this.#sessions.get(sessionId)
	}

	/** Resume a persisted prime-agent session from its JSONL transcript. */
	async resumeSessionByPath(sessionPath: string): Promise<BridgeSession> {
		// If a live session already owns this path, reuse it.
		for (const [sessionId, session] of this.#sessions) {
			if (session.sessionPath === sessionPath) {
				return this.#sessions.get(sessionId)!
			}
		}
		const sessionManager = await SessionManager.openAsync(sessionPath)
		const agentSessionResult = await createAgentSession({
			cwd: sessionManager.getCwd(),
			sessionManager,
		})
		const sessionId = agentSessionResult.session.sessionManager.getSessionId()
		const uiContext = new WebUIContext({
			sessionId,
			emitFrame: (frame) => this.#dispatch(sessionId, frame),
			dialogs: this.#dialogs,
		})
		await agentSessionResult.session.bindExtensions({
			uiContext: asExtensionUIContext(uiContext) as never,
		})
		const mapperState = createEventMapperState()
		agentSessionResult.session.subscribe((event) => {
			const frames = mapAgentSessionEvent(mapperState, event as AgentSessionEvent)
			for (const frame of frames) {
				this.#dispatch(sessionId, frame)
			}
		})
		const bridgeSession: BridgeSession = {
			sessionId,
			cwd: sessionManager.getCwd(),
			sessionPath,
			session: agentSessionResult.session,
			mapperState,
			uiContext,
		}
		this.#sessions.set(sessionId, bridgeSession)
		return bridgeSession
	}

	async resumeSessionById(sessionId: string): Promise<BridgeSession | undefined> {
		const live = this.#sessions.get(sessionId)
		if (live) return live
		const all = await SessionManager.listAll()
		const match = all.find((info) => info.id === sessionId)
		if (!match) return undefined
		return this.resumeSessionByPath(match.path)
	}

	async listSessions(cwd?: string): Promise<readonly SessionInfo[]> {
		if (cwd) {
			return await SessionManager.list(cwd)
		}
		return await SessionManager.listAll()
	}

	async deleteSession(sessionId: string): Promise<boolean> {
		const existing = this.#sessions.get(sessionId)
		if (!existing) return false
		this.#dialogs.cancelAll(sessionId, "server-shutdown")
		this.#sessions.delete(sessionId)
		this.#ringBuffers.delete(sessionId)
		return true
	}

	// -----------------------------------------------------------------------
	// Session actions
	// -----------------------------------------------------------------------

	async prompt(
		sessionId: string,
		text: string,
		options?: {
			images?: ImageContent[]
			streamingBehavior?: "steer" | "followUp"
		},
	): Promise<void> {
		const session = this.#requireSession(sessionId)
		if (process.env.PRIME_BRIDGE_DEBUG === "1") {
			process.stderr.write(
				`[bridge:${sessionId.slice(0, 8)}] prompt model=${session.session.agent?.state?.model?.provider ?? "?"}/${session.session.agent?.state?.model?.id ?? "?"} thinkingLevel=${session.session.agent?.state?.thinkingLevel ?? "?"}\n`,
			)
		}
		await session.session.prompt(text, {
			images: options?.images,
			streamingBehavior: options?.streamingBehavior,
		})
	}

	async steer(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId)
		await session.session.steer(text)
	}

	async followUp(sessionId: string, text: string): Promise<void> {
		const session = this.#requireSession(sessionId)
		await session.session.followUp(text)
	}

	async abort(sessionId: string): Promise<void> {
		const session = this.#requireSession(sessionId)
		this.#dialogs.cancelAll(sessionId, "user-abort")
		await session.session.abort()
	}

	async setModel(sessionId: string, model: unknown): Promise<void> {
		const session = this.#requireSession(sessionId)
		await session.session.setModel(model as Parameters<typeof session.session.setModel>[0])
	}

	async setThinkingLevel(level: ThinkingLevel): Promise<void> {
		for (const session of this.#sessions.values()) {
			await session.session.setThinkingLevel(level)
		}
	}

	// -----------------------------------------------------------------------
	// Dialog answering
	// -----------------------------------------------------------------------

	/**
	 * Resolve a pending `ExtensionUIContext` dialog. Returns true iff the
	 * `toolCallId` was registered and answered.
	 */
	answerDialog(
		sessionId: string,
		toolCallId: string,
		answer: ChatQuestionAnswer,
	): boolean {
		if (answer.kind === "skip") {
			return this.#dialogs.cancel(sessionId, toolCallId, "user-abort")
		}
		if (answer.kind === "single" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choice: answer.selectedIds[0],
			})
		}
		if (answer.kind === "multi" && answer.selectedIds && answer.selectedIds.length > 0) {
			return this.#dialogs.answer(sessionId, toolCallId, {
				choice: answer.selectedIds[0],
			})
		}
		if (answer.kind === "text" && typeof answer.text === "string") {
			return this.#dialogs.answer(sessionId, toolCallId, { text: answer.text })
		}
		// Unknown shape → reject so the agent loop sees a cancelled dialog.
		return this.#dialogs.cancel(sessionId, toolCallId, "user-abort")
	}

	pendingDialogsFor(sessionId: string) {
		return this.#dialogs.list(sessionId)
	}

	// -----------------------------------------------------------------------
	// Message hydration (for /session eager-load on the client)
	// -----------------------------------------------------------------------

	/** Reads message history from a live session, or from the JSONL transcript for a cold session. */
	async getMessages(sessionId: string): Promise<readonly ChatMessage[]> {
		const live = this.#sessions.get(sessionId)
		const messages: readonly AgentMessage[] = live
			? live.session.sessionManager.buildSessionContext().messages
			: await this.#loadColdMessages(sessionId)
		return messages.map((msg, idx) => this.#toChatMessage(sessionId, msg, idx))
	}

	async #loadColdMessages(sessionId: string): Promise<readonly AgentMessage[]> {
		const all = await SessionManager.listAll()
		const match = all.find((info) => info.id === sessionId)
		if (!match) return []
		const sessionManager = await SessionManager.openAsync(match.path)
		const context = sessionManager.buildSessionContext()
		return context.messages
	}

	#toChatMessage(
		sessionId: string,
		msg: AgentMessage,
		index: number,
	): ChatMessage {
		const id = `${sessionId}-m${index}`
		if (msg.role === "assistant") {
			const assistantMsg = msg as AssistantMessage
			const parts: ChatMessage["parts"] = []
			for (const block of assistantMsg.content) {
				if (block.type === "text") {
					parts.push({ type: "text", text: block.text })
				} else if (block.type === "thinking") {
					parts.push({
						type: "tool-Thinking",
						state: "output-available",
						input: { text: block.thinking },
						output: { text: block.thinking },
					} as const)
				} else if (block.type === "toolCall") {
					parts.push({
						type: `tool-${block.name.charAt(0).toUpperCase()}${block.name.slice(1)}`,
						toolCallId: block.id,
						state: "output-available",
						input: block.arguments,
					} as const)
				}
			}
			return { id, role: "assistant", parts }
		}
		if (msg.role === "user") {
			const user = msg as UserMessage
			const parts: ChatMessage["parts"] = []
			if (typeof user.content === "string") {
				parts.push({ type: "text", text: user.content })
			} else if (Array.isArray(user.content)) {
				for (const block of user.content) {
					if (
						block &&
						typeof block === "object" &&
						"type" in block &&
						block.type === "text"
					) {
						parts.push({
							type: "text",
							text: (block as TextContent).text,
						})
					}
				}
			}
			return { id, role: "user", parts }
		}
		// toolResult / custom — drop for v1.
		return { id, role: "assistant", parts: [] }
	}

	#requireSession(sessionId: string): BridgeSession {
		const session = this.#sessions.get(sessionId)
		if (!session) {
			throw new Error(`Unknown session: ${sessionId}`)
		}
		return session
	}
}
