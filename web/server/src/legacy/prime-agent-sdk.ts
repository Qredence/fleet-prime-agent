/**
 * R1b legacy bridge: the one web/server module that may import the Prime Agent
 * v0.9.8 TypeScript SDK for on-disk configuration and transcript reads.
 *
 * TEMPORARY. It exists so the rest of web/server can drop the broad v0.9.8 SDK
 * surface ahead of the Rust v0.10.1 daemon cutover (docs/plans/prime-agent-v0.10.1.md,
 * "R1b"). The v0.10.1 daemon keeps the same `~/.prime/agent` on-disk format, so these
 * readers keep working across the cutover. Remove this module once the daemon serves
 * settings, auth, the model catalog and transcripts itself.
 *
 * What lives here:
 * - `SettingsManager`, `AuthStorage`, `ModelRegistry` and `DefaultResourceLoader`
 *   factories (the config surface behind `prime-config.ts`);
 * - `legacyAgentDir()`;
 * - a strictly read-only session reader (`readLegacySession`).
 *
 * The session reader never writes. `SessionManager.openAsync` is not read-only: it
 * repairs damaged JSONL tails in place, rewrites the file when it migrates the
 * schema, truncates empty or header-less files and creates the session directory.
 * Fleet must not do any of that to transcripts the daemon owns, so the reader only
 * reads the file and runs the SDK's own parser, migration and context builder in
 * memory.
 *
 * `scripts/check-web-boundaries.mjs` fails the build when these SDK symbols are
 * imported anywhere else in web/server/src.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
	ApiKeyCredential,
	FileEntry,
	SessionContext,
	SessionEntry,
	SessionHeader,
	SessionMessageEntry,
} from "prime-agent";
import {
	AuthStorage,
	buildSessionContext,
	DefaultResourceLoader,
	getAgentDir,
	ModelRegistry,
	migrateSessionEntries,
	parseSessionEntries,
	SettingsManager,
} from "prime-agent";

export type LegacyAuthStorage = AuthStorage;
export type LegacyModelRegistry = ModelRegistry;
export type LegacySettingsManager = SettingsManager;
export type LegacyResourceLoader = DefaultResourceLoader;
export type LegacyApiKeyCredential = ApiKeyCredential;
export type LegacySessionHeader = SessionHeader;
export type LegacySessionEntry = SessionEntry;
export type LegacySessionMessageEntry = SessionMessageEntry;
export type LegacySessionMessages = SessionContext["messages"];

/** The Prime Agent directory (`~/.prime/agent` unless overridden by the runtime's env). */
export function legacyAgentDir(): string {
	return getAgentDir();
}

/** `auth.json` store. Defaults to the agent directory's file; tests pass a temp path. */
export function createLegacyAuthStorage(authPath?: string): LegacyAuthStorage {
	return AuthStorage.create(authPath);
}

/** Model registry over `models.json`, resolving keys through `authStorage`. */
export function createLegacyModelRegistry(
	authStorage: LegacyAuthStorage,
	modelsJsonPath?: string,
): LegacyModelRegistry {
	return ModelRegistry.create(authStorage, modelsJsonPath);
}

/** Global plus project settings for `cwd`. */
export function createLegacySettingsManager(cwd: string): LegacySettingsManager {
	return SettingsManager.create(cwd);
}

/** Skills, prompts, extensions, themes and agents files for `cwd`, already loaded. */
export async function loadLegacyResources(options: {
	readonly cwd: string;
	readonly agentDir: string;
	readonly settingsManager: LegacySettingsManager;
}): Promise<LegacyResourceLoader> {
	const loader = new DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager: options.settingsManager,
	});
	await loader.reload();
	return loader;
}

/** An immutable, in-memory view of one session transcript. */
export interface LegacySessionSnapshot {
	/** Absolute path of the transcript that was read. */
	readonly sessionFile: string;
	readonly sessionId: string;
	/** The header's cwd (falls back to the server cwd, matching `SessionManager`). */
	readonly cwd: string;
	readonly header: LegacySessionHeader;
	/** Every entry after the header, in file order (all branches). */
	readonly entries: readonly LegacySessionEntry[];
	/** Messages on the branch ending at the latest entry, compactions applied. */
	messages(): LegacySessionMessages;
}

function isSessionHeader(entry: FileEntry | undefined): entry is SessionHeader {
	return entry?.type === "session" && typeof (entry as { id?: unknown }).id === "string";
}

/**
 * Reads one session transcript without touching the file.
 *
 * Returns `undefined` when the file is missing, unreadable, empty, or does not
 * start with a session header, which are the cases `SessionManager.openAsync` would "repair" by
 * starting a fresh session.
 */
export async function readLegacySession(sessionFile: string): Promise<LegacySessionSnapshot | undefined> {
	const path = resolve(sessionFile);
	let fileEntries: FileEntry[];
	try {
		fileEntries = parseSessionEntries(await readFile(path, "utf8"));
	} catch {
		// Unreadable file, or entries the SDK parser rejects.
		return undefined;
	}
	const header = fileEntries[0];
	if (!isSessionHeader(header)) return undefined;
	// In-memory schema migration only; the file is never rewritten.
	migrateSessionEntries(fileEntries);
	const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== "session");
	const leafId = entries.at(-1)?.id ?? null;
	let messages: LegacySessionMessages | undefined;
	return {
		sessionFile: path,
		sessionId: header.id,
		cwd: header.cwd ?? process.cwd(),
		header,
		entries,
		messages() {
			messages ??= buildSessionContext(entries, leafId).messages;
			return messages;
		},
	};
}
