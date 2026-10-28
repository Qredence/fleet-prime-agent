import { afterEach, describe, expect, it } from "vitest";
import { DaemonCommandOutcomeUnknownError, DaemonSocketClient } from "../daemon-socket-client";
import { FleetDaemonAgentConnection } from "../fleet-daemon-connection";
import { type FakeDaemonEnvelope, okResponse, startFakeDaemon } from "./helpers/fake-daemon";
import { readRustFixture } from "./helpers/rust-fixtures";

const hello = readRustFixture("daemon-hello.jsonl")[0];
const attachData = readRustFixture("attach-mid-tool.jsonl").find(
	(frame) => frame.type === "response" && frame.command === "attach",
)?.data;
const streamedAttachFrames = readRustFixture("session-binding.jsonl");
const streamedAttachResponse = streamedAttachFrames.find(
	(frame) => frame.type === "response" && frame.command === "attach",
);
const streamedSnapshotFrames = streamedAttachFrames.filter((frame) => frame.type.startsWith("session_snapshot_"));

function snapshotFrames(snapshotId: string, purpose: string, snapshot: Record<string, unknown>, messages: unknown[]) {
	return [
		{
			type: "session_snapshot_begin",
			activeSessionId: snapshot.activeSessionId,
			snapshotId,
			purpose,
			messageCount: messages.length,
			snapshot,
		},
		{
			type: "session_snapshot_chunk",
			activeSessionId: snapshot.activeSessionId,
			snapshotId,
			index: 0,
			messages,
		},
		{
			type: "session_snapshot_end",
			activeSessionId: snapshot.activeSessionId,
			snapshotId,
			chunkCount: 1,
			lastEventSequence: 0,
			lastEventCursor: { generation: "fixture-generation", sequence: 0 },
		},
	];
}

