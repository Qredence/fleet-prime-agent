/**
 * Resolve the workspace directory the web UI should treat as "repo root".
 *
 * When the Vite app is started from `web/app`, `process.cwd()` is the package
 * folder — not useful as the file-tree / session default. Prefer an explicit
 * env override, otherwise walk up to the nearest `.git` (dir or worktree file).
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PRIME_AGENT_WORKSPACE_ROOT_ENV = "PRIME_AGENT_WORKSPACE_ROOT";

export function resolveDefaultWorkspaceRoot(
	startDir: string,
	env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
	const override = env[PRIME_AGENT_WORKSPACE_ROOT_ENV]?.trim();
	if (override) {
		return resolve(override);
	}

	const resolvedStart = resolve(startDir);
	let dir = resolvedStart;
	while (true) {
		if (existsSync(join(dir, ".git"))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return resolvedStart;
		}
		dir = parent;
	}
}
