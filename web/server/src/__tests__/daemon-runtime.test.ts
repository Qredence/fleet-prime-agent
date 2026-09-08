import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentConnection } from "prime-agent";
import { afterEach, describe, expect, it } from "vitest";
import { sessionDirectoryForCwd, startDaemonChildPrompt } from "../daemon-runtime";
import { resetPrimeConfigForTests } from "../prime-config";

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
