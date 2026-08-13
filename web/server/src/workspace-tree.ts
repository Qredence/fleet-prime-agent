import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WorkspaceTreeNode } from "@prime-agent/web-protocol/chat-protocol";
import { canonicalizePath, getCwdRelativePath } from "./workspace-paths";

// Directory names never worth surfacing in the workspace tree.
const IGNORED = new Set([
	".git",
	".next",
	".tanstack",
	".turbo",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"test-results",
]);

const MAX_DEPTH = 3;
const MAX_ENTRIES_PER_DIR = 100;

/**
 * Whether an entry is a directory, following symlinks the same way the
 * project-folder picker does (see workspace-browse.ts). A symlink whose target
 * cannot be stat-ed is treated as a file.
 */
async function isDirectoryEntry(
	absoluteDir: string,
	entry: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean },
): Promise<boolean> {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	try {
		const target = await stat(resolve(absoluteDir, entry.name));
		return target.isDirectory();
	} catch {
		return false;
	}
}

async function readDirNodes(
	absoluteDir: string,
	relativeDir: string,
	depth: number,
	diagnostics: Array<string>,
	canonicalRoot: string,
): Promise<Array<WorkspaceTreeNode>> {
	let entries: Array<Dirent>;
	try {
		entries = await readdir(absoluteDir, { withFileTypes: true });
	} catch (error) {
		diagnostics.push(
			`Could not read ${relativeDir || "."}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return [];
	}

	const visible = entries.filter((entry) => !entry.name.startsWith(".") && !IGNORED.has(entry.name));

	const withIsDir = await Promise.all(
		visible.map(async (entry) => ({
			entry,
			isDirectory: await isDirectoryEntry(absoluteDir, entry),
		})),
	);

	withIsDir.sort((a, b) => {
		// Directories first, then files; alphabetical within each group.
		const dirDelta = Number(b.isDirectory) - Number(a.isDirectory);
		return dirDelta !== 0 ? dirDelta : a.entry.name.localeCompare(b.entry.name);
	});

	const capped = withIsDir.slice(0, MAX_ENTRIES_PER_DIR);
	if (withIsDir.length > capped.length) {
		diagnostics.push(`Showing first ${MAX_ENTRIES_PER_DIR} of ${withIsDir.length} entries in ${relativeDir || "."}`);
	}

	return Promise.all(
		capped.map(async ({ entry, isDirectory }): Promise<WorkspaceTreeNode> => {
			const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
			if (isDirectory) {
				const node: WorkspaceTreeNode = {
					name: entry.name,
					path: relativePath,
					type: "directory",
				};
				if (depth < MAX_DEPTH) {
					const childAbs = join(absoluteDir, entry.name);
					const canonicalChild = canonicalizePath(childAbs);
					if (getCwdRelativePath(canonicalChild, canonicalRoot) !== undefined) {
						node.children = await readDirNodes(childAbs, relativePath, depth + 1, diagnostics, canonicalRoot);
					}
				}
				return node;
			}
			return { name: entry.name, path: relativePath, type: "file" };
		}),
	);
}

/**
 * Read the workspace tree rooted at `root` — shallow, read-only, no file
 * watching. Returns relative nodes plus any diagnostics raised while reading.
 */
export async function readWorkspaceTree(root: string): Promise<{ nodes: WorkspaceTreeNode[]; diagnostics: string[] }> {
	const diagnostics: Array<string> = [];
	const nodes = await readDirNodes(root, "", 1, diagnostics, canonicalizePath(root));
	return { nodes, diagnostics };
}
