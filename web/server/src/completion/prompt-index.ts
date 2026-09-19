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
import { harvestPromptCandidates, sessionIdFromFile } from "./match";

/**
 * Upper bound on how many sessions are indexed, most recently updated first.
 *
 * A guard against a pathological store, not a definition of the corpus. It was
 * 400, picked when a 404-session store made the window look like it covered
 * everything — and it silently cost 95 prompts from the 47 sessions it left out,
 * including one session holding 35. A prompt does not become less worth
 * repeating because the session holding it was last touched a month ago.
 *
 * The window is also the wrong lever for cost, which is what it was standing in
 * for. Measured on a store of 447 sessions: reading and harvesting *every* one
 * through `getEntries()` takes ~3.2 s, off the request path, and the build is
 * incremental afterwards. The bound therefore only exists so that a store of
 * hundreds of thousands of sessions cannot make a rebuild unbounded.
 */
export const PROMPT_INDEX_SESSION_LIMIT = 2_000;
/**
 * Sessions with more entries than this are skipped on rebuild so a multi‑10k
 * transcript cannot dominate memory/CPU. Incremental reuse of a prior harvest
 * still applies when the session timestamp has not moved.
 */
export const PROMPT_INDEX_MAX_SESSION_ENTRIES = 10_000;
/** Upper bound on the retained corpus, by recency. */
export const PROMPT_INDEX_CANDIDATE_LIMIT = 2_000;
/** A rebuild is started when the index is older than this. */
export const PROMPT_INDEX_MAX_AGE_MS = 10 * 60_000;
/** Wait after a failed or empty build before trying again. */
export const PROMPT_INDEX_RETRY_BACKOFF_MS = 60_000;

/**
 * How many consecutive empty rebuilds confirm that the store really is empty.
 *
 * A single empty listing is ambiguous — a daemon that is up but whose store has
 * not populated yet looks identical to a user who deleted every session. One
 * repeat tells them apart, so the first is treated as transient and the second
 * is trusted, which is what stops deleted prompts from being served forever.
 */
export const PROMPT_INDEX_EMPTY_CONFIRMATIONS = 2;

export const PROMPT_INDEX_FILE = "fleet-prompt-index.json";

/**
 * The persisted index's on-disk shape.
 *
 * Exported, along with {@link readPromptIndexFile} and
 * {@link flattenPromptIndex}, so the offline evaluation reads the corpus through
 * the same code that writes it. A second parser in a script would be free to
 * drift from this one, and an evaluation that measures a corpus the product never
 * builds is worth nothing.
 */
export type PersistedSession = {
	sessionFile: string;
	/** The runtime's own "last modified" for the session file. */
	modified: string;
	prompts: Array<string>;
};

export type PersistedPromptIndex = {
	version: 1;
	builtAt: string;
	/** Consecutive empty rebuilds seen so far; see the confirmation constant. */
	emptyStreak?: number;
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
};

export type PromptIndex = {
	/** Current candidates. Never waits on a build. */
	candidates(): ReadonlyArray<CompletionCandidate>;
	/**
	 * Resolves once the persisted index has been read from disk.
	 *
	 * Distinct from a rebuild: reading the file is milliseconds, and without this
	 * the first request after a process start is answered from an empty corpus —
	 * which is then cached as "no completion" for that draft.
	 */
	ready(): Promise<void>;
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

/** Reads the persisted index, or `undefined` when absent or unreadable. */
export async function readPromptIndexFile(agentDir: string): Promise<PersistedPromptIndex | undefined> {
	return readPersisted(agentDir);
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
		const emptyStreak = typeof raw.emptyStreak === "number" && raw.emptyStreak > 0 ? raw.emptyStreak : 0;
		return { version: 1, builtAt: typeof raw.builtAt === "string" ? raw.builtAt : "", emptyStreak, sessions };
	} catch {
		// A missing or corrupt index is recoverable: the next refresh rebuilds it.
		return undefined;
	}
}

