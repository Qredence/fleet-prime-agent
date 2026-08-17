import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { formatCommandHelp, getCommandSpec } from "../src/cli/command-registry.js";
import { parseWebCommandOptions, waitForWebProcess } from "../src/cli/web-command.js";

class FakeWebProcess extends EventEmitter {
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	killedSignals: NodeJS.Signals[] = [];

	kill(signal: NodeJS.Signals): boolean {
		this.killedSignals.push(signal);
		return true;
	}
}

function asChildProcess(process: FakeWebProcess): ChildProcess {
	return process as unknown as ChildProcess;
}

describe("web command", () => {
	afterEach(() => {
		process.exitCode = undefined;
	});

	it("registers a focused public command contract", () => {
		expect(getCommandSpec(["web"])).toMatchObject({
			usage: "web [--host <host>] [--port <port>] [--cwd <directory>]",
		});
		expect(formatCommandHelp(["web"])).toContain("--host <host>");
	});

	it("uses the documented defaults and environment workspace fallback", () => {
		expect(parseWebCommandOptions([], { PRIME_AGENT_WORKSPACE_ROOT: process.cwd() })).toEqual({
			host: "127.0.0.1",
			port: 3000,
			workspaceRoot: process.cwd(),
		});
	});

	it("parses loopback host, port, and explicit workspace overrides", () => {
		expect(
			parseWebCommandOptions(["--host", "localhost", "--port=3100", "--cwd", process.cwd()], {
				PRIME_AGENT_WORKSPACE_ROOT: "/does/not/exist",
			}),
		).toEqual({ host: "localhost", port: 3100, workspaceRoot: process.cwd() });
	});

	it.each(["0.0.0.0", "192.168.1.10", "example.com"])("rejects non-loopback host %s", (host) => {
		expect(() => parseWebCommandOptions(["--host", host], { PRIME_AGENT_WORKSPACE_ROOT: process.cwd() })).toThrow(
			"loopback hosts only",
		);
	});

	it.each(["--unknown", "--port", "--port=abc", "--port=65536", "--cwd"])(
		"rejects unsupported web option %s before launching",
		(option) => {
			expect(() => parseWebCommandOptions([option], { PRIME_AGENT_WORKSPACE_ROOT: process.cwd() })).toThrow();
		},
	);

	it("rejects a missing or non-directory workspace", () => {
		expect(() => parseWebCommandOptions(["--cwd", "/does/not/exist"])).toThrow("does not exist");
		expect(() => parseWebCommandOptions(["--cwd", fileURLToPath(import.meta.url)])).toThrow("not a directory");
	});

	it("forwards termination signals and propagates the child exit code", async () => {
		const child = new FakeWebProcess();
		const completion = waitForWebProcess(asChildProcess(child));

		process.emit("SIGTERM");
		expect(child.killedSignals).toEqual(["SIGTERM"]);

		child.exitCode = 143;
		child.emit("exit", 143, null);
		await completion;
		expect(process.exitCode).toBe(143);
	});

	it("propagates a non-zero launcher exit code", async () => {
		const child = new FakeWebProcess();
		const completion = waitForWebProcess(asChildProcess(child));

		child.exitCode = 17;
		child.emit("exit", 17, null);
		await completion;
		expect(process.exitCode).toBe(17);
	});
});
