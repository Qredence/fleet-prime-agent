/**
 * The developer's own prompt history, indexed for completion.
 *
 * Fleet-owned derived state: it lives beside the runtime's files, never inside
 * them, following the `fleet-settings.ts` convention. Only user-authored text is
 * ever stored — never assistant output, never tool results.
 *
 * Building is always off the request path. `candidates()` answers from the
 * persisted index immediately and refreshes in the background when stale, so a
 * cold or huge history can never add latency to typing.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CompletionCandidate } from "./match";
import { harvestPromptCandidates } from "./match";

/**
 * Upper bound on how many of the most recently updated sessions are indexed.
 *
 * Chosen from measurement rather than taste. On a real store of 404 non-subagent
 * sessions, the window size and the resulting corpus were:
 *
 * | sessions | prompts | build |
 * | -------- | ------- | ----- |
 * | 50       | 49      | ~5s   |
 * | 200      | 276     | ~5s   |
 * | 400      | 534     | ~6s   |
 *
 * The narrow window is the trap: recent activity on a working machine is mostly
 * short sessions, so "the 50 most recent" held barely 50 prompts. Widening is
 * nearly free because the large sessions are skipped (see
 * {@link PROMPT_INDEX_MAX_SESSION_MESSAGES}) and the build is incremental.
 */
export const PROMPT_INDEX_SESSION_LIMIT = 400;

/**
 * Sessions larger than this are skipped.
 *
 * A marathon run carries thousands of messages but very few user turns — measured
 * at 21, 37 and 25 user prompts across sessions of 10 008, 6 393 and 4 932
 * messages — so reading them is the most expensive and least productive part of
 * the build.
 */
export const PROMPT_INDEX_MAX_SESSION_MESSAGES = 2_000;
/** Upper bound on the retained corpus, by recency. */
export const PROMPT_INDEX_CANDIDATE_LIMIT = 2_000;
/** A rebuild is started when the index is older than this. */
export const PROMPT_INDEX_MAX_AGE_MS = 10 * 60_000;

export const PROMPT_INDEX_FILE = "fleet-prompt-index.json";

type PersistedSession = {
	sessionFile: string;
	/** The runtime's own "last modified" for the session file. */
	modified: string;
	prompts: Array<string>;
};

type PersistedPromptIndex = {
	version: 1;
	builtAt: string;
	sessions: Array<PersistedSession>;
};

/**
 * One row of the runtime's session listing, already normalised by
 * `session-list.ts`.
 *
 * Deliberately *not* re-deriving these fields here. Subagent detection in
 * particular has several runtime markers (`runtimeKind`, `rlmChildId`,
 * `rlmParentNodeId`, `parentActiveSessionId`, `parentSessionId`,
 * `parentSessionPath`) and an incomplete check silently indexes subagent
 * sessions — which are created constantly and would otherwise fill the entire
 * recency window with sessions that contain no user prompts at all.
 */
export type IndexableSession = {
	sessionFile?: string;
	/** The runtime's own last-modified timestamp for the session. */
	modified?: string;
	isSubagent?: boolean;
	/** Used to skip marathon sessions, which are expensive and prompt-poor. */
	messageCount?: number;
};

/**
 * Opens one session and returns its user-authored text.
 *
 * Structurally typed so tests can inject a double. The default implementation
 * uses the runtime's supported `SessionManager`, mirroring the cold-load path in
 * `prime-bridge.ts`.
 */
export type OpenSession = (sessionFile: string) => Promise<ReadonlyArray<{ role?: string; text: string }>>;

export type PromptIndexOptions = {
	listSessions: () => Promise<ReadonlyArray<IndexableSession>>;
	openSession: OpenSession;
	agentDir: string;
	now?: () => number;
	log?: (message: string) => void;
	sessionLimit?: number;
	maxSessionMessages?: number;
};

export type PromptIndex = {
	/** Current candidates. Never waits on a build. */
	candidates(): ReadonlyArray<CompletionCandidate>;
	/** Forces a rebuild and resolves when it finishes. */
	refresh(): Promise<void>;
	/** Diagnostics for tests. */
	stats(): { sessions: number; prompts: number; builtAt: number };
};

export function promptIndexPath(agentDir: string): string {
	return join(agentDir, PROMPT_INDEX_FILE);
}

function isSubagent(session: IndexableSession): boolean {
	return session.isSubagent === true;
}

/** Recency key for a session, used both for scoping and for ranking. */
function sessionRecency(session: IndexableSession): number {
	const raw = session.modified;
	const parsed = raw ? Date.parse(raw) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : 0;
}

async function readPersisted(agentDir: string): Promise<PersistedPromptIndex | undefined> {
	try {
		const raw = JSON.parse(await readFile(promptIndexPath(agentDir), "utf8")) as Partial<PersistedPromptIndex>;
		if (raw.version !== 1 || !Array.isArray(raw.sessions)) return undefined;
		const sessions = raw.sessions.filter(
			(entry): entry is PersistedSession =>
				typeof entry?.sessionFile === "string" &&
				typeof entry.modified === "string" &&
				Array.isArray(entry.prompts) &&
				entry.prompts.every((prompt) => typeof prompt === "string"),
		);
		return { version: 1, builtAt: typeof raw.builtAt === "string" ? raw.builtAt : "", sessions };
	} catch {
		// A missing or corrupt index is recoverable: the next refresh rebuilds it.
		return undefined;
	}
}

