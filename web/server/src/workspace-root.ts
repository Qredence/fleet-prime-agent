/**
 * Resolve the workspace directory the web UI should treat as "repo root".
 *
 * When the Vite app is started from `web/app`, `process.cwd()` is the package
 * folder — not useful as the file-tree / session default. Prefer an explicit
 * env override, otherwise walk up to the nearest `.git` (dir or worktree file).
 */
import { existsSync, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const PRIME_AGENT_WORKSPACE_ROOT_ENV = "PRIME_AGENT_WORKSPACE_ROOT";

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

export type SetWorkspaceRootResult = { kind: "ok"; root: string } | { kind: "error"; status: number; message: string };

/** Validate and resolve a directory path that can become the agent root. */
export async function resolveWorkspaceRootPath(rawPath: string): Promise<SetWorkspaceRootResult> {
	const trimmed = rawPath.trim();
	if (!trimmed) {
		return { kind: "error", status: 400, message: "Path is required" };
	}

	const path = resolve(trimmed);

	let info: Stats;
	try {
		info = await stat(path);
	} catch (error) {
		return {
			kind: "error",
			status: 404,
			message: error instanceof Error ? error.message : `Path not found: ${path}`,
		};
	}

	if (!info.isDirectory()) {
		return {
			kind: "error",
			status: 400,
			message: `Not a directory: ${path}`,
		};
	}

	return { kind: "ok", root: path };
}
