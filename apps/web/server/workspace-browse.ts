import { readdir, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { WorkspaceBrowseEntry } from "@prime-agent/web-protocol/chat-protocol"

export type WorkspaceBrowseResult =
	| {
			kind: "ok"
			path: string
			parent: string | null
			entries: Array<WorkspaceBrowseEntry>
	  }
	| { kind: "error"; status: number; message: string }

async function isDirectoryEntry(
	absoluteParent: string,
	entry: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean },
): Promise<boolean> {
	if (entry.isDirectory()) return true
	if (!entry.isSymbolicLink()) return false
	try {
		const target = await stat(resolve(absoluteParent, entry.name))
		return target.isDirectory()
	} catch {
		return false
	}
}

/**
 * List immediate child directories of an absolute path for the project-folder
 * picker. Not constrained to the current workspace root — the picker must
 * leave the old root to choose a new one. Includes symlink-to-directory.
 */
export async function browseWorkspaceDirectories(
	rawPath: string,
): Promise<WorkspaceBrowseResult> {
	const path = resolve(rawPath.trim() || ".")

	let info
	try {
		info = await stat(path)
	} catch (error) {
		return {
			kind: "error",
			status: 404,
			message:
				error instanceof Error ? error.message : `Path not found: ${path}`,
		}
	}

	if (!info.isDirectory()) {
		return {
			kind: "error",
			status: 400,
			message: `Not a directory: ${path}`,
		}
	}

	let entries
	try {
		entries = await readdir(path, { withFileTypes: true })
	} catch (error) {
		return {
			kind: "error",
			status: 403,
			message:
				error instanceof Error
					? error.message
					: `Could not read directory: ${path}`,
		}
	}

	const directories: Array<WorkspaceBrowseEntry> = []
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue
		if (!(await isDirectoryEntry(path, entry))) continue
		directories.push({
			name: entry.name,
			path: resolve(path, entry.name),
		})
	}
	directories.sort((a, b) => a.name.localeCompare(b.name))

	const parent = dirname(path)
	return {
		kind: "ok",
		path,
		parent: parent !== path ? parent : null,
		entries: directories,
	}
}
