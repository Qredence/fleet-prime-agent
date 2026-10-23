/**
 * Minimal Fleet-owned JSONL client for the Prime Agent daemon supervisor
 * socket (protocol 7). It speaks the command envelope directly so supervisor
 * commands (probe, kill, list, paged saved-session listing, delete) do not
 * depend on the `prime-agent` npm package, whose v0.10.x release exports no
 * client library. Per-session agent connections still use the pinned
 * runtime's `DaemonAgentConnection` until the runtime cutover.
 */
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import {
	createDaemonCommandEnvelope,
	type DaemonAvailableModels,
	type DaemonCommandBody,
	type DaemonErrorInfo,
	type DaemonHelloFrame,
	type DaemonMcpConnections,
	type DaemonModelCatalog,
	type DaemonOutboundFrame,
	type DaemonRemoveMcpConnectionResult,
	type DaemonResourceSnapshot,
	type DaemonResponseFrame,
	type DaemonSetMcpStaticTokenResult,
	type DaemonUnknownFrame,
	isDaemonAvailableModels,
	isDaemonHelloFrame,
	isDaemonMcpConnections,
	isDaemonModelCatalog,
	isDaemonRemoveMcpConnectionResult,
	isDaemonResourceSnapshot,
	isDaemonResponseFrame,
	isDaemonSetMcpStaticTokenResult,
	parseDaemonFrameLine,
	READ_ONLY_DAEMON_COMMANDS,
} from "./daemon-protocol";

export type DaemonFrameListener = (frame: DaemonOutboundFrame | DaemonUnknownFrame) => void;

