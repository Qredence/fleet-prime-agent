/**
 * Process-wide prompt index.
 *
 * Pinned on `globalThis` so Vite's SSR full-module restarts do not drop the
 * loaded corpus or start a second background build, mirroring `getBridge()` in
 * `../singleton.ts`.
 */
import { SessionManager } from "prime-agent";
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
 * Reads one session through the runtime's supported `SessionManager`, the same
 * path the bridge uses to load a cold session. Transcripts are never
 * hand-parsed.
 */
const openSessionWithRuntime: OpenSession = async (sessionFile) => {
	const manager = await SessionManager.openAsync(sessionFile);
	return manager.buildSessionContext().messages.map((message) => ({
		role: (message as { role?: string }).role,
		text: messageText(message),
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
						messageCount: row.messageCount,
					};
				}),
			openSession: openSessionWithRuntime,
			log: (message) => process.stderr.write(`[completion] ${message}\n`),
		});
	}
	return globalStore.__fleetPromptIndex;
}
