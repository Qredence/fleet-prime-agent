/**
 * Pending-dialog registry.
 *
 * decouples ExtensionUIContext dialog promises (`confirm`, `select`, `input`)
 * from the lifetime of any particular SSE connection. An agent run may
 * outlive the tab that triggered it; a new tab replays pending dialogs from
 * the ring buffer and answers via `POST /api/chat/question` regardless of
 * which client originally saw the question.
 *
 * Each entry has a 60s timeout — on expiry the dialog auto-cancels, the
 * agent's await rejects with `{ cancelled: true }`, and we emit a
 * `tool-Question` frame with `state: "output-error"` so connected UIs clear
 * the card.
 */
import type {
	ChatClarificationQuestion,
	ChatPendingDialog,
	ChatStreamEvent,
	ChatToolPart,
} from "@prime-agent/web-protocol";

export interface PendingDialog {
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly kind: "confirm" | "select" | "input" | "questions";
	readonly title: string;
	readonly message: string;
	readonly options?: readonly string[];
	readonly questions?: readonly ChatClarificationQuestion[];
	readonly placeholder?: string;
	readonly createdAt: number;
	readonly timeoutMs?: number;
	resolve: (value: unknown) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
}

export type PendingDialogCancelReason = "user-abort" | "timeout" | "server-shutdown";

export interface PendingDialogRegistryOptions {
	readonly defaultTimeoutMs?: number;
	readonly emitFrame: (sessionId: string, frame: ChatStreamEvent) => void;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class PendingDialogRegistry {
	private readonly bySession = new Map<string, Map<string, PendingDialog>>();
	private readonly defaultTimeoutMs: number;
	private readonly emitFrame: (sessionId: string, frame: ChatStreamEvent) => void;

	constructor(options: PendingDialogRegistryOptions) {
		this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.emitFrame = options.emitFrame;
	}

	get(sessionId: string, toolCallId: string): PendingDialog | undefined {
		return this.bySession.get(sessionId)?.get(toolCallId);
	}

	list(sessionId: string): readonly PendingDialog[] {
		const map = this.bySession.get(sessionId);
		return map ? [...map.values()] : [];
	}

	snapshot(sessionId: string): readonly ChatPendingDialog[] {
		return this.list(sessionId).map((d) => ({
			sessionId: d.sessionId,
			toolCallId: d.toolCallId,
			kind: d.kind,
			title: d.title,
			...(d.message ? { message: d.message } : {}),
			...(d.options ? { options: [...d.options] } : {}),
			...(d.questions ? { questions: [...d.questions] } : {}),
			...(d.placeholder ? { placeholder: d.placeholder } : {}),
			createdAt: d.createdAt,
			...(d.timeoutMs !== undefined ? { timeoutMs: d.timeoutMs } : {}),
		}));
	}

	async open<T>(args: {
		sessionId: string;
		toolCallId: string;
		kind: PendingDialog["kind"];
		title: string;
		message: string;
		options?: readonly string[];
		questions?: readonly ChatClarificationQuestion[];
		placeholder?: string;
		timeoutMs?: number;
		signalFrame: ChatToolPart;
	}): Promise<T> {
		const map = this.forSession(args.sessionId);
		const timeoutDuration = args.timeoutMs ?? this.defaultTimeoutMs;
		return await new Promise<T>((resolve, reject) => {
			let settled = false;
			const dialog: PendingDialog = {
				sessionId: args.sessionId,
				toolCallId: args.toolCallId,
				kind: args.kind,
				title: args.title,
				message: args.message,
				options: args.options,
				questions: args.questions,
				placeholder: args.placeholder,
				createdAt: Date.now(),
				timeoutMs: timeoutDuration,
				resolve: (value: unknown) => {
					if (settled) return;
					settled = true;
					resolve(value as T);
				},
				reject: (err: Error) => {
					if (settled) return;
					settled = true;
					reject(err);
				},
				timer: setTimeout(() => {
					if (settled) return;
					// Auto-cancel after timeout: the agent loop sees a clear reject reason.
					this.cancel(args.sessionId, args.toolCallId, "timeout");
				}, timeoutDuration),
			};
			map.set(args.toolCallId, dialog);
			this.emitFrame(args.sessionId, { type: "tool", part: args.signalFrame });
		});
	}

	/**
	 * Resolve a pending dialog on `POST /api/chat/question`. Returns true iff a
	 * pending entry was found (caller returns 404 when false so the client can
	 * distinguish "already answered" from "unknown toolCallId").
	 */
	answer(sessionId: string, toolCallId: string, answer: unknown): boolean {
		const dialog = this.get(sessionId, toolCallId);
		if (!dialog) return false;
		clearTimeout(dialog.timer);
		this.bySession.get(sessionId)?.delete(toolCallId);
		dialog.resolve(answer);
		return true;
	}

	/**
	 * Cancel a pending dialog, emitting a `tool-Question` cancellation frame so
	 * connected/replaying UIs can clear the question card.
	 */
	cancel(sessionId: string, toolCallId: string, reason: PendingDialogCancelReason): boolean {
		const dialog = this.get(sessionId, toolCallId);
		if (!dialog) return false;
		clearTimeout(dialog.timer);
		this.bySession.get(sessionId)?.delete(toolCallId);
		const frame: ChatStreamEvent = {
			type: "tool",
			part: {
				type: "tool-Question",
				toolCallId,
				state: "output-error",
				output: {
					cancelled: true,
					reason,
					title: dialog.title,
				},
			},
		};
		this.emitFrame(sessionId, frame);
		dialog.reject(new Error(`Question cancelled: ${reason}`));
		return true;
	}

	/** Cancel every pending dialog in a session (used by `abort` and shutdown). */
	cancelAll(sessionId: string, reason: PendingDialogCancelReason): number {
		const pending = this.list(sessionId);
		for (const dialog of pending) {
			if (this.bySession.get(sessionId)?.get(dialog.toolCallId) === undefined) {
				continue;
			}
			this.cancel(sessionId, dialog.toolCallId, reason);
		}
		return pending.length;
	}

	private forSession(sessionId: string): Map<string, PendingDialog> {
		let existing = this.bySession.get(sessionId);
		if (!existing) {
			existing = new Map();
			this.bySession.set(sessionId, existing);
		}
		return existing;
	}
}
