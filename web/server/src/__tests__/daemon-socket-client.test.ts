import { DaemonClient } from "prime-agent";
import { afterEach, describe, expect, it } from "vitest";
import { DaemonSocketClient } from "../daemon-socket-client";
import { createEventMapperState, mapAgentConnectionEvent } from "../event-mapper";
import { type FakeDaemonEnvelope, okResponse, startFakeDaemon } from "./helpers/fake-daemon";
import { readRustFixture } from "./helpers/rust-fixtures";

const [rustHello] = readRustFixture("daemon-hello.jsonl");

describe("DaemonSocketClient", () => {
	const cleanups: Array<() => Promise<void> | void> = [];
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	it("reads the hello and correlates responses by envelope id", async () => {
		const daemon = await startFakeDaemon({
			hello: rustHello,
			reply: (envelope) =>
				envelope.command.type === "ack_result" ? undefined : okResponse(envelope, { sessions: [] }),
		});
		cleanups.push(daemon.close);
		const client = new DaemonSocketClient(daemon.socketPath);
		cleanups.push(() => client.close());
		await client.connect(1000);
		const hello = await client.waitForHello(1000);
		expect(hello.runtime?.buildId).toBe("pa-daemon-rs-0.10.1");
		const response = await client.request<{ sessions: unknown[] }>({ type: "list", all: true });
		expect(response).toMatchObject({ success: true, command: "list", data: { sessions: [] } });
		const [envelope] = daemon.received;
		expect(envelope).toMatchObject({
			type: "command",
			protocol: { name: "prime-agent.daemon", version: 7 },
			clientId: client.clientId,
			command: { type: "list", all: true, id: envelope?.id },
		});
	});

	it("acknowledges mutating commands only", async () => {
		const daemon = await startFakeDaemon({
			hello: rustHello,
			reply: (envelope) => (envelope.command.type === "ack_result" ? undefined : okResponse(envelope)),
		});
		cleanups.push(daemon.close);
		const client = new DaemonSocketClient(daemon.socketPath);
		cleanups.push(() => client.close());
		await client.connect(1000);
		await client.waitForHello(1000);
		await client.request({ type: "get_state", activeSessionId: "a" });
		const kill = await client.request({ type: "kill", activeSessionId: "a" });
		await vi.waitFor(() => expect(daemon.received.map((envelope) => envelope.command.type)).toContain("ack_result"));
		const types = daemon.received.map((envelope: FakeDaemonEnvelope) => envelope.command.type);
		expect(types).toEqual(["get_state", "kill", "ack_result"]);
		expect(daemon.received[2]?.command.commandId).toBe(kill.id);
	});

	it("passes unsolicited frames to listeners and rejects pending requests on close", async () => {
		const binding = readRustFixture("session-binding.jsonl").find((frame) => frame.type === "session_binding");
		const daemon = await startFakeDaemon({ hello: rustHello, reply: () => binding });
		cleanups.push(daemon.close);
		const client = new DaemonSocketClient(daemon.socketPath);
		await client.connect(1000);
		await client.waitForHello(1000);
		const seen: string[] = [];
		client.onFrame((frame) => seen.push(frame.type));
		const pending = client.request({ type: "get_state", activeSessionId: "a" }, 5000);
		await vi.waitFor(() => expect(seen).toContain("session_binding"));
		client.close();
		await expect(pending).rejects.toThrow(/closed/);
		await expect(client.request({ type: "list" })).rejects.toThrow(/not connected/);
	});

	describe("heartbeats_changed after a kill (real v0.10.1 capture)", () => {
		const killed = readRustFixture("session-closed-killed.jsonl");
		const heartbeats = killed.find((frame) => frame.type === "heartbeats_changed");
		const closed = killed.find((frame) => frame.type === "session_closed");
		const startKillDaemon = () =>
			startFakeDaemon({
				hello: rustHello,
				// Same order as the capture: session_closed, heartbeats_changed, data-less kill response.
				reply: (envelope) =>
					envelope.command.type === "kill"
						? [closed!, heartbeats!, { type: "response", id: envelope.id, command: "kill", success: true }]
						: undefined,
			});

		it("reaches Fleet socket client onFrame subscribers unchanged; the chat mapper emits nothing", async () => {
			expect(heartbeats).toEqual({ type: "heartbeats_changed" });
			const daemon = await startKillDaemon();
			cleanups.push(daemon.close);
			const client = new DaemonSocketClient(daemon.socketPath);
			cleanups.push(() => client.close());
			await client.connect(1000);
			await client.waitForHello(1000);
			const frames: unknown[] = [];
			client.onFrame((frame) => frames.push(frame));
			const response = await client.request({ type: "kill", activeSessionId: "a" });
			expect(response).toMatchObject({ success: true, command: "kill" });
			expect("data" in response && response.data !== undefined).toBe(false);
			await vi.waitFor(() => expect(frames).toContainEqual(heartbeats));
			expect(frames.map((frame) => (frame as { type: string }).type)).toEqual([
				"session_closed",
				"heartbeats_changed",
			]);
			const state = createEventMapperState({ sessionId: "fleet" });
			expect(mapAgentConnectionEvent(state, structuredClone(heartbeats) as never)).toEqual([]);
			expect(mapAgentConnectionEvent(state, structuredClone(response) as never)).toEqual([]);
		});

		it("reaches the SDK DaemonClient onMessage hook (daemon-runtime's onFrame source) unchanged", async () => {
			const daemon = await startKillDaemon();
			cleanups.push(daemon.close);
			const client = new DaemonClient(daemon.socketPath);
			cleanups.push(() => client.close());
			await client.connect(1000);
			await client.waitForHello(1000);
			const frames: unknown[] = [];
			client.onMessage((frame: unknown) => frames.push(frame));
			await client.request({ type: "kill", activeSessionId: "a" } as never);
			await vi.waitFor(() => expect(frames).toContainEqual(heartbeats));
		});
	});

	it("times out a request the daemon never answers", async () => {
		const daemon = await startFakeDaemon({ hello: rustHello });
		cleanups.push(daemon.close);
		const client = new DaemonSocketClient(daemon.socketPath);
		cleanups.push(() => client.close());
		await client.connect(1000);
		await expect(client.request({ type: "list" }, 50)).rejects.toThrow(/did not answer "list"/);
	});
});
