import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentConnection } from "prime-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
	applySessionBinding,
	buildDaemonCreateCommand,
	createDaemonSession,
	daemonSpawnCommand,
	forkInDaemonWorker,
	listAllDaemonSavedSessions,
	listDaemonSavedSessionsPage,
	listDaemonSessions,
	NATIVE_DAEMON_BINARY_ENV,
	notifyDaemonModelCatalogChanged,
	onDaemonModelCatalogChanged,
	sessionDirectoryForCwd,
	startDaemonChildPrompt,
} from "../daemon-runtime";
import { resetPrimeConfigForTests } from "../prime-config";
import { type FakeDaemonEnvelope, okResponse, startFakeDaemon } from "./helpers/fake-daemon";
import { readRustFixture } from "./helpers/rust-fixtures";

const AGENT_DIR_ENV = "PRIME_AGENT_CODING_AGENT_DIR";
const SESSION_DIR_ENVS = ["PRIME_AGENT_SESSION_DIR", "PRIME_AGENT_CODING_AGENT_SESSION_DIR"];

function restoreEnvironment(name: string, value: string | undefined): void {
	if (value === undefined) delete process.env[name];
	else process.env[name] = value;
}

describe("daemon session-store resolution", () => {
	const originalEnvironment = new Map<string, string | undefined>();
	let temporaryAgentDirectory: string | undefined;

	afterEach(() => {
		for (const [name, value] of originalEnvironment) restoreEnvironment(name, value);
		originalEnvironment.clear();
		if (temporaryAgentDirectory) rmSync(temporaryAgentDirectory, { recursive: true, force: true });
		temporaryAgentDirectory = undefined;
		resetPrimeConfigForTests();
	});

	function rememberEnvironment(...names: string[]): void {
		for (const name of names) {
			if (!originalEnvironment.has(name)) originalEnvironment.set(name, process.env[name]);
		}
	}

	it("resolves a relative configured session directory from the session cwd", () => {
		const cwd = mkdtempSync(join(tmpdir(), "fleet-daemon-runtime-cwd-"));
		rememberEnvironment(...SESSION_DIR_ENVS);
		process.env.PRIME_AGENT_SESSION_DIR = ".fleet-sessions";

		try {
			expect(sessionDirectoryForCwd(cwd)).toBe(resolve(cwd, ".fleet-sessions"));
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("uses the shared Prime agent session store when no override is configured", () => {
		temporaryAgentDirectory = mkdtempSync(join(tmpdir(), "fleet-daemon-runtime-agent-"));
		rememberEnvironment(AGENT_DIR_ENV, ...SESSION_DIR_ENVS);
		process.env[AGENT_DIR_ENV] = temporaryAgentDirectory;
		for (const name of SESSION_DIR_ENVS) delete process.env[name];
		resetPrimeConfigForTests();

		expect(sessionDirectoryForCwd(join(homedir(), "fleet-runtime-project"))).toBe(
			join(temporaryAgentDirectory, "sessions"),
		);
	});
});

describe("startDaemonChildPrompt", () => {
	function fakeConnection() {
		const calls: Array<{ text: string; options: unknown }> = [];
		let releasePrompt!: () => void;
		const gate = new Promise<void>((resolve) => {
			releasePrompt = resolve;
		});
		const connection = {
			promptAndWait: vi.fn(async (text: string, options: unknown) => {
				calls.push({ text, options });
				await gate;
			}),
			abort: vi.fn(async () => undefined),
		} as unknown as AgentConnection;
		const dispose = vi.fn(async () => undefined);
		return { connection, dispose, calls, releasePrompt };
	}

	it("prompts with steer admission and disposes the borrowed connection", async () => {
		const fake = fakeConnection();
		const openConnection = vi.fn(async () => ({ connection: fake.connection, dispose: fake.dispose }));
		const handle = startDaemonChildPrompt(
			{ cwd: "/work", activeSessionId: "child-active", text: "go deeper" },
			openConnection,
		);
		await vi.waitFor(() => expect(openConnection).toHaveBeenCalledWith("/work", "child-active"));
		fake.releasePrompt();
		await handle.settled;
		expect(fake.calls).toEqual([
			{
				text: "go deeper",
				options: { streamingBehavior: "steer", queueIfBusy: true, signal: expect.any(AbortSignal) },
			},
		]);
		expect(fake.dispose).toHaveBeenCalledOnce();
	});

	it("propagates attach failures without disposing", async () => {
		const openConnection = vi.fn(async () => {
			throw new Error("no such session");
		});
		const handle = startDaemonChildPrompt(
			{ cwd: "/work", activeSessionId: "child-active", text: "hi" },
			openConnection,
		);
		await expect(handle.settled).rejects.toThrow("no such session");
	});

	it("aborts the in-flight turn", async () => {
		const fake = fakeConnection();
		const openConnection = vi.fn(async () => ({ connection: fake.connection, dispose: fake.dispose }));
		const handle = startDaemonChildPrompt(
			{ cwd: "/work", activeSessionId: "child-active", text: "go deeper" },
			openConnection,
		);
		await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
		await handle.abort();
		expect(fake.connection.abort).toHaveBeenCalledOnce();
		fake.releasePrompt();
		await handle.settled;
		expect(fake.dispose).toHaveBeenCalledOnce();
	});
});

const OPEN_UI_OFF = { enabled: false, mode: "off", prompt: "" } as const;

/** Point the session store at a temp dir so no test touches the user's agent dir. */
function useTemporaryStores(): { sessionDir: string; restore: () => void } {
	const agentDir = mkdtempSync(join(tmpdir(), "fleet-r1-agent-"));
	const sessionDir = join(agentDir, "sessions");
	const saved = new Map<string, string | undefined>();
	for (const name of [AGENT_DIR_ENV, ...SESSION_DIR_ENVS]) saved.set(name, process.env[name]);
	process.env[AGENT_DIR_ENV] = agentDir;
	process.env.PRIME_AGENT_SESSION_DIR = sessionDir;
	delete process.env.PRIME_AGENT_CODING_AGENT_SESSION_DIR;
	resetPrimeConfigForTests();
	return {
		sessionDir,
		restore: () => {
			for (const [name, value] of saved) restoreEnvironment(name, value);
			resetPrimeConfigForTests();
			rmSync(agentDir, { recursive: true, force: true });
		},
	};
}

const [rustHello] = readRustFixture("daemon-hello.jsonl");
const rustCreateResponse = readRustFixture("real-turn-python-repl.jsonl").find(
	(frame) => frame.type === "response" && frame.command === "create",
);

describe("daemon create command (R1: Rust v0.10.1 compatibility)", () => {
	it("sends telemetryDisabled at the top level and keeps the v0.9.8 config flag", () => {
		const command = buildDaemonCreateCommand({
			cwd: "/work",
			sessionDir: "/work/.sessions",
			thinkingLevel: "low",
			openUIPrompt: { enabled: true, mode: "on", prompt: "render openui" } as never,
		});
		expect(command).toEqual({
			type: "create",
			telemetryDisabled: true,
			config: {
				cwd: "/work",
				sessionDir: "/work/.sessions",
				telemetryDisabled: true,
				thinking: "low",
				appendSystemPrompt: ["render openui"],
			},
			lifecycle: "resident",
		});
		expect(command.config).not.toHaveProperty("agentDir");
		expect(command).not.toHaveProperty("continueRecent");
	});

	it("puts the top-level telemetry flag in the create envelope on the wire", async () => {
		const stores = useTemporaryStores();
		const daemon = await startFakeDaemon({
			hello: rustHello,
			reply: (envelope: FakeDaemonEnvelope) =>
				envelope.command.type === "create" ? okResponse(envelope, rustCreateResponse?.data) : undefined,
		});
		try {
			const created = await createDaemonSession(
				{ cwd: "/work", sessionPath: "/work/.sessions/s.jsonl", openUIPrompt: OPEN_UI_OFF as never },
				daemon.socketPath,
			);
			expect(created.activeSessionId).toBe("61506e70f987");
			const create = daemon.received.find((envelope) => envelope.command.type === "create");
			expect(create?.protocol).toEqual({ name: "prime-agent.daemon", version: 7 });
			expect(create?.command).toMatchObject({
				type: "create",
				telemetryDisabled: true,
				sessionPath: "/work/.sessions/s.jsonl",
				lifecycle: "resident",
				config: { cwd: "/work", sessionDir: stores.sessionDir, telemetryDisabled: true },
			});
			expect(create?.command.config).not.toHaveProperty("agentDir");
			expect(create?.command).not.toHaveProperty("continueRecent");
		} finally {
			await daemon.close();
			stores.restore();
		}
	});

	it("refuses a daemon announcing another schema revision", async () => {
		const stores = useTemporaryStores();
		const daemon = await startFakeDaemon({ hello: { ...rustHello, schemaRevision: 31 } });
		try {
			await expect(listDaemonSessions("/work", daemon.socketPath)).rejects.toThrow(/non-pinned daemon/);
		} finally {
			await daemon.close();
			stores.restore();
		}
	});
});

describe("daemon spawn", () => {
	it("spawns the opt-in native binary directly, never the npm launcher", () => {
		expect(
			daemonSpawnCommand("/tmp/prime-agent-501/daemon.sock", { [NATIVE_DAEMON_BINARY_ENV]: "/opt/pa/prime-agent" }),
		).toEqual({
			command: "/opt/pa/prime-agent",
			args: ["--mode", "daemon", "--daemon-socket", "/tmp/prime-agent-501/daemon.sock"],
		});
	});
});

describe("session_binding rebind", () => {
	it("re-targets the route from the captured Rust frames and ignores other sessions", () => {
		const frames = readRustFixture("session-binding.jsonl");
		let route = { activeSessionId: "61506e70f987" } as { activeSessionId: string; sessionPath?: string };
		for (const frame of frames) route = applySessionBinding(route, frame) ?? route;
		expect(route).toEqual({
			activeSessionId: "fb0bae7caf80",
			sessionPath: "/fixture/sessions/01a1683e-802b-7379-ba56-8dfea3a92117.jsonl",
		});
		const binding = frames.find((frame) => frame.type === "session_binding");
		expect(applySessionBinding({ activeSessionId: "someone-else" }, binding)).toBeUndefined();
		expect(applySessionBinding(route, { type: "session_event" })).toBeUndefined();
	});
});

describe("model_catalog_changed", () => {
	it("notifies listeners without throwing", () => {
		const stores = useTemporaryStores();
		try {
			const seen = vi.fn();
			const unsubscribe = onDaemonModelCatalogChanged(seen);
			notifyDaemonModelCatalogChanged();
			unsubscribe();
			notifyDaemonModelCatalogChanged();
			expect(seen).toHaveBeenCalledOnce();
		} finally {
			stores.restore();
		}
	});
});

describe("paged saved-session listing", () => {
	const row = (id: string) => ({
		path: `/s/${id}.jsonl`,
		id,
		cwd: "/work",
		created: "2026-10-23T10:00:00.000Z",
		modified: "2026-10-23T10:00:00.000Z",
		messageCount: 1,
		firstMessage: "hi",
	});

	it("walks Rust pages by cursor over the socket", async () => {
		const stores = useTemporaryStores();
		const daemon = await startFakeDaemon({
			hello: rustHello,
			reply: (envelope) => {
				if (envelope.command.type !== "list_saved_sessions") return undefined;
				return envelope.command.cursor === "c1"
					? okResponse(envelope, { sessions: [row("b")], remaining: 0 })
					: okResponse(envelope, { sessions: [row("a")], remaining: 1, nextCursor: "c1" });
			},
		});
		try {
			const rows = await listAllDaemonSavedSessions({ cwd: "/work", pageSize: 1 }, (options) =>
				listDaemonSavedSessionsPage(options, daemon.socketPath),
			);
			expect(rows.map((info) => info.id)).toEqual(["a", "b"]);
			const commands = daemon.received.filter((envelope) => envelope.command.type === "list_saved_sessions");
			expect(commands.map((envelope) => envelope.command)).toEqual([
				expect.objectContaining({ cwd: "/work", scope: "all", limit: 1, sessionDir: stores.sessionDir }),
				expect.objectContaining({ cursor: "c1", limit: 1 }),
			]);
			expect(commands[0]?.command).not.toHaveProperty("cursor");
		} finally {
			await daemon.close();
			stores.restore();
		}
	});

	it("treats a v0.9.8 reply without nextCursor as the only page", async () => {
		const listPage = vi.fn(async () => ({ sessions: [row("a"), { ...row("b"), allMessagesText: "hi" }] }));
		const rows = await listAllDaemonSavedSessions({ cwd: "/work" }, listPage);
		expect(rows).toHaveLength(2);
		expect(listPage).toHaveBeenCalledOnce();
	});

	it("stops on a repeated cursor", async () => {
		const listPage = vi.fn(async () => ({ sessions: [row("a")], nextCursor: "same" }));
		const rows = await listAllDaemonSavedSessions({ cwd: "/work", maxPages: 5 }, listPage);
		expect(listPage).toHaveBeenCalledTimes(2);
		expect(rows).toHaveLength(2);
	});
});

describe("forkInDaemonWorker", () => {
	function forkable(states: Array<Record<string, unknown>>, result: Record<string, unknown>) {
		const queue = [...states];
		return {
			waitForIdle: vi.fn(async () => undefined),
			getState: vi.fn(async () => queue.shift() ?? {}),
			fork: vi.fn(async () => result),
		};
	}

	it("runs the daemon fork and reports the source and the forked transcript", async () => {
		const connection = forkable(
			[
				{ sessionFile: "/s/source.jsonl", activeSessionId: "w1", thinkingLevel: "high" },
				{ sessionFile: "/s/fork.jsonl", activeSessionId: "w1" },
			],
			{ cancelled: false, selectedText: "hello" },
		);
		const result = await forkInDaemonWorker(connection as never, "entry-1", "before");
		expect(connection.waitForIdle).toHaveBeenCalledOnce();
		expect(connection.fork).toHaveBeenCalledWith("entry-1", { position: "before" });
		expect(result).toEqual({
			cancelled: false,
			selectedText: "hello",
			sourcePath: "/s/source.jsonl",
			forkedPath: "/s/fork.jsonl",
			workerActiveSessionId: "w1",
			sourceThinkingLevel: "high",
		});
	});

	it("surfaces a cancelled fork and refuses an unpersisted or unchanged session", async () => {
		const cancelled = forkable([{ sessionFile: "/s/source.jsonl" }], { cancelled: true });
		await expect(forkInDaemonWorker(cancelled as never, "e", "at")).resolves.toEqual({ cancelled: true });
		const unpersisted = forkable([{}], { cancelled: false });
		await expect(forkInDaemonWorker(unpersisted as never, "e", "at")).rejects.toThrow(/unpersisted/);
		expect(unpersisted.fork).not.toHaveBeenCalled();
		const unchanged = forkable([{ sessionFile: "/s/a.jsonl" }, { sessionFile: "/s/a.jsonl" }], { cancelled: false });
		await expect(forkInDaemonWorker(unchanged as never, "e", "at")).rejects.toThrow(
			/Failed to create forked session/,
		);
	});
});