describe("FleetDaemonAgentConnection", () => {
	let daemon: Awaited<ReturnType<typeof startFakeDaemon>> | undefined;
	let client: DaemonSocketClient | undefined;
	let connection: FleetDaemonAgentConnection | undefined;

	afterEach(async () => {
		await connection?.dispose();
		client?.close();
		await daemon?.close();
		connection = undefined;
		client = undefined;
		daemon = undefined;
	});

	it("attaches through Fleet's protocol client and adapts the initial snapshot", async () => {
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) => okResponse(envelope, envelope.command.type === "attach" ? attachData : {}),
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "b134578a8e2f");

		const snapshot = await connection.getInitialSnapshot();
		expect(snapshot.state.activeSessionId).toBe("b134578a8e2f");
		expect(snapshot.messages).toHaveLength(2);
		expect(daemon.received[0]?.command).toMatchObject({
			type: "attach",
			activeSessionId: "b134578a8e2f",
			supportsExtensionUi: false,
		});
	});

	it("describes a daemon-closed session instead of surfacing the raw reason token", async () => {
		const state = { activeSessionId: "active-1", cwd: "/work", thinkingLevel: "low" };
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope: FakeDaemonEnvelope, socket) => {
				if (envelope.command.type === "attach") {
					// Close the session right after attach so the frame is observed by the
					// connected adapter rather than buffered as pre-attach history.
					setTimeout(() => {
						socket.write(
							`${JSON.stringify({
								type: "session_closed",
								activeSessionId: "active-1",
								reason: "killed",
							})}\n`,
						);
					}, 0);
					return okResponse(envelope, {
						activeSessionId: "active-1",
						snapshot: { activeSessionId: "active-1", state, messages: [] },
					});
				}
				return okResponse(envelope, {});
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "active-1");

		const closed = await new Promise<{ error?: string }>((resolve) => {
			connection?.subscribe((event) => {
				if (event.type === "closed") resolve({ error: event.error });
			});
		});

		// `killed` is a protocol token; users need a sentence with a next step.
		expect(closed.error).toContain("The daemon stopped this agent session.");
		expect(closed.error).toContain("logs/agent.jsonl");
		expect(closed.error).not.toBe("killed");
	});

	it("maps session events and routes connection calls to the attached active id", async () => {
		const state = { activeSessionId: "active-1", cwd: "/work", thinkingLevel: "low" };
		const messages = [{ role: "user", content: "hello", timestamp: 1 }];
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope: FakeDaemonEnvelope, socket) => {
				if (envelope.command.type === "attach")
					return okResponse(envelope, {
						activeSessionId: "active-1",
						snapshot: { activeSessionId: "active-1", state, messages },
					});
				if (envelope.command.type === "get_connection_state") return okResponse(envelope, state);
				if (envelope.command.type === "abort") {
					socket.write(
						`${JSON.stringify({
							type: "session_event",
							activeSessionId: "active-1",
							event: { type: "agent_end" },
						})}\n`,
					);
					return okResponse(envelope, {});
				}
				return okResponse(envelope, {});
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "active-1");
		const events: unknown[] = [];
		connection.subscribe((event) => {
			events.push(event);
		});

		await connection.getState();
		await connection.abort();

		expect(daemon.received.map((request) => request.command)).toEqual([
			expect.objectContaining({ type: "attach", activeSessionId: "active-1" }),
			expect.objectContaining({ type: "get_connection_state", activeSessionId: "active-1" }),
			expect.objectContaining({ type: "abort", activeSessionId: "active-1" }),
		]);
		expect(events).toEqual([{ type: "session_event", event: { type: "agent_end" } }]);
	});

	it("reconnects and reattaches the same active session after the socket closes", async () => {
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) => {
				if (envelope.command.type === "attach" || envelope.command.type === "reattach") {
					return okResponse(envelope, attachData);
				}
				return okResponse(envelope, {});
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "b134578a8e2f");
		const events: unknown[] = [];
		connection.subscribe((event) => {
			events.push(event);
		});

		daemon.sockets[0]?.destroy();
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("daemon connection did not recover")), 2_000);
			const poll = () => {
				if (
					events.some(
						(event) =>
							typeof event === "object" &&
							event !== null &&
							"type" in event &&
							event.type === "connection_status" &&
							"status" in event &&
							event.status === "connected",
					)
				) {
					clearTimeout(timer);
					resolve();
					return;
				}
				setTimeout(poll, 10);
			};
			poll();
		});

		expect(daemon.received.some((request) => request.command.type === "reattach")).toBe(true);
		expect(events[0]).toMatchObject({ type: "connection_status", status: "reconnecting" });
		expect(events).toContainEqual(expect.objectContaining({ type: "session_resynced" }));
	});

	it("buffers events received during attach and skips events already covered by its snapshot", async () => {
		const duplicate = {
			type: "session_event",
			activeSessionId: "b134578a8e2f",
			event: { type: "agent_start" },
			meta: { sequence: 7 },
		};
		const next = {
			type: "session_event",
			activeSessionId: "b134578a8e2f",
			event: { type: "agent_end" },
			meta: { sequence: 8 },
		};
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) =>
				envelope.command.type === "attach"
					? [duplicate, next, okResponse(envelope, attachData)]
					: okResponse(envelope, {}),
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "b134578a8e2f");
		const events: unknown[] = [];
		connection.subscribe((event) => {
			events.push(event);
		});

		expect(events).toEqual([{ type: "session_event", event: { type: "agent_end" } }]);
	});

	it("watches a child session on the shared socket without closing the parent transport", async () => {
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) => {
				if (envelope.command.type === "attach") {
					const activeSessionId = String(envelope.command.activeSessionId);
					return okResponse(envelope, {
						activeSessionId,
						snapshot: {
							activeSessionId,
							state: { activeSessionId, cwd: "/work", thinkingLevel: "low" },
							messages: [],
						},
					});
				}
				if (envelope.command.type === "get_messages") return okResponse(envelope, { messages: [] });
				if (envelope.command.type === "get_commands") return okResponse(envelope, { commands: [] });
				return okResponse(envelope, {});
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "parent");
		const watcher = await connection.watchSession("child");
		expect(watcher).toBeDefined();
		await watcher?.getMessages();
		await watcher?.close();

		expect(client.isConnected).toBe(true);
		expect(daemon.received.map((request) => request.command)).toEqual([
			expect.objectContaining({ type: "attach", activeSessionId: "parent" }),
			expect.objectContaining({ type: "attach", activeSessionId: "child" }),
			expect.objectContaining({ type: "get_messages", activeSessionId: "child" }),
			expect.objectContaining({ type: "detach", activeSessionId: "child" }),
		]);
	});

	it("assembles the transcript from a chunked Rust attach snapshot", async () => {
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) =>
				envelope.command.type === "attach"
					? [okResponse(envelope, streamedAttachResponse?.data), ...streamedSnapshotFrames]
					: okResponse(envelope, {}),
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "fb0bae7caf80");

		const snapshot = await connection.getInitialSnapshot();
		expect(snapshot.messages).toHaveLength(10);
		expect(snapshot.lastEventSequence).toBe(0);
	});

	it("keeps the attach frame listener live through streamed snapshot completion and handoff", async () => {
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope, socket) => {
				if (envelope.command.type !== "attach") return okResponse(envelope, {});
				setTimeout(() => {
					for (const frame of streamedSnapshotFrames) socket.write(`${JSON.stringify(frame)}\n`);
					setTimeout(() => {
						socket.write(
							`${JSON.stringify({
								type: "session_event",
								activeSessionId: "fb0bae7caf80",
								event: { type: "agent_end" },
								meta: { sequence: 1 },
							})}\n`,
						);
					}, 0);
				}, 0);
				return okResponse(envelope, streamedAttachResponse?.data);
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "fb0bae7caf80");
		const events: unknown[] = [];
		connection.subscribe((event) => {
			events.push(event);
		});

		await vi.waitFor(() => expect(events).toContainEqual({ type: "session_event", event: { type: "agent_end" } }));
	});

	it("rejects incomplete or inconsistent streamed snapshots without returning partial messages", async () => {
		const activeSessionId = "snapshot-session";
		const invalidStreams = [
			[
				{
					type: "session_snapshot_begin",
					activeSessionId,
					snapshotId: "missing-chunk",
					messageCount: 1,
					snapshot: { activeSessionId, state: {} },
				},
				{ type: "session_snapshot_end", activeSessionId, snapshotId: "missing-chunk", chunkCount: 1 },
			],
			[
				{
					type: "session_snapshot_begin",
					activeSessionId,
					snapshotId: "duplicate-chunk",
					messageCount: 1,
					snapshot: { activeSessionId, state: {} },
				},
				{ type: "session_snapshot_chunk", activeSessionId, snapshotId: "duplicate-chunk", index: 0, messages: [] },
				{ type: "session_snapshot_chunk", activeSessionId, snapshotId: "duplicate-chunk", index: 0, messages: [] },
				{ type: "session_snapshot_end", activeSessionId, snapshotId: "duplicate-chunk", chunkCount: 1 },
			],
			[
				{
					type: "session_snapshot_begin",
					activeSessionId,
					snapshotId: "wrong-count",
					messageCount: 2,
					snapshot: { activeSessionId, state: {} },
				},
				{ type: "session_snapshot_chunk", activeSessionId, snapshotId: "wrong-count", index: 0, messages: [{}] },
				{ type: "session_snapshot_end", activeSessionId, snapshotId: "wrong-count", chunkCount: 1 },
			],
		];

		for (const frames of invalidStreams) {
			const begin = frames[0];
			daemon = await startFakeDaemon({
				hello,
				reply: (envelope) =>
					envelope.command.type === "attach"
						? [
								okResponse(envelope, {
									activeSessionId,
									snapshot: { activeSessionId, state: {}, messages: [] },
									snapshotStream: { id: begin?.snapshotId },
								}),
								...frames,
							]
						: okResponse(envelope, {}),
			});
			client = new DaemonSocketClient(daemon.socketPath);
			await client.connect();
			await client.waitForHello();
			await expect(FleetDaemonAgentConnection.attach(client, activeSessionId)).rejects.toThrow();
			client.close();
			await daemon.close();
			client = undefined;
			daemon = undefined;
		}
	});

	it("ignores a child watcher's snapshot frames so the parent session survives", async () => {
		const parentId = "parent-session";
		const childId = "child-session";
		const childState = { activeSessionId: childId, cwd: "/child", isStreaming: false };
		// A child watcher streams its own snapshots on the shared socket. Before
		// the fix these landed in the parent's buffer, the replacement apply threw
		// on the id mismatch, and the parent was closed as a result.
		const childReplacement = snapshotFrames(
			"child-replacement",
			"replacement",
			{ activeSessionId: childId, state: childState },
			[{ role: "user", content: "child transcript" }],
		);
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope, socket) => {
				if (envelope.command.type !== "attach") {
					return okResponse(envelope, envelope.command.type === "get_messages" ? { messages: [] } : {});
				}
				const activeSessionId = String(envelope.command.activeSessionId);
				if (activeSessionId === childId) {
					setTimeout(() => {
						for (const frame of childReplacement) socket.write(`${JSON.stringify(frame)}\n`);
					}, 0);
				}
				return okResponse(envelope, {
					activeSessionId,
					snapshot: { activeSessionId, state: { activeSessionId, cwd: "/work" }, messages: [] },
				});
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, parentId);
		const events: unknown[] = [];
		connection.subscribe((event) => {
			events.push(event);
		});

		const watcher = await connection.watchSession(childId);
		await vi.waitFor(() => expect(events.length).toBeGreaterThanOrEqual(0));
		// Give the child's replacement frames time to arrive.
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(events.filter((event) => (event as { type: string }).type === "closed")).toEqual([]);
		await expect(connection.getInitialSnapshot()).resolves.toMatchObject({
			state: { activeSessionId: parentId },
		});
		await watcher?.close();
	});

	it("consumes an attach-purpose snapshot without replacing or closing the session", async () => {
		const activeSessionId = "fb0bae7caf80";
		const attachSnapshot = snapshotFrames(
			"attach-only",
			"attach",
			{ activeSessionId, state: { activeSessionId, cwd: "/work" }, messages: [{ role: "user", content: "x" }] },
			[{ role: "user", content: "x" }],
		);
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope, socket) => {
				if (envelope.command.type !== "attach") return okResponse(envelope, {});
				// An attach-purpose snapshot ends after the attach response. Its frames
				// are consumed by the attach, so they must be released rather than
				// retained, and they must never be applied as a replacement.
				setTimeout(() => {
					for (const frame of attachSnapshot) socket.write(`${JSON.stringify(frame)}\n`);
				}, 0);
				return okResponse(envelope, {
					activeSessionId,
					snapshot: { activeSessionId, state: { activeSessionId, cwd: "/work" }, messages: [] },
				});
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, activeSessionId);
		const events: unknown[] = [];
		connection.subscribe((event) => {
			events.push(event);
		});

		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(events.filter((event) => (event as { type: string }).type === "session_replaced")).toEqual([]);
		expect(events.filter((event) => (event as { type: string }).type === "closed")).toEqual([]);
	});

	it("replaces its navigation snapshot only after a complete replacement stream", async () => {
		const activeSessionId = "b134578a8e2f";
		const replacementMessages = [{ role: "user", content: "navigated transcript" }];
		const replacementState = { activeSessionId, cwd: "/navigated", isStreaming: false };
		const replacementFrames = snapshotFrames(
			"navigation-replacement",
			"replacement",
			{
				activeSessionId,
				state: replacementState,
				summary: { streamingMessage: null },
			},
			replacementMessages,
		);
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) =>
				envelope.command.type === "navigate_tree"
					? [okResponse(envelope, { cancelled: false }), ...replacementFrames]
					: okResponse(envelope, envelope.command.type === "attach" ? attachData : {}),
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, activeSessionId);
		const events: unknown[] = [];
		connection.subscribe((event) => {
			events.push(event);
		});

		await expect(connection.navigateTree("entry-target")).resolves.toEqual({ cancelled: false });
		await vi.waitFor(() =>
			expect(events).toContainEqual({
				type: "session_replaced",
				state: replacementState,
				messages: replacementMessages,
			}),
		);
		await expect(connection.getInitialSnapshot()).resolves.toMatchObject({
			state: replacementState,
			messages: replacementMessages,
			lastEventCursor: { generation: "fixture-generation", sequence: 0 },
		});
	});

	it("reports a non-batched sequence gap and refreshes the snapshot before returning it", async () => {
		const state = { activeSessionId: "b134578a8e2f", cwd: "/fixture/project", isStreaming: false };
		const messages = [{ role: "user", content: "refreshed", timestamp: 2 }];
		const eventUpdate = {
			type: "session_event",
			activeSessionId: "b134578a8e2f",
			event: { type: "message_update", message: { role: "assistant" } },
			meta: { activeSessionId: "b134578a8e2f", sequence: 8, cursor: { generation: "e1d418183e22", sequence: 8 } },
		};
		const eventAfterGap = {
			type: "session_event",
			activeSessionId: "b134578a8e2f",
			event: { type: "tool_execution_start", toolName: "bash" },
			meta: { activeSessionId: "b134578a8e2f", sequence: 10, cursor: { generation: "e1d418183e22", sequence: 10 } },
		};
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) => {
				if (envelope.command.type === "attach") return okResponse(envelope, attachData);
				if (envelope.command.type === "get_connection_state")
					return [eventUpdate, eventAfterGap, okResponse(envelope, state)];
				if (envelope.command.type === "get_messages") return okResponse(envelope, { messages });
				if (envelope.command.type === "get_session_context")
					return okResponse(envelope, { context: { cwd: "/fixture/project" } });
				return okResponse(envelope, {});
			},
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "b134578a8e2f");
		const gaps: unknown[] = [];
		connection.onSequenceGap((gap) => gaps.push(gap));

		await connection.getState();
		await vi.waitFor(() => expect(gaps).toHaveLength(1));
		const snapshot = await connection.getInitialSnapshot();

		expect(gaps[0]).toMatchObject({ lastSequence: 8, receivedSequence: 10, missing: 1 });
		expect(snapshot.messages).toEqual(messages);
		expect(snapshot.state).toEqual(state);
		expect(daemon.received.map((request) => request.command.type)).toContain("get_session_context");
	});

	it("reports queue mutation as unsupported when the daemon lacks the capability", async () => {
		const olderHello = {
			...hello,
			serverCapabilities: Array.isArray(hello.serverCapabilities)
				? hello.serverCapabilities.filter((capability) => capability !== "queue_message_mutation")
				: [],
		};
		daemon = await startFakeDaemon({
			hello: olderHello,
			reply: (envelope) => okResponse(envelope, envelope.command.type === "attach" ? attachData : {}),
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "b134578a8e2f");

		await expect(connection.mutateQueuedMessage("steering", 0, "queued", { type: "delete" })).resolves.toBe(
			"unsupported",
		);
		expect(daemon.received.map((request) => request.command.type)).toEqual(["attach"]);
	});

	it("surfaces unknown queue mutation completion and never retries it", async () => {
		daemon = await startFakeDaemon({
			hello,
			reply: (envelope) => okResponse(envelope, envelope.command.type === "attach" ? attachData : {}),
		});
		client = new DaemonSocketClient(daemon.socketPath);
		await client.connect();
		await client.waitForHello();
		connection = await FleetDaemonAgentConnection.attach(client, "b134578a8e2f");
		vi.spyOn(client, "request").mockRejectedValue(
			new DaemonCommandOutcomeUnknownError("mutate_queued_message", "fleet_uncertain"),
		);

		await expect(connection.mutateQueuedMessage("steering", 0, "queued", { type: "delete" })).rejects.toMatchObject({
			name: "FleetQueueMutationOutcomeUnknownError",
			code: "DAEMON_COMMAND_OUTCOME_UNKNOWN",
			activeSessionId: "b134578a8e2f",
			requestId: "fleet_uncertain",
			message: expect.stringContaining("Refresh the queue before trying again"),
		});
		expect(client.request).toHaveBeenCalledTimes(1);
	});
});
