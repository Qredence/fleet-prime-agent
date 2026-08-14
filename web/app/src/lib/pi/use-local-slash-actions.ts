import type { SuggestionItem } from "@prime-agent/web-design/components/agent-elements/input/suggestions";
import type { ForkPickerEntry } from "@prime-agent/web-design/components/fleet-pi/chat/fork-picker-dialog";
import { notify } from "@prime-agent/web-design/lib/notify";
import {
	availableThinkingLevels,
	type ChatModelOption,
	thinkingLevelLabel,
} from "@prime-agent/web-design/lib/pi/chat-helpers";
import type { ChatSessionInfo, ChatSessionMetadata, ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { useCallback } from "react";
import { assistantTextFromMessage, thinkingTextFromPart } from "./chat-message-helpers";
import type { LocalSlashAction, SettingsSlashTab } from "./slash-commands";
import { parseSlashInput, resolveLocalSlashAction } from "./slash-commands";

const CHAT_COMMAND_URL = "/api/chat/command";

export type { ForkPickerEntry };

type UseLocalSlashActionsArgs = {
	appendLocalMessage: (text: string) => void;
	getMessages: () => Array<ChatMessage>;
	getSessionMetadata: () => ChatSessionMetadata;
	modelKey: string | undefined;
	models: Array<ChatModelOption>;
	onForkPicker: (entries: Array<ForkPickerEntry>) => void;
	openSettings: (tab?: SettingsSlashTab) => void;
	resumeSession: (metadata: ChatSessionMetadata) => Promise<void>;
	sessions: Array<ChatSessionInfo>;
	setEffortPickerOpen: (open: boolean) => void;
	setModelKey: (key: string | undefined) => void;
	setModelPickerOpen: (open: boolean) => void;
	setThinkingLevel: (level: ChatThinkingLevel) => void;
	startNewSession: () => void;
};

function liveSessionId(metadata: ChatSessionMetadata): string | undefined {
	const id = metadata.sessionId?.trim();
	return id ? id : undefined;
}

/** Format a payload for the conversation echo the TUI would have shown. */
function formatSessionInfo({
	sessionId,
	sessionFile,
	name,
}: {
	sessionId: string;
	sessionFile: string | null | undefined;
	name: string | null;
}) {
	const id = sessionId.trim() || "none";
	const file = sessionFile?.trim() || "(not yet persisted)";
	return [name ? `Session: ${name}` : "Session", `  id:   ${id}`, `  file: ${file}`].join("\n");
}

/** Structural mirror of the bridge's session-tree node (only the fields the echo needs). */
type SessionTreeBranch = {
	entry: {
		id: string;
		type: string;
		label?: string;
		timestamp?: string;
		message?: { role?: string; content?: unknown };
	};
	label?: string;
	children: SessionTreeBranch[];
};

/** Outcome of a bridge command: `payload` is the parsed response body on success. */
type ChatCommandResult = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };

function messageContentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(part): part is { type: "text"; text: string } =>
				typeof part === "object" &&
				part !== null &&
				(part as { type?: unknown }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join(" ");
}

function treeEntryPreview(node: SessionTreeBranch): string {
	const { entry } = node;
	if (entry.type === "message" && entry.message) {
		const role = entry.message.role ?? "message";
		const oneLine = messageContentToText(entry.message.content).replace(/\s+/g, " ").trim();
		const preview = oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine;
		return `${role}: ${preview}`;
	}
	return entry.label ?? node.label ?? entry.type;
}

function treePreviewLines(nodes: SessionTreeBranch[], leafId: string | null): Array<string> {
	const lines: string[] = [];
	const walk = (items: SessionTreeBranch[], level: number) => {
		for (const item of items) {
			const marker = item.entry.id === leafId ? "*" : " ";
			const indent = "  ".repeat(level);
			lines.push(`${indent}${marker} ${item.entry.id}  ${treeEntryPreview(item)}`);
			walk(item.children, level + 1);
		}
	};
	walk(nodes, 0);
	return lines;
}

