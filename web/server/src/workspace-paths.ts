/**
 * Path containment for workspace reads — mirrors coding-agent
 * `canonicalizePath` / `getCwdRelativePath` (not exported from the package
 * public surface, so kept local and aligned with that algorithm).
 */
import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve as resolvePath, sep } from "node:path";

export function canonicalizePath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

export function getCwdRelativePath(filePath: string, cwd: string): string | undefined {
	const resolvedCwd = resolvePath(cwd);
	const resolvedPath = isAbsolute(filePath) ? resolvePath(filePath) : resolvePath(resolvedCwd, filePath);
	const relativePath = relative(resolvedCwd, resolvedPath);
	const isInsideCwd =
		relativePath === "" ||
		(relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));

	return isInsideCwd ? relativePath || "." : undefined;
}

/**
 * Resolve a client-supplied relative path under `root`. Returns undefined when
 * the path escapes the workspace (absolute escape, `..`, or symlink out).
 */
export function resolveContainedWorkspacePath(
	root: string,
	requestedPath: string,
): { absolute: string; relative: string } | undefined {
	const trimmed = requestedPath.trim();
	if (!trimmed || trimmed === ".") return undefined;

	// Canonicalize the root first so macOS /var → /private/var (and similar)
	// symlink roots stay consistent for both existing and missing targets.
	const canonicalRoot = canonicalizePath(root);
	const contained = getCwdRelativePath(trimmed, canonicalRoot);
	if (contained === undefined || contained === ".") return undefined;

	const absolute = resolvePath(canonicalRoot, contained);
	let candidate = absolute;
	try {
		candidate = realpathSync(absolute);
	} catch {
		// Missing path — keep the resolved absolute under canonicalRoot.
	}

	const stillInside = getCwdRelativePath(candidate, canonicalRoot);
	if (stillInside === undefined || stillInside === ".") return undefined;

	return {
		absolute: candidate,
		relative: stillInside.split(sep).join("/"),
	};
}