async function writePersisted(agentDir: string, index: PersistedPromptIndex): Promise<void> {
	const path = promptIndexPath(agentDir);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(index)}\n`, "utf8");
	await rename(temporary, path);
}

function flatten(index: PersistedPromptIndex, limit: number): Array<CompletionCandidate> {
	const out: Array<CompletionCandidate> = [];
	for (const session of index.sessions) {
		const base = Date.parse(session.modified);
		const at = Number.isFinite(base) ? base : 0;
		session.prompts.forEach((text, offset) => {
			// Later prompts in a session are more recent; the offset only breaks ties.
			out.push({ text, at: at + offset });
		});
	}
	out.sort((a, b) => b.at - a.at);
	return out.slice(0, limit);
}

/**
 * Creates a prompt index. Prefer {@link getPromptIndex} for the process-wide
 * instance; construct directly in tests.
 */
export function createPromptIndex(options: PromptIndexOptions): PromptIndex {
	const limit = options.sessionLimit ?? PROMPT_INDEX_SESSION_LIMIT;
	const maxSessionMessages = options.maxSessionMessages ?? PROMPT_INDEX_MAX_SESSION_MESSAGES;
	const now = options.now ?? Date.now;
	const log = options.log ?? (() => {});
	let persisted: PersistedPromptIndex | undefined;
	let loaded = false;
	let building: Promise<void> | undefined;

	const load = async (): Promise<void> => {
		if (loaded) return;
		loaded = true;
		persisted = await readPersisted(options.agentDir);
	};

	const build = async (): Promise<void> => {
		await load();
		const previous = new Map((persisted?.sessions ?? []).map((entry) => [entry.sessionFile, entry]));
		let sessions: ReadonlyArray<IndexableSession>;
		try {
			sessions = await options.listSessions();
		} catch (error) {
			log(`prompt index: session listing failed (${error instanceof Error ? error.name : "unknown"})`);
			return;
		}

		const scoped = sessions
			.filter((session) => !isSubagent(session))
			// Marathon sessions are the most expensive reads and the least
			// productive: thousands of messages, a handful of user turns.
			.filter((session) => (session.messageCount ?? 0) <= maxSessionMessages)
			.filter(
				(session): session is IndexableSession & { sessionFile: string } =>
					typeof session.sessionFile === "string" && session.sessionFile.length > 0,
			)
			.sort((a, b) => sessionRecency(b) - sessionRecency(a))
			.slice(0, limit);

		const next: Array<PersistedSession> = [];
		for (const session of scoped) {
			const modified = session.modified ?? "";
			const cached = previous.get(session.sessionFile);
			// Incremental: a session whose timestamp has not moved is reused as-is.
			if (cached && cached.modified === modified) {
				next.push(cached);
				continue;
			}
			try {
				const messages = await options.openSession(session.sessionFile);
				next.push({
					sessionFile: session.sessionFile,
					modified,
					prompts: harvestPromptCandidates(messages, 0).map((candidate) => candidate.text),
				});
			} catch {
				// An unreadable session is skipped rather than failing the whole index.
				if (cached) next.push(cached);
			}
		}

		persisted = { version: 1, builtAt: new Date(now()).toISOString(), sessions: next };
		try {
			await writePersisted(options.agentDir, persisted);
		} catch (error) {
			log(`prompt index: persist failed (${error instanceof Error ? error.name : "unknown"})`);
		}
	};

	const ensureFresh = (): void => {
		if (building) return;
		building = (async () => {
			await load();
			const builtAt = persisted ? Date.parse(persisted.builtAt) : Number.NaN;
			const fresh = Number.isFinite(builtAt) && now() - builtAt <= PROMPT_INDEX_MAX_AGE_MS;
			// A fresh index on disk is used as-is; only a stale one is rebuilt.
			if (fresh) return;
			await build();
		})()
			.catch(() => undefined)
			.finally(() => {
				building = undefined;
			});
	};

	return {
		candidates(): ReadonlyArray<CompletionCandidate> {
			ensureFresh();
			if (!persisted) return [];
			return flatten(persisted, PROMPT_INDEX_CANDIDATE_LIMIT);
		},

		async refresh(): Promise<void> {
			await (building ?? build());
		},

		stats(): { sessions: number; prompts: number; builtAt: number } {
			const builtAt = persisted ? Date.parse(persisted.builtAt) : Number.NaN;
			return {
				sessions: persisted?.sessions.length ?? 0,
				prompts: persisted?.sessions.reduce((total, entry) => total + entry.prompts.length, 0) ?? 0,
				builtAt: Number.isFinite(builtAt) ? builtAt : 0,
			};
		},
	};
}