/** Render the branch listing (TUI parity: `*` marks the current leaf). */
function formatSessionTree(nodes: SessionTreeBranch[], leafId: string | null): string {
	const lines = treePreviewLines(nodes, leafId);
	return lines.length > 0 ? lines.join("\n") : "(empty session tree)";
}

function flattenForkCandidates(nodes: SessionTreeBranch[]): Array<ForkPickerEntry> {
	const all: Array<ForkPickerEntry> = [];
	const users: Array<ForkPickerEntry> = [];
	const walk = (items: SessionTreeBranch[]) => {
		for (const item of items) {
			if (item.entry.type === "message") {
				const entry = { id: item.entry.id, preview: treeEntryPreview(item) };
				all.push(entry);
				if (item.entry.message?.role === "user") users.push(entry);
			}
			walk(item.children);
		}
	};
	walk(nodes);
	return users.length > 0 ? users : all;
}

function lastAssistantCopyText(messages: Array<ChatMessage>): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message || message.role !== "assistant" || message.source === "local") continue;
		const text = assistantTextFromMessage(message).trim();
		if (text) return text;
		const thinking = message.parts.map(thinkingTextFromPart).join("").trim();
		if (thinking) return thinking;
	}
	return undefined;
}

function transcriptMarkdown(messages: Array<ChatMessage>): string {
	return messages
		.filter((message) => message.source !== "local")
		.map((message) => {
			const text =
				assistantTextFromMessage(message).trim() || message.parts.map(thinkingTextFromPart).join("").trim();
			return `**${message.role}**\n\n${text}`;
		})
		.filter((block) => block.trim().length > 0)
		.join("\n\n---\n\n");
}

