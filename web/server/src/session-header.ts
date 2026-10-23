import { open } from "node:fs/promises";

/** Session headers are one short JSON line; never read further than this. */
const MAX_HEADER_BYTES = 64 * 1024;

/**
 * Read a session file's header id without side effects.
 *
 * Unlike `SessionManager.openAsync` (v0.9.8 repairs damaged tails, migrates or
 * rewrites files, empties header-less files and creates directories), this
 * opens the file read-only, reads only the first line, and parses it. Any
 * missing, unreadable, or malformed file yields `undefined`; nothing is
 * written and no directory is created.
 *
 * TODO(R1b): switch to `readLegacySession()` from
 * web/server/src/legacy/prime-agent-sdk.ts once R1b is in this branch's base.
 */
export async function readSessionHeaderId(sessionFile: string): Promise<string | undefined> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(sessionFile, "r");
		const buffer = Buffer.alloc(MAX_HEADER_BYTES);
		let length = 0;
		let newline = -1;
		while (length < MAX_HEADER_BYTES) {
			const { bytesRead } = await handle.read(buffer, length, MAX_HEADER_BYTES - length, length);
			if (bytesRead === 0) break;
			newline = buffer.subarray(length, length + bytesRead).indexOf(0x0a);
			if (newline >= 0) {
				newline += length;
				length += bytesRead;
				break;
			}
			length += bytesRead;
		}
		const firstLine = buffer
			.subarray(0, newline >= 0 ? newline : length)
			.toString("utf8")
			.trim();
		if (!firstLine) return undefined;
		const header: unknown = JSON.parse(firstLine);
		if (typeof header !== "object" || header === null) return undefined;
		const { type, id } = header as { type?: unknown; id?: unknown };
		return type === "session" && typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}