async function writePersisted(agentDir: string, index: PersistedPromptIndex): Promise<void> {
	const path = promptIndexPath(agentDir);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(index)}\n`, "utf8");
	await rename(temporary, path);
}

/**
 * Flattens the index into ranked candidates, exactly as the matcher consumes them.
 *
 * The `sessionId` stamp (and `sessionFile` for diagnostics) lets the matcher
 * prefer the session being typed in; the sub-millisecond `at` offset is what
 * keeps a session's own prompts ordered without outranking a session updated a
 * moment later.
 */
export function flattenPromptIndex(index: PersistedPromptIndex, limit: number): Array<CompletionCandidate> {
	const out: Array<CompletionCandidate> = [];
	for (const session of index.sessions) {
		const base = Date.parse(session.modified);
		const at = Number.isFinite(base) ? base : 0;
		const sessionId = sessionIdFromFile(session.sessionFile);
		session.prompts.forEach((text, offset) => {
			// Later prompts in a session are more recent, but the tie-break must stay
			// strictly inside the session: adding whole milliseconds would let a long
			// session's nth prompt outrank a session updated a millisecond later.
			out.push({
				text,
				at: at + Math.min(offset, 999) / 1000,
				sessionFile: session.sessionFile,
				sessionId,
			});
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
	const now = options.now ?? Date.now;
	const log = options.log ?? (() => {});
	let persisted: PersistedPromptIndex | undefined;
	/** Memoised read of the persisted index; awaiting it always waits for the read. */
	let loading: Promise<void> | undefined;
	let building: Promise<void> | undefined;
	/** Set after a failed build so a down daemon is not retried per request. */
	let retryAfter = 0;
	/**
	 * Flattened view of {@link persisted}, rebuilt only when the index changes.
	 * Without it every completion request re-sorts the whole corpus on the typing
	 * path, for a value that only moves once per rebuild.
	 */
	let flattened: Array<CompletionCandidate> | undefined;

	// Memoised rather than guarded by a boolean: a boolean would let a caller
	// return before an already-started read had finished.
	const load = (): Promise<void> => {
		loading ??= (async () => {
			persisted = await readPersisted(options.agentDir);
			flattened = undefined;
		})();
		return loading;
	};

	// Start the read now so the corpus is in memory before the first keystroke
	// pause rather than after it.
	void load();

	/**
	 * Rebuilds the index. Returns false when the attempt failed or produced
	 * nothing usable, which the caller turns into a backoff so a flapping daemon
	 * is not retried on every keystroke pause.
	 */
	const build = async (): Promise<boolean> => {
		await load();
		const previous = new Map((persisted?.sessions ?? []).map((entry) => [entry.sessionFile, entry]));
		let sessions: ReadonlyArray<IndexableSession>;
		try {
			sessions = await options.listSessions();
		} catch (error) {
			log(`prompt index: session listing failed (${error instanceof Error ? error.name : "unknown"})`);
			return false;
		}

		const scoped = sessions
			.filter((session) => !isSubagent(session))
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
				if (messages.length > PROMPT_INDEX_MAX_SESSION_ENTRIES) {
					// Keep a prior harvest if we have one; otherwise skip the marathon.
					if (cached) next.push(cached);
					else {
						log(
							`prompt index: skipped ${session.sessionFile} (${messages.length} entries > ${PROMPT_INDEX_MAX_SESSION_ENTRIES})`,
						);
					}
					continue;
				}
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

		const harvest = next.reduce((total, entry) => total + entry.prompts.length, 0);
		const hadCorpus = (persisted?.sessions.length ?? 0) > 0;
		const emptyStreak = (persisted?.emptyStreak ?? 0) + 1;
		// A single empty listing must not destroy a good corpus and stamp it fresh,
		// which would silence completion for the whole freshness window — but a
		// repeat means the store really is empty, and keeping the old corpus would
		// serve prompts the user has since deleted.
		if (harvest === 0 && hadCorpus && emptyStreak < PROMPT_INDEX_EMPTY_CONFIRMATIONS) {
			// Record the attempt without touching `builtAt`, so the retry is governed
			// by the backoff rather than by the much longer freshness window.
			persisted = { ...persisted!, emptyStreak };
			try {
				await writePersisted(options.agentDir, persisted);
			} catch {
				// Failing to record the attempt only costs a repeated check.
			}
			log("prompt index: rebuild produced no prompts; keeping the previous corpus");
			return false;
		}
		if (harvest === 0 && hadCorpus) {
			log("prompt index: store confirmed empty; clearing the corpus");
		}

		persisted = { version: 1, builtAt: new Date(now()).toISOString(), emptyStreak: 0, sessions: next };
		flattened = undefined;
		try {
			await writePersisted(options.agentDir, persisted);
		} catch (error) {
			log(`prompt index: persist failed (${error instanceof Error ? error.name : "unknown"})`);
		}
		return true;
	};

	const ensureFresh = (): void => {
		if (building) return;
		if (now() < retryAfter) return;
		building = (async () => {
			await load();
			const builtAt = persisted ? Date.parse(persisted.builtAt) : Number.NaN;
			const fresh = Number.isFinite(builtAt) && now() - builtAt <= PROMPT_INDEX_MAX_AGE_MS;
			// A fresh index on disk is used as-is; only a stale one is rebuilt.
			if (fresh) return;
			const ok = await build();
			// Failed or empty attempts wait before trying again, so a daemon that is
			// down costs one attempt per window rather than one per request.
			retryAfter = ok ? 0 : now() + PROMPT_INDEX_RETRY_BACKOFF_MS;
		})()
			.catch(() => {
				retryAfter = now() + PROMPT_INDEX_RETRY_BACKOFF_MS;
			})
			.finally(() => {
				building = undefined;
			});
	};

	return {
		ready: () => load(),

		candidates(): ReadonlyArray<CompletionCandidate> {
			ensureFresh();
			if (!persisted) return [];
			flattened ??= flattenPromptIndex(persisted, PROMPT_INDEX_CANDIDATE_LIMIT);
			return flattened;
		},

		async refresh(): Promise<void> {
			await (building ?? build().then(() => undefined));
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