type PendingRequest = {
	command: string;
	resolve: (response: DaemonResponseFrame) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * A daemon `response` with `success:false`, or a success whose `data` does not
 * match the Fleet-owned shape. `daemonError` is the daemon's own message.
 */
export class DaemonCommandError extends Error {
	readonly command: string;
	readonly daemonError: string | undefined;
	readonly errorInfo: DaemonErrorInfo | undefined;

	constructor(command: string, message: string, options: { daemonError?: string; errorInfo?: DaemonErrorInfo } = {}) {
		super(message);
		this.name = "DaemonCommandError";
		this.command = command;
		this.daemonError = options.daemonError;
		this.errorInfo = options.errorInfo;
	}
}

export class DaemonSocketClient {
	readonly socketPath: string;
	readonly clientId = `fleet-daemon-client:${randomUUID()}`;
	#socket: Socket | undefined;
	#buffer = "";
	#hello: DaemonHelloFrame | undefined;
	#helloWaiters = new Set<{ resolve: (hello: DaemonHelloFrame) => void; reject: (error: Error) => void }>();
	#pending = new Map<string, PendingRequest>();
	#listeners = new Set<DaemonFrameListener>();
	#nextId = 0;
	#closedError: Error | undefined;

	constructor(socketPath: string) {
		this.socketPath = socketPath;
	}

	get hello(): DaemonHelloFrame | undefined {
		return this.#hello;
	}

	connect(timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<void> {
		if (this.#socket) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const socket = createConnection(this.socketPath);
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error(`Timed out connecting to the Prime Agent daemon at ${this.socketPath}`));
			}, timeoutMs);
			socket.setEncoding("utf8");
			socket.once("connect", () => {
				clearTimeout(timer);
				resolve();
			});
			socket.on("data", (chunk: string) => this.#onData(chunk));
			socket.on("error", (error) => {
				clearTimeout(timer);
				this.#fail(error);
				reject(error);
			});
			socket.on("close", () => this.#fail(new Error(`The Prime Agent daemon socket at ${this.socketPath} closed`)));
			this.#socket = socket;
		});
	}

	waitForHello(timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<DaemonHelloFrame> {
		if (this.#hello) return Promise.resolve(this.#hello);
		if (this.#closedError) return Promise.reject(this.#closedError);
		return new Promise((resolve, reject) => {
			const waiter = {
				resolve: (hello: DaemonHelloFrame) => {
					clearTimeout(timer);
					resolve(hello);
				},
				reject: (error: Error) => {
					clearTimeout(timer);
					reject(error);
				},
			};
			const timer = setTimeout(() => {
				this.#helloWaiters.delete(waiter);
				reject(new Error(`Timed out waiting for the Prime Agent daemon hello at ${this.socketPath}`));
			}, timeoutMs);
			this.#helloWaiters.add(waiter);
		});
	}

	/** Every frame that is not the reply to one of this client's requests. */
	onFrame(listener: DaemonFrameListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	request<T = unknown>(
		command: DaemonCommandBody,
		timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<DaemonResponseFrame<T>> {
		const socket = this.#socket;
		if (!socket || socket.destroyed || this.#closedError) {
			return Promise.reject(
				new Error(`Cannot send daemon command "${command.type}": the Prime Agent daemon is not connected`),
			);
		}
		const id = `fleet_${++this.#nextId}`;
		const envelope = createDaemonCommandEnvelope(command, id, this.clientId);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				reject(new Error(`The Prime Agent daemon did not answer "${command.type}" within ${timeoutMs}ms`));
			}, timeoutMs);
			this.#pending.set(id, {
				command: command.type,
				resolve: resolve as (response: DaemonResponseFrame) => void,
				reject,
				timer,
			});
			socket.write(`${JSON.stringify(envelope)}\n`);
		});
	}

	/** `get_model_catalog`: every model plus the providers with configured auth (no network). */
	getModelCatalog(activeSessionId: string, timeoutMs?: number): Promise<DaemonModelCatalog> {
		return this.#typed({ type: "get_model_catalog", activeSessionId }, isDaemonModelCatalog, timeoutMs);
	}

	/** `get_available_models`: only the auth-configured models. */
	getAvailableModels(activeSessionId: string, timeoutMs?: number): Promise<DaemonAvailableModels> {
		return this.#typed({ type: "get_available_models", activeSessionId }, isDaemonAvailableModels, timeoutMs);
	}

	/** `get_resource_snapshot`: context files, skills, prompts and their diagnostics. */
	getResourceSnapshot(activeSessionId: string, timeoutMs?: number): Promise<DaemonResourceSnapshot> {
		return this.#typed({ type: "get_resource_snapshot", activeSessionId }, isDaemonResourceSnapshot, timeoutMs);
	}

	/** `get_mcp_connections` (Rust only): roster, service-catalog cards, api-key slots. */
	getMcpConnections(activeSessionId: string, timeoutMs?: number): Promise<DaemonMcpConnections> {
		return this.#typed({ type: "get_mcp_connections", activeSessionId }, isDaemonMcpConnections, timeoutMs);
	}

	/**
	 * `set_mcp_static_token` (Rust only): store a pasted token for a pasteable
	 * service and verify it. A failed verification still resolves
	 * (`verified:false` + `error`); a refusal (unknown/non-pasteable server,
	 * empty token) rejects with {@link DaemonCommandError}.
	 */
	setMcpStaticToken(
		activeSessionId: string,
		server: string,
		token: string,
		timeoutMs?: number,
	): Promise<DaemonSetMcpStaticTokenResult> {
		return this.#typed(
			{ type: "set_mcp_static_token", activeSessionId, server, token },
			isDaemonSetMcpStaticTokenResult,
			timeoutMs,
		);
	}

	/** `remove_mcp_connection` (Rust only): drop one connection's credential and record. */
	removeMcpConnection(
		activeSessionId: string,
		server: string,
		timeoutMs?: number,
	): Promise<DaemonRemoveMcpConnectionResult> {
		return this.#typed(
			{ type: "remove_mcp_connection", activeSessionId, server },
			isDaemonRemoveMcpConnectionResult,
			timeoutMs,
		);
	}

	async #typed<T>(
		command: DaemonCommandBody,
		guard: (data: unknown) => data is T,
		timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	): Promise<T> {
		const response = await this.request(command, timeoutMs);
		if (!response.success) {
			throw new DaemonCommandError(
				command.type,
				response.error ?? `The Prime Agent daemon refused "${command.type}"`,
				{
					...(response.error !== undefined ? { daemonError: response.error } : {}),
					...(response.errorInfo !== undefined ? { errorInfo: response.errorInfo } : {}),
				},
			);
		}
		if (!guard(response.data)) {
			throw new DaemonCommandError(
				command.type,
				`The Prime Agent daemon returned an invalid "${command.type}" payload`,
			);
		}
		return response.data;
	}

	close(): void {
		const socket = this.#socket;
		this.#fail(new Error("The Prime Agent daemon client was closed"));
		socket?.end();
		socket?.destroy();
	}

	#onData(chunk: string): void {
		this.#buffer += chunk;
		let newline = this.#buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.#buffer.slice(0, newline);
			this.#buffer = this.#buffer.slice(newline + 1);
			this.#onLine(line);
			newline = this.#buffer.indexOf("\n");
		}
	}

	#onLine(line: string): void {
		const frame = parseDaemonFrameLine(line);
		if (!frame) return;
		if (isDaemonHelloFrame(frame)) {
			this.#hello = frame;
			for (const waiter of [...this.#helloWaiters]) waiter.resolve(frame);
			this.#helloWaiters.clear();
		}
		if (isDaemonResponseFrame(frame) && frame.id) {
			const pending = this.#pending.get(frame.id);
			if (pending) {
				clearTimeout(pending.timer);
				this.#pending.delete(frame.id);
				if (!READ_ONLY_DAEMON_COMMANDS.has(pending.command)) this.#acknowledge(frame.id);
				pending.resolve(frame);
				return;
			}
		}
		for (const listener of [...this.#listeners]) {
			try {
				listener(frame);
			} catch {
				// A consumer failure must not interrupt protocol parsing.
			}
		}
	}

	/** Mutating commands are acknowledged so the daemon can drop the replay record. */
	#acknowledge(commandId: string): void {
		const socket = this.#socket;
		if (!socket || socket.destroyed) return;
		const id = `fleet_ack_${++this.#nextId}`;
		socket.write(
			`${JSON.stringify(createDaemonCommandEnvelope({ type: "ack_result", commandId }, id, this.clientId))}\n`,
		);
	}

	#fail(error: Error): void {
		if (this.#closedError) return;
		this.#closedError = error;
		for (const waiter of this.#helloWaiters) waiter.reject(error);
		this.#helloWaiters.clear();
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.#pending.clear();
	}
}
