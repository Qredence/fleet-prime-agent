import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { WorkspaceFileResponse } from "@prime-agent/web-protocol/chat-protocol";
import { resolveContainedWorkspacePath } from "./workspace-paths";

export const WORKSPACE_FILE_MAX_BYTES = 1024 * 1024;

export type WorkspaceFileReadResult =
	| { kind: "ok"; body: WorkspaceFileResponse }
	| { kind: "error"; status: number; message: string };

function mediaTypeForPath(filePath: string): WorkspaceFileResponse["mediaType"] {
	const ext = extname(filePath).toLowerCase();
	if (ext === ".md" || ext === ".markdown") return "text/markdown";
	return "text/plain";
}

function isBinaryBuffer(buffer: Buffer): boolean {
	const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
	return sample.includes(0);
}

export async function readWorkspaceFile(root: string, requestedPath: string): Promise<WorkspaceFileReadResult> {
	const trimmed = requestedPath.trim();
	if (!trimmed) {
		return {
			kind: "error",
			status: 400,
			message: "GET /api/workspace/file requires ?path=",
		};
	}

	const resolved = resolveContainedWorkspacePath(root, trimmed);
	if (!resolved) {
		return {
			kind: "error",
			status: 403,
			message: "Path is outside the workspace root",
		};
	}

	const { absolute, relative } = resolved;
	const name = basename(absolute);

	// Stat and read share a single handle so the size check and the content match.
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(absolute, "r");
	} catch {
		return {
			kind: "error",
			status: 404,
			message: `File not found: ${relative}`,
		};
	}

	let size: number;
	let buffer: Buffer;
	try {
		const fileStat = await handle.stat();
		if (!fileStat.isFile()) {
			return {
				kind: "error",
				status: 400,
				message: `Not a file: ${relative}`,
			};
		}

		size = fileStat.size;
		if (size > WORKSPACE_FILE_MAX_BYTES) {
			return {
				kind: "ok",
				body: {
					path: relative,
					name,
					content: "",
					mediaType: "application/octet-stream",
					size,
					status: "too-large",
				},
			};
		}
		buffer = await handle.readFile();
	} finally {
		await handle.close();
	}

	if (isBinaryBuffer(buffer)) {
		return {
			kind: "ok",
			body: {
				path: relative,
				name,
				content: "",
				mediaType: "application/octet-stream",
				size,
				status: "unsupported",
			},
		};
	}

	return {
		kind: "ok",
		body: {
			path: relative,
			name,
			content: buffer.toString("utf8"),
			mediaType: mediaTypeForPath(absolute),
			size,
			status: "ok",
		},
	};
}
