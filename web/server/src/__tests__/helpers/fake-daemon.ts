import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeDaemonEnvelope = {
	type: "command";
	id: string;
	protocol: { name: string; version: number };
	clientId?: string;
	command: { type: string; id?: string; [key: string]: unknown };
};

export type FakeDaemonReply = (
	envelope: FakeDaemonEnvelope,
	socket: Socket,
) => Record<string, unknown> | Array<Record<string, unknown>> | undefined;

/** A protocol-7 daemon double on a private unix socket; records every envelope. */
export async function startFakeDaemon(options: {
	hello: Record<string, unknown>;
	reply?: FakeDaemonReply;
}): Promise<{ socketPath: string; received: FakeDaemonEnvelope[]; sockets: Socket[]; close: () => Promise<void> }> {
	const directory = mkdtempSync(join(tmpdir(), "fd-"));
	const socketPath = join(directory, "d.sock");
	const received: FakeDaemonEnvelope[] = [];
	const sockets: Socket[] = [];
	const server: Server = createServer((socket) => {
		sockets.push(socket);
		socket.setEncoding("utf8");
		socket.write(`${JSON.stringify(options.hello)}\n`);
		let buffer = "";
		socket.on("data", (chunk: string) => {
			buffer += chunk;
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				newline = buffer.indexOf("\n");
				if (!line.trim()) continue;
				const envelope = JSON.parse(line) as FakeDaemonEnvelope;
				received.push(envelope);
				const reply = options.reply?.(envelope, socket);
				for (const frame of Array.isArray(reply) ? reply : reply ? [reply] : []) {
					socket.write(`${JSON.stringify(frame)}\n`);
				}
			}
		});
		socket.on("error", () => undefined);
	});
	await new Promise<void>((resolve) => server.listen(socketPath, resolve));
	return {
		socketPath,
		received,
		sockets,
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(directory, { recursive: true, force: true });
		},
	};
}

export function okResponse(envelope: FakeDaemonEnvelope, data?: unknown): Record<string, unknown> {
	return {
		type: "response",
		id: envelope.id,
		command: envelope.command.type,
		success: true,
		...(data !== undefined ? { data } : {}),
	};
}
