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
	type DaemonCommandBody,
	type DaemonHelloFrame,
	type DaemonOutboundFrame,
	type DaemonResponseFrame,
	type DaemonUnknownFrame,
	isDaemonHelloFrame,
	isDaemonResponseFrame,
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
