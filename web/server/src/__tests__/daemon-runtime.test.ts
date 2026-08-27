import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sessionDirectoryForCwd } from "../daemon-runtime";
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
