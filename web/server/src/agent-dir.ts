import { homedir } from "node:os";
import { join } from "node:path";

export const AGENT_DIR_ENV = "PRIME_AGENT_CODING_AGENT_DIR";
const DEFAULT_AGENT_DIR = ".prime/agent";

function expandHomePath(path: string, home: string): string {
	if (path === "~") return home;
	if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) {
		return join(home, path.slice(2));
	}
	return path;
}

/** Resolve Prime Agent's user config directory from the pinned runtime contract. */
export function resolveAgentDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	const override = env[AGENT_DIR_ENV];
	if (override) return expandHomePath(override, home);
	return join(home, DEFAULT_AGENT_DIR);
}
