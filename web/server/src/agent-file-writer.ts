/**
 * Writes Prime Agent's own JSON files (`settings.json`, `auth.json`,
 * `models.json`) without corrupting them.
 *
 * Two guarantees, and one honest limit:
 *
 * 1. **Atomic.** Content goes to a uniquely named temporary file in the same
 *    directory, then `rename`s over the target. A reader never observes a
 *    half-written file, and a crash mid-write leaves the original intact.
 * 2. **Serialized.** Writes take a lock file beside the target, so Fleet's own
 *    concurrent requests (two settings tabs, a retry racing a save) cannot
 *    interleave a read-merge-write and lose an update.
 * 3. **Limited.** The Prime Agent daemon coordinates its writes with
 *    in-process mutexes only, so it does not observe this lock. Fleet cannot
 *    corrupt the file, but a write the daemon performs at the same instant can
 *    still be lost. Callers surface that consequence rather than claiming
 *    cross-process safety the runtime does not offer.
 */
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type JsonObject = Record<string, unknown>;

/** A parsed file, or why it could not be parsed. */
export type ReadJsonResult =
	| { kind: "missing" }
	| { kind: "invalid"; error: string }
	| { kind: "ok"; value: JsonObject };

/**
 * Runtime files Fleet writes hold credentials or model routing, so they are
 * owner-only, matching what the runtime itself creates.
 */
export const RUNTIME_FILE_MODE = 0o600;

/** How long to wait for another Fleet writer before giving up. */
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 25;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
	return isJsonObject(error) && typeof error.code === "string" ? error.code : undefined;
}

/** Reads a JSON object without throwing on absence or corrupt content. */
export async function readJsonObjectFile(path: string): Promise<ReadJsonResult> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return { kind: "missing" };
		return { kind: "invalid", error: error instanceof Error ? error.message : "unreadable" };
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isJsonObject(parsed)) return { kind: "invalid", error: "expected a JSON object" };
		return { kind: "ok", value: parsed };
	} catch (error) {
		return { kind: "invalid", error: error instanceof Error ? error.message : "invalid JSON" };
	}
}

type LockHandle = { release: () => void };

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but belongs to another user.
		return errorCode(error) === "EPERM";
	}
}

/**
 * Takes the lock beside `path`, waiting for a live holder.
 *
 * A lock left behind by a dead process is reclaimed rather than blocking every
 * later write; the recorded pid is what makes that decision safe.
 */
async function acquireLock(lockPath: string): Promise<LockHandle> {
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	await mkdir(dirname(lockPath), { recursive: true });
	for (;;) {
		try {
			const descriptor = openSync(lockPath, "wx", 0o600);
			writeFileSync(descriptor, String(process.pid), "utf8");
			closeSync(descriptor);
			return {
				release: () => {
					rmSync(lockPath, { force: true });
				},
			};
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			// Read the holder's pid through a descriptor rather than by path. The
			// holder can release at any moment, so a path-based read after the
			// failed create is a check-then-act against a file that may already be
			// gone; opening first binds the read to whatever is actually there, and
			// ENOENT from that open is the ordinary "it just released" case.
			let raw: string;
			try {
				const reader = openSync(lockPath, "r");
				try {
					raw = readFileSync(reader, "utf8");
				} finally {
					closeSync(reader);
				}
			} catch (readError) {
				if (errorCode(readError) === "ENOENT") continue;
				throw readError;
			}
			const holder = Number.parseInt(raw, 10);
			if (!isProcessAlive(holder)) {
				rmSync(lockPath, { force: true });
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(
					`Timed out waiting for another Fleet write (held by process ${Number.isNaN(holder) ? "unknown" : holder}).`,
				);
			}
			await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
		}
	}
}

function currentMode(path: string): number | undefined {
	try {
		return statSync(path).mode & 0o777;
	} catch {
		return undefined;
	}
}

/**
 * Replaces a file's contents atomically, preserving existing permissions when
 * the file already exists and falling back to `mode` when it does not.
 */
export async function writeJsonObjectFile(
	path: string,
	value: JsonObject,
	options: { mode?: number } = {},
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	// A shared temporary name lets one writer rename the file out from under
	// another, which surfaces as ENOENT on the loser.
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const mode = currentMode(path) ?? options.mode ?? 0o644;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, "\t")}\n`, { encoding: "utf8", mode });
		// `writeFile` applies the process umask, so an existing 0600 file could
		// come back more permissive without an explicit chmod.
		await chmod(temporary, mode);
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

export type UpdateJsonFileResult<T> = { status: "written"; value: T } | { status: "refused"; reason: string };

/**
 * A path Fleet cannot write to, carrying the underlying filesystem reason.
 *
 * Distinct from a refusal caused by on-disk content: this one is about the
 * location itself, and its remedy is a directory or permission change.
 */
export class UnwritablePathError extends Error {
	constructor(
		readonly path: string,
		readonly cause: unknown,
	) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super(`${path}: ${detail}`);
		this.name = "UnwritablePathError";
	}
}

/**
 * Read-merge-write under the lock.
 *
 * `mutate` receives the current object (an empty object when the file is
 * absent) and returns the next one. Returning `{ refuse }` aborts with a
 * reason instead of writing, which is how unrecognized or newer on-disk shapes
 * stay untouched.
 */
export async function updateJsonObjectFile<T>(
	path: string,
	mutate: (current: JsonObject) => { next: JsonObject; result: T } | { refuse: string },
	options: { mode?: number } = {},
): Promise<UpdateJsonFileResult<T>> {
	const lock = await acquireLock(`${path}.lock`).catch((error: unknown) => {
		// An agent dir Fleet cannot write to (read-only mount, a path whose parent
		// is a file, a permissions problem) is a deployment condition with a
		// documented remedy, not an internal fault. Refusing with the reason lets
		// the caller surface guidance instead of a bare 500.
		throw new UnwritablePathError(path, error);
	});
	try {
		const current = await readJsonObjectFile(path);
		if (current.kind === "invalid") {
			return { status: "refused", reason: `${path} is not a readable JSON object: ${current.error}` };
		}
		const outcome = mutate(current.kind === "ok" ? current.value : {});
		if ("refuse" in outcome) return { status: "refused", reason: outcome.refuse };
		try {
			await writeJsonObjectFile(path, outcome.next, options);
		} catch (error) {
			throw new UnwritablePathError(path, error);
		}
		return { status: "written", value: outcome.result };
	} finally {
		lock.release();
	}
}
