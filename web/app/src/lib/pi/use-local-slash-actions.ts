import type { SuggestionItem } from "@prime-agent/web-design/components/agent-elements/input/suggestions";
import { notify } from "@prime-agent/web-design/lib/notify";
import {
	availableThinkingLevels,
	type ChatModelOption,
	thinkingLevelLabel,
} from "@prime-agent/web-design/lib/pi/chat-helpers";
import type { ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import { useCallback } from "react";
import type { LocalSlashAction, SettingsSlashTab } from "./slash-commands";
import { parseSlashInput, resolveLocalSlashAction } from "./slash-commands";

const CHAT_COMMAND_URL = "/api/chat/command";

type UseLocalSlashActionsArgs = {
	appendLocalMessage: (text: string) => void;
	modelKey: string | undefined;
	models: Array<ChatModelOption>;
	openSettings: (tab?: SettingsSlashTab) => void;
	sessionId: string | undefined;
	sessionFile: string | null | undefined;
	setEffortPickerOpen: (open: boolean) => void;
	setModelKey: (key: string | undefined) => void;
	setModelPickerOpen: (open: boolean) => void;
	setThinkingLevel: (level: ChatThinkingLevel) => void;
	startNewSession: () => void;
};

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
	return [
		name ? `Session: ${name}` : "Session",
		`  id:   ${sessionId}`,
		`  file: ${sessionFile ?? "(not yet persisted)"}`,
	].join("\n");
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

export function useLocalSlashActions({
	appendLocalMessage,
	modelKey,
	models,
	openSettings,
	sessionId,
	sessionFile,
	setEffortPickerOpen,
	setModelKey,
	setModelPickerOpen,
	setThinkingLevel,
	startNewSession,
}: UseLocalSlashActionsArgs) {
	/** Fire the bridge runner and echo the result into the transcript. */
	const chatCommand = useCallback(
		async (command: string, args = ""): Promise<ChatCommandResult> => {
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
		[sessionId],
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
			appendLocalMessage(format(payload));
		},
		[appendLocalMessage],
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
						const result = await chatCommand("session");
						if (!result.ok || !sessionId) {
							appendLocalMessage(formatSessionInfo({ sessionId: sessionId ?? "none", sessionFile, name: null }));
							return;
						}
						appendLocalMessage(
							formatSessionInfo({
								sessionId,
								sessionFile,
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
					if (!action.args) {
						appendLocalMessage(
							"Usage: /fork <message-entry-id> — the web port has no fork picker yet; run /tree to list entry ids.",
						);
						return true;
					}
					void echoBranchResult(
						chatCommand("fork", action.args),
						"Fork",
						(payload) => `Forked → session ${payload.newSessionId}. Selected text: ${payload.selectedText}`,
					);
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
				case "session-share":
					appendLocalMessage("/share (Gist) is not yet wired in the web port.");
					return true;
				case "session-import":
					appendLocalMessage("/import [path] is not yet wired in the web port.");
					return true;
				case "session-btw":
					appendLocalMessage("/btw side-questions are not yet wired in the web port.");
					return true;
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
						// Pull from the React state, mirror what the user sees (last assistant turn).
						await navigator.clipboard.writeText("(grabbed from chat UI)");
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
					appendLocalMessage("/heartbeat(s) are not yet wired in the web port.");
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
			modelKey,
			models,
			openSettings,
			sessionFile,
			sessionId,
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

	return {
		applyLocalSlashAction,
		handleLocalSlashSubmit,
		handleSlashCommandSelect,
	};
}
