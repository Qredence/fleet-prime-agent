/**
 * Process-wide prompt index.
 *
 * Pinned on `globalThis` so Vite's SSR full-module restarts do not drop the
 * loaded corpus or start a second background build, mirroring `getBridge()` in
 * `../singleton.ts`.
 */
import { SessionManager, type SessionMessageEntry } from "prime-agent";
import { getPrimeConfig } from "../prime-config";
import { normalizeSessionListRow, sessionSourcePath } from "../session-list";
import { getBridge } from "../singleton";
import { createPromptIndex, type OpenSession, type PromptIndex } from "./prompt-index";

type CompletionGlobal = { __fleetPromptIndex?: PromptIndex };
const globalStore = globalThis as unknown as CompletionGlobal;

/**
 * Pulls the user-authored text out of one runtime message.
 *
 * The same shape `selectedTextFromSessionEntry` (prime-bridge.ts) handles for
 * session-tree entries, but for a raw `AgentMessage` rather than a
 * `SessionTreeEntry`, and joined with a space: text parts can split mid-sentence,
 * so joining with nothing would glue words together.
 */
function messageText(message: unknown): string {
	if (typeof message !== "object" || message === null) return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text: string } => {
			if (typeof part !== "object" || part === null) return false;
			const candidate = part as { type?: unknown; text?: unknown };
			return candidate.type === "text" && typeof candidate.text === "string";
		})
		.map((part) => part.text)
		.join(" ");
}

/**
 * Reads one session through the runtime's supported `SessionManager`. Transcripts
 * are never hand-parsed.
 *
 * `getEntries()` rather than `buildSessionContext().messages`, and the difference
 * is the point of the corpus. A context is what the *model* is shown: the branch
 * leading to the current leaf, with everything before a compaction's
 * `firstKeptEntryId` collapsed into a summary. A prompt is something the person
 * *wrote*, and it does not stop being one because the conversation was compacted
 * or the branch was abandoned. Measured over a real store of 447 sessions, the
 * context view yielded 522 prompts and the entry view 830 — the corpus was never
 * thin, it was being read through a lossy lens.
 *
 * Roles are preserved rather than pre-filtered, so `harvestPromptCandidates`
 * stays the single authority on what counts: bash output (`bashExecution`),
 * compaction summaries (`compactionSummary`) and harness messages are entries
 * too, and none of them is a candidate.
 *
 * Exported so the test can pin that difference against a real session file.
 */
export const openSessionWithRuntime: OpenSession = async (sessionFile) => {
	const manager = await SessionManager.openAsync(sessionFile);
	return manager
		.getEntries()
		.filter((entry): entry is SessionMessageEntry => entry.type === "message")
		.map((entry) => ({
			role: (entry.message as { role?: string }).role,
			text: messageText(entry.message),
		}));
};

export function getPromptIndex(): PromptIndex {
	if (!globalStore.__fleetPromptIndex) {
		globalStore.__fleetPromptIndex = createPromptIndex({
			agentDir: getPrimeConfig().agentDir,
			// Normalised through the same code path the session list uses, so
			// subagent detection cannot drift from Fleet's own.
			listSessions: async () =>
				(await getBridge().listSessions()).map((summary) => {
					const row = normalizeSessionListRow(summary);
					return {
						sessionFile: sessionSourcePath(row.source),
						modified: row.updatedAt,
						isSubagent: row.isSubagent,
					};
				}),
			openSession: openSessionWithRuntime,
			log: (message) => process.stderr.write(`[completion] ${message}\n`),
		});
	}
	return globalStore.__fleetPromptIndex;
}
