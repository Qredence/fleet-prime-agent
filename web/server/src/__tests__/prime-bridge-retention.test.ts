import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrimeBridge, type BridgeSession } from "../prime-bridge";
import { createDeterministicTestAgentConnection } from "./helpers/deterministic-test-connection";
import type { WebAgentConnectionFactory } from "../daemon-runtime";
import { writeManagedPrimePresentation } from "../prime-agent-presentation";
import { handleChatEventsGet } from "../handlers/chat-events";
import { setBridgeForTests, resetBridgeForTests } from "../singleton";
import { retainSessionInScope, withSessionLeaseScope } from "../session-lease-scope";

const config = vi.hoisted(() => ({ cwd: "" }));
vi.mock("../prime-config", () => ({
	getPrimeConfig: () => ({
		defaultCwd: config.cwd,
		agentDir: config.cwd,
		projectRegistry: {
			get: async () => ({ projectId: "project-1" }),
			projectIdForCwd: async () => "project-1",
			projectIdForSession: async () => "project-1",
			activeProjectIdForSession: async () => "project-1",
			assignSession: async () => {},
		},
	}),
}));
vi.mock("../daemon-runtime", async (original) => ({
	...(await original<typeof import("../daemon-runtime")>()),
	sessionDirectoryForCwd: () => join(config.cwd, "sessions"),
}));
let bridge: PrimeBridge;
let counter: number;
let factory: WebAgentConnectionFactory;
const agents = new Map<string, ReturnType<typeof createDeterministicTestAgentConnection>>();
const writer = vi.fn(writeManagedPrimePresentation);
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(async () => {
	config.cwd = await mkdtemp(join(tmpdir(), "fleet-retention-"));
	counter = 0;
	agents.clear();
	writer.mockReset().mockImplementation(async () => {});
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(0);
	factory = async (options) => {
		const id = options.sessionPath ? basename(options.sessionPath, ".jsonl") : `session-${++counter}`;
		const agent = {
			...createDeterministicTestAgentConnection(options, {
				sessionId: id,
				state: { sessionFile: join(config.cwd, "sessions", `${id}.jsonl`) },
				messages: [{ role: "user", content: "Saved message", timestamp: 0 }],
			}),
			terminate: vi.fn(async () => {}),
		};
		vi.spyOn(agent.connection, "dispose");
		vi.spyOn(agent.connection, "abort");
		agents.set(id, agent);
		return agent;
	};
	bridge = new PrimeBridge({
		connectionFactory: factory,
		writePresentation: writer,
		maxRetainedSessions: 2,
		idleSessionTtlMs: 1000,
		sessionLister: async () =>
			[...agents.keys()].map((id) => ({
				id,
				sessionId: id,
				cwd: config.cwd,
				sessionFile: join(config.cwd, "sessions", `${id}.jsonl`),
			})),
	});
});
afterEach(async () => {
	bridge.resetForTests();
	resetBridgeForTests();
	vi.useRealTimers();
	await settled();
	await rm(config.cwd, { recursive: true, force: true });
});
async function create() {
	const session = await bridge.createSession({ cwd: config.cwd });
	await settled();
	return session;
}

async function saveTranscript(session: BridgeSession): Promise<string> {
	await mkdir(join(config.cwd, "sessions"), { recursive: true });
	const transcript =
		JSON.stringify({
			type: "session",
			version: 3,
			id: session.sessionId,
			timestamp: new Date(0).toISOString(),
			cwd: config.cwd,
		}) + "\n";
	await writeFile(session.sessionPath, transcript);
	return transcript;
}