export function useLocalSlashActions({
	appendLocalMessage,
	getMessages,
	getSessionMetadata,
	modelKey,
	models,
	onForkPicker,
	openSettings,
	resumeSession,
	sessions,
	setEffortPickerOpen,
	setModelKey,
	setModelPickerOpen,
	setThinkingLevel,
	startNewSession,
}: UseLocalSlashActionsArgs) {
	/** Fire the bridge runner and echo the result into the transcript. */
	const chatCommand = useCallback(
		async (command: string, args = ""): Promise<ChatCommandResult> => {
			const sessionId = liveSessionId(getSessionMetadata());
			if (!sessionId) {
				return {
					ok: false,
					error: "No active session — start a new one first.",
				};
			}
			try {
				const response = await fetch(CHAT_COMMAND_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId, command, args }),
				});
				if (!response.ok) {
					let message = `HTTP ${response.status}`;
					try {
						const errorPayload = (await response.json()) as Record<string, unknown>;
						if (typeof errorPayload.message === "string") message = errorPayload.message;
					} catch {
						// Non-JSON error body — fall back to the HTTP status.
					}
					return {
						ok: false,
						error: message,
					};
				}
				const payload = (await response.json()) as Record<string, unknown>;
				return { ok: true, payload };
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[getSessionMetadata],
	);

	/**
	 * Shared "run a /fork or /clone, then echo the result" path. Both commands
	 * return `{ newSessionId, selectedText? }`; they differ only in the copy of
	 * the success line.
	 */
	const echoBranchResult = useCallback(
		async (
			pending: Promise<ChatCommandResult>,
			verb: string,
			format: (payload: { newSessionId: string; selectedText: string }) => string,
		): Promise<void> => {
			const result = await pending;
			if (!result.ok) {
				appendLocalMessage(`${verb} failed: ${result.error}`);
				return;
			}
			const payload = {
				newSessionId: typeof result.payload.newSessionId === "string" ? result.payload.newSessionId : "?",
				selectedText: typeof result.payload.selectedText === "string" ? result.payload.selectedText : "(none)",
			};
			notify.success(format(payload));
			if (payload.newSessionId !== "?") {
				await resumeSession({ sessionId: payload.newSessionId });
				return;
			}
			appendLocalMessage(format(payload));
		},
		[appendLocalMessage, resumeSession],
	);

	const applyLocalSlashAction = useCallback(
		(action: LocalSlashAction): boolean => {
			switch (action.type) {
				case "open-model-picker": {
					if (action.modelKey && models.some((model) => model.id === action.modelKey)) {
						setModelKey(action.modelKey);
						notify.success(`Model set to ${action.modelKey}`);
						return true;
					}
					setEffortPickerOpen(false);
					setModelPickerOpen(true);
					return true;
				}
				case "open-effort-picker": {
					if (action.unknownLevel) {
						notify.error(`Unknown thinking level '${action.unknownLevel}'.`);
					}
					setModelPickerOpen(false);
					setEffortPickerOpen(true);
					return true;
				}
				case "set-thinking-level": {
					const selected = models.find((model) => model.id === modelKey);
					const available = availableThinkingLevels(selected);
					if (!available.includes(action.level)) {
						notify.error(`Unknown thinking level '${action.level}'. Available: ${available.join(", ")}`);
						setModelPickerOpen(false);
						setEffortPickerOpen(true);
						return true;
					}
					setThinkingLevel(action.level);
					notify.success(`Effort set to ${thinkingLevelLabel(action.level)}`);
					return true;
				}
				case "open-settings":
					openSettings(action.tab);
					return true;
				case "new-session":
					void startNewSession();
					return true;
				case "session-info": {
					void (async () => {
						const metadata = getSessionMetadata();
						const sessionId = liveSessionId(metadata);
						const result = await chatCommand("session");
						if (!result.ok || !sessionId) {
							appendLocalMessage(
								formatSessionInfo({
									sessionId: sessionId ?? "none",
									sessionFile: metadata.sessionFile,
									name: null,
								}),
							);
							return;
						}
						appendLocalMessage(
							formatSessionInfo({
								sessionId,
								sessionFile: metadata.sessionFile,
								name: typeof result.payload.name === "string" ? result.payload.name : null,
							}),
						);
					})();
					return true;
				}
				case "session-rename": {
					if (!action.name) {
						appendLocalMessage("Usage: /name <display name>");
						return true;
					}
					void (async () => {
						const result = await chatCommand("name", action.name ?? "");
						appendLocalMessage(
							result.ok ? `Session renamed to "${action.name}".` : `Couldn't rename session: ${result.error}`,
						);
					})();
					return true;
				}
				case "session-context": {
					void (async () => {
						const result = await chatCommand("context");
						if (!result.ok) {
							appendLocalMessage(`Couldn't load context: ${result.error}`);
							return;
						}
						const usage = result.payload.usage as
							| {
									tokens?: number;
									contextWindow?: number;
									percent?: number;
							  }
							| null
							| undefined;
						if (!usage) {
							appendLocalMessage("Context usage isn't available yet — no model response on this branch.");
							return;
						}
						const { tokens, contextWindow, percent } = usage;
						appendLocalMessage(
							`Context usage: ~${tokens ?? "?"}/${contextWindow ?? "?"} tokens${typeof percent === "number" ? ` (${percent.toFixed(1)}%)` : ""}`,
						);
					})();
					return true;
				}
				case "session-system-prompt": {
					void (async () => {
						const result = await chatCommand("system-prompt");
						if (!result.ok) {
							appendLocalMessage(`Couldn't load system prompt: ${result.error}`);
							return;
						}
						const systemPrompt =
							typeof result.payload.systemPrompt === "string" ? result.payload.systemPrompt : "(empty)";
						appendLocalMessage(systemPrompt);
					})();
					return true;
				}
				case "session-logs":
					appendLocalMessage(
						"Daemon and client logs live at `~/.prime/agent/log/`. Use your OS's log viewer or `tail -f` there (TUI parity with /logs).",
					);
					return true;
				case "session-export": {
					void (async () => {
						const result = await chatCommand("export", action.outputPath ?? "");
						if (!result.ok) {
							appendLocalMessage(`Export failed: ${result.error}`);
							return;
						}
						const path = typeof result.payload.path === "string" ? result.payload.path : "(unknown path)";
						const format = typeof result.payload.format === "string" ? result.payload.format : "html";
						appendLocalMessage(`Session exported to ${path} (${format})`);
					})();
					return true;
				}
				case "session-fork": {
					if (action.args) {
						void echoBranchResult(
							chatCommand("fork", action.args),
							"Fork",
							(payload) => `Forked → session ${payload.newSessionId}. Selected text: ${payload.selectedText}`,
						);
						return true;
					}
					void (async () => {
						const result = await chatCommand("tree");
						if (!result.ok) {
							appendLocalMessage(`Fork picker failed: ${result.error}`);
							return;
						}
						const payload = result.payload.tree as
							| { tree?: SessionTreeBranch[]; leafId?: string | null }
							| undefined;
						const candidates = Array.isArray(payload?.tree) ? flattenForkCandidates(payload.tree) : [];
						if (candidates.length === 0) {
							appendLocalMessage("No fork points yet — send a user message first, then run /fork.");
							return;
						}
						onForkPicker(candidates);
					})();
					return true;
				}
				case "session-clone": {
					void echoBranchResult(
						chatCommand("clone"),
						"Clone",
						(payload) => `Cloned → session ${payload.newSessionId}.`,
					);
					return true;
				}
				case "session-tree": {
					void (async () => {
						const result = await chatCommand("tree", action.args ?? "");
						if (!result.ok) {
							appendLocalMessage(`Tree failed: ${result.error}`);
							return;
						}
						const payload = result.payload.tree as
							| { tree?: SessionTreeBranch[]; leafId?: string | null }
							| undefined;
						if (!payload || !Array.isArray(payload.tree)) {
							appendLocalMessage("(no session tree available)");
							return;
						}
						appendLocalMessage(formatSessionTree(payload.tree, payload.leafId ?? null));
					})();
					return true;
				}
				case "session-share": {
					void (async () => {
						const markdown = transcriptMarkdown(getMessages());
						if (!markdown.trim()) {
							appendLocalMessage("Nothing to share yet.");
							return;
						}
						await navigator.clipboard.writeText(markdown);
						notify.success("Transcript copied");
						appendLocalMessage(
							"Copied the transcript to the clipboard. GitHub Gist upload is TUI-only in this port.",
						);
					})().catch((error) => {
						notify.error(`Share failed: ${error instanceof Error ? error.message : String(error)}`);
					});
					return true;
				}
				case "session-import":
					appendLocalMessage(
						action.path
							? `/import ${action.path} is not wired in the web port. Resume a saved conversation from the session picker instead.`
							: "Usage: /import <path.jsonl> — JSONL import is not wired in the web port. Use the session picker to resume.",
					);
					return true;
				case "session-btw":
					appendLocalMessage(
						action.question
							? `/btw is not wired in the web port. Side question was not sent:\n${action.question}`
							: "Usage: /btw <question> — side questions are not wired in the web port.",
					);
					return true;
				case "session-traces":
					appendLocalMessage(
						"Prime Agent traces (preview / upload / login) are TUI-only. The web port does not upload traces.",
					);
					return true;
				case "session-agents": {
					if (sessions.length === 0) {
						appendLocalMessage(
							"No saved sessions. The web port has no daemon agent tray — use the conversation picker in the header.",
						);
						return true;
					}
					const lines = sessions.map((session) => {
						const label = session.name || session.firstMessage || "(unnamed)";
						return `${session.id}  ${label}`;
					});
					appendLocalMessage(`Saved sessions (web stand-in for /agents):\n${lines.join("\n")}`);
					return true;
				}
				case "open-providers":
					openSettings("providers");
					return true;
				case "open-logout":
					openSettings("providers");
					appendLocalMessage(
						"Provider sign-out: pick a provider in Settings > Providers to remove its stored auth.",
					);
					return true;
				case "open-mcp":
					openSettings("pi-harness");
					if (action.args) {
						appendLocalMessage(`MCP: ${action.args} (manage connections in Settings > Pi Harness)`);
					}
					return true;
				case "fast-toggle": {
					void (async () => {
						appendLocalMessage(
							"/fast toggles OpenAI Fast mode. The web port reads this from ~/.prime/agent/settings.json — flip `fastMode` there or in Settings.",
						);
					})();
					return true;
				}
				case "reload-resources": {
					void (async () => {
						const result = await chatCommand("reload");
						appendLocalMessage(
							result.ok
								? "Reloaded keybindings, extensions, skills, prompts, and themes."
								: `Reload failed: ${result.error}`,
						);
					})();
					return true;
				}
				case "show-changelog":
					appendLocalMessage(
						"Changelog lives at https://github.com/PrimeIntellect-ai/prime-agent/blob/main/CHANGELOG.md",
					);
					return true;
				case "show-hotkeys":
					appendLocalMessage(
						"Web port hotkeys: Enter=send, Alt+Enter=follow-up while streaming, / = slash menu, ⌘K=command palette.",
					);
					return true;
				case "copy-last-reply": {
					void (async () => {
						const text = lastAssistantCopyText(getMessages());
						if (!text) {
							notify.error("No assistant message to copy");
							return;
						}
						await navigator.clipboard.writeText(text);
						notify.success("Last assistant message copied");
					})().catch((error) => {
						notify.error(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
					});
					return true;
				}
				case "update-check":
					appendLocalMessage(
						"/update is TUI-only (pulls latest Prime Agent release). Use npm/pnpm in your shell to upgrade.",
					);
					return true;
				case "toggle-fullscreen":
					appendLocalMessage(
						"/fullscreen is TUI-only (alternate screen rendering). In the browser, use your OS/browser fullscreen.",
					);
					return true;
				case "quit-app":
					appendLocalMessage("/quit is TUI-only (exits the agent loop). Close this browser tab instead.");
					return true;
				case "rlm-max-depth":
					appendLocalMessage("/rlm-max-depth is not yet wired in the web port.");
					return true;
				case "heartbeat-manage":
				case "heartbeat-list":
					appendLocalMessage(
						"/heartbeat(s) are not wired in the web port. Persistent heartbeats remain TUI/session-cron.",
					);
					return true;
				default: {
					const exhaustiveCheck: never = action;
					void exhaustiveCheck;
					return false;
				}
			}
		},
		[
			appendLocalMessage,
			chatCommand,
			echoBranchResult,
			getMessages,
			getSessionMetadata,
			modelKey,
			models,
			onForkPicker,
			openSettings,
			sessions,
			setEffortPickerOpen,
			setModelKey,
			setModelPickerOpen,
			setThinkingLevel,
			startNewSession,
		],
	);

	const handleSlashCommandSelect = useCallback(
		(item: SuggestionItem) => {
			const action = resolveLocalSlashAction(item.id);
			if (!action) return false;
			return applyLocalSlashAction(action);
		},
		[applyLocalSlashAction],
	);

	const handleLocalSlashSubmit = useCallback(
		(message: string) => {
			const parsed = parseSlashInput(message);
			if (!parsed) return false;
			const action = resolveLocalSlashAction(parsed.command, parsed.args);
			if (!action) return false;
			return applyLocalSlashAction(action);
		},
		[applyLocalSlashAction],
	);

	const forkFromEntry = useCallback(
		(entryId: string) => {
			void echoBranchResult(
				chatCommand("fork", entryId),
				"Fork",
				(payload) => `Forked → session ${payload.newSessionId}. Selected text: ${payload.selectedText}`,
			);
		},
		[chatCommand, echoBranchResult],
	);

	return {
		applyLocalSlashAction,
		forkFromEntry,
		handleLocalSlashSubmit,
		handleSlashCommandSelect,
	};
}