describe("idle connection retention", () => {
	it("waits for detachment to finish before opening another connection", async () => {
		const session = await create();
		await saveTranscript(session);
		const disposal = deferred<void>();
		vi.mocked(session.connection.dispose).mockReturnValueOnce(disposal.promise);
		vi.setSystemTime(2000);
		const sweep = bridge.evictIdleSessions();
		await settled();
		expect(bridge.getSession(session.sessionId)).toBeUndefined();
		const resumed = bridge.resumeSessionById(session.sessionId);
		await settled();
		expect(agents.get(session.sessionId)?.connection).toBe(session.connection);
		disposal.resolve();
		await sweep;
		expect((await resumed)?.connection).not.toBe(session.connection);
		await settled();
	});

	it("does not let a denied scoped resume poison a concurrent valid resume", async () => {
		const session = await create();
		await saveTranscript(session);
		vi.setSystemTime(2000);
		await bridge.evictIdleSessions();
		const [denied, allowed] = await Promise.all([
			bridge.resumeSessionById(session.sessionId, "other-project"),
			bridge.resumeSessionById(session.sessionId, "project-1"),
		]);
		expect(denied).toBeUndefined();
		expect(allowed?.sessionId).toBe(session.sessionId);
		await settled();
	});

	it("evicts the least recently used idle attachment under pressure, without aborting it", async () => {
		const a = await create();
		vi.setSystemTime(1);
		const b = await create();
		vi.setSystemTime(2);
		bridge.getSessionName(a.sessionId);
		vi.setSystemTime(3);
		const c = await create();
		await bridge.evictIdleSessions();
		expect(bridge.getSession(b.sessionId)).toBeUndefined();
		expect(bridge.getSession(a.sessionId)).toBe(a);
		expect(bridge.getSession(c.sessionId)).toBe(c);
		expect(b.connection.dispose).toHaveBeenCalledOnce();
		expect(b.connection.abort).not.toHaveBeenCalled();
		expect(b.terminate).not.toHaveBeenCalled();
	});

	it("sends a single resync at the high-water cursor when an oversized frame cannot be retained", async () => {
		bridge.resetForTests();
		bridge = new PrimeBridge({ connectionFactory: factory, writePresentation: writer, ringBufferMaxBytes: 256 });
		const session = await create();
		session.uiContext.notify("x".repeat(1000));
		setBridgeForTests(bridge);
		const response = await handleChatEventsGet(
			new Request(`http://localhost/api/chat/events?sessionId=${session.sessionId}`),
		);
		const reader = response.body!.getReader();
		let bootstrap = "";
		while (!bootstrap.includes("resync-required")) bootstrap += new TextDecoder().decode((await reader.read()).value);
		expect(bootstrap).toContain("id: 1");
		session.uiContext.notify("short");
		const next = new TextDecoder().decode((await reader.read()).value);
		expect(next).toContain("id: 2");
		expect(next).toContain("short");
		expect(next).not.toContain("resync-required");
		await reader.cancel();
	});

	it("expires idle sessions below the capacity target", async () => {
		const session = await create();
		vi.setSystemTime(1001);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBeUndefined();
	});

	it("keeps request and subscriber leases until released, including idempotent cleanup", async () => {
		const session = await create();
		const release = bridge.addEventListener(() => {}, session.sessionId);
		vi.setSystemTime(2000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBe(session);
		release();
		release();
		await withSessionLeaseScope(async () => {
			retainSessionInScope(session.sessionId, () => bridge.retainSession(session.sessionId));
			vi.setSystemTime(4000);
			await bridge.evictIdleSessions();
			expect(bridge.getSession(session.sessionId)).toBe(session);
		});
		vi.setSystemTime(6000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBeUndefined();
	});

	it.each(["isStreaming", "isCompacting", "isBashRunning", "retryAttempt", "queuedCount", "goal"])(
		"preserves daemon work reported by %s",
		async (field) => {
			const session = await create();
			const state = await session.connection.getState();
			if (field === "retryAttempt") state.retryAttempt = 1;
			else if (field === "queuedCount") state.sessionActions.queuedCount = 1;
			else if (field === "goal") state.goal.status = "active";
			else state[field as "isStreaming" | "isCompacting" | "isBashRunning"] = true;
			vi.setSystemTime(2000);
			await bridge.evictIdleSessions();
			expect(bridge.getSession(session.sessionId)).toBe(session);
			expect(session.connection.dispose).not.toHaveBeenCalled();
		},
	);

	it("fails closed on a disconnected state probe and rechecks leases after async inspection", async () => {
		const session = await create();
		const state = await session.connection.getState();
		vi.spyOn(session.connection, "getState").mockRejectedValueOnce(new Error("offline"));
		vi.setSystemTime(2000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBe(session);
		const probe = deferred<typeof state>();
		vi.mocked(session.connection.getState).mockReturnValueOnce(probe.promise);
		const sweep = bridge.evictIdleSessions();
		const release = bridge.retainSession(session.sessionId);
		probe.resolve(state);
		await sweep;
		expect(bridge.getSession(session.sessionId)).toBe(session);
		release();
	});

	it("does not evict pending or failed presentation writes", async () => {
		const pending = deferred<void>();
		writer.mockImplementationOnce(() => pending.promise);
		const session = await bridge.createSession({ cwd: config.cwd });
		vi.setSystemTime(2000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBe(session);
		pending.resolve();
		await settled();
		writer.mockRejectedValueOnce(new Error("disk full"));
		await bridge.upsertPresentationArtifact(session.sessionId, {
			id: "a1",
			runId: "r1",
			kind: "bash",
			title: "Output",
			status: "success",
			timestamp: 1,
		});
		vi.setSystemTime(4000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBe(session);
	});

	it("retains a prompt even before its first runtime frame or RPC", async () => {
		const session = await create();
		const pending = deferred<void>();
		vi.spyOn(session.connection, "promptAndWait").mockReturnValueOnce(pending.promise);
		const turn = bridge.prompt(session.sessionId, "Work");
		await settled();
		vi.setSystemTime(2000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBe(session);
		pending.resolve();
		await turn;
		vi.setSystemTime(4000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBeUndefined();
	});

	it("keeps pending dialogs and running children even when cached streaming flags are false", async () => {
		const session = await create();
		const question = session.uiContext.confirm("Continue?", "Question");
		vi.setSystemTime(2000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBe(session);
		const dialog = bridge.pendingDialogsFor(session.sessionId)[0]!;
		bridge.answerDialog(session.sessionId, dialog.toolCallId, { kind: "skip" });
		await expect(question).rejects.toThrow("Question cancelled");
		session.mapperState.presentation.rlmChildren.push({
			id: "child",
			label: "Child",
			status: "running",
			timestamp: 0,
		});
		vi.setSystemTime(4000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBe(session);
	});

	it("rehydrates saved messages and sidecars after eviction, resets cursors, and coalesces concurrent resumes", async () => {
		writer.mockImplementation(writeManagedPrimePresentation);
		const session = await create();
		const transcript = await saveTranscript(session);
		const presentation = await bridge.upsertPresentationArtifact(session.sessionId, {
			id: "a1",
			runId: "r1",
			kind: "bash",
			title: "Saved output",
			status: "success",
			timestamp: 1,
		});
		const oldStream = bridge.openSessionStream(session.sessionId);
		vi.setSystemTime(2000);
		await bridge.evictIdleSessions();
		expect(bridge.getSession(session.sessionId)).toBeUndefined();
		expect(await readFile(session.sessionPath, "utf8")).toBe(transcript);
		const [a, b] = await Promise.all([
			bridge.resumeSessionById(session.sessionId),
			bridge.resumeSessionById(session.sessionId),
		]);
		expect(a).toBe(b);
		expect(a).not.toBe(session);
		expect((await bridge.getMessages(session.sessionId))[0]?.parts).toContainEqual({
			type: "text",
			text: "Saved message",
		});
		expect(bridge.getPresentation(session.sessionId).artifactRuns).toEqual(presentation.artifactRuns);
		const stream = bridge.openSessionStream(session.sessionId, {
			streamGeneration: oldStream.streamGeneration,
			lastEventId: 1,
		});
		expect(stream.streamGeneration).not.toBe(oldStream.streamGeneration);
		expect(stream.cursorReset).toBe(true);
		expect(stream.resumeAccepted).toBe(false);
		await settled();
	});
});
