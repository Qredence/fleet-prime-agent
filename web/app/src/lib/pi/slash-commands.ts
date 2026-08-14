import type {
	ChatResourcesResponse,
	ChatSlashCommandInfo,
	ChatThinkingLevel,
} from "@prime-agent/web-protocol/chat-protocol";
import { ChatThinkingLevelSchema } from "@prime-agent/web-protocol/chat-protocol.zod";

/**
 * Web port of prime-agent's builtin slash-command dispatcher
 * (`packages/coding-agent/src/core/slash-commands.ts` + the handler chain in
 * `packages/coding-agent/src/modes/interactive/interactive-mode.ts`). Every
 * canonical name (and the `clear`/`usage`/`thinking`/`rename`/`side` aliases)
 * resolves to a route HERE — autocomplete can freely advertise the full
 * surface because nothing falls through to the LLM.
 */
export const WEB_BUILTIN_SLASH_COMMANDS: Array<ChatSlashCommandInfo> = [
	{ name: "settings", description: "Open Settings", source: "builtin" },
	{
		name: "model",
		description: "Open the model picker",
		argumentHint: "[provider/id]",
		source: "builtin",
	},
	{
		name: "effort",
		description: "Select reasoning/thinking level",
		argumentHint: "[level]",
		source: "builtin",
	},
	{ name: "fast", description: "Toggle OpenAI Fast mode", source: "builtin" },
	{
		name: "scoped-models",
		description: "Enable/disable models for cycling",
		source: "builtin",
	},
	{
		name: "export",
		description: "Export session (HTML default, or .html/.jsonl path)",
		argumentHint: "[path]",
		source: "builtin",
	},
	{
		name: "import",
		description: "Import and resume a session from a JSONL file",
		argumentHint: "<path.jsonl>",
		source: "builtin",
	},
	{ name: "share", description: "Copy the transcript (Gist upload is TUI-only)", source: "builtin" },
	{ name: "copy", description: "Copy last agent message to clipboard", source: "builtin" },
	{
		name: "btw",
		description: "Ask a side question without adding it to the session",
		argumentHint: "<question>",
		source: "builtin",
	},
	{
		name: "name",
		description: "Set or show the session display name",
		argumentHint: "[name]",
		source: "builtin",
	},
	{ name: "session", description: "Show current session metadata", source: "builtin" },
	{ name: "system-prompt", description: "Show the exact system prompt sent to the model", source: "builtin" },
	{ name: "logs", description: "Show where daemon and client logs are saved", source: "builtin" },
	{
		name: "traces",
		description: "Preview, upload, or configure Prime Agent traces",
		argumentHint: "[status|on|off|preview|upload]",
		source: "builtin",
	},
	{ name: "context", description: "Show token and context usage", source: "builtin" },
	{ name: "changelog", description: "Show changelog entries", source: "builtin" },
	{ name: "hotkeys", description: "Show keyboard shortcuts", source: "builtin" },
	{
		name: "fork",
		description: "Create a new fork from a previous user message",
		argumentHint: "[message-entry-id]",
		source: "builtin",
	},
	{ name: "clone", description: "Duplicate the current session at the current position", source: "builtin" },
	{ name: "tree", description: "Show the session tree (switch branches)", source: "builtin" },
	{ name: "agents", description: "List saved sessions (web stand-in for the TUI agent tray)", source: "builtin" },
	{ name: "login", description: "Configure provider authentication", source: "builtin" },
	{ name: "logout", description: "Remove provider authentication", source: "builtin" },
	{
		name: "mcp",
		description: "Open MCP connections in Settings",
		argumentHint: "[list|login <name>|logout <name>]",
		source: "builtin",
	},
	{ name: "new", description: "Start a new chat session", source: "builtin" },
	{
		name: "compact",
		description: "Compact the session context",
		argumentHint: "[instructions]",
		source: "builtin",
	},
	{ name: "refine", description: "Refine continual harness prompt notes, skills, and memory", source: "builtin" },
	{
		name: "goal",
		description: "Set or view a persistent goal",
		argumentHint: "[objective]",
		source: "builtin",
	},
	{
		name: "autonomous",
		description: "Set or view autonomous mode",
		argumentHint: "[status|on|off]",
		source: "builtin",
	},
	{
		name: "rlm-max-depth",
		description: "Set or view per-chat RLM max depth",
		argumentHint: "[<int> [--global]]",
		source: "builtin",
	},
	{
		name: "heartbeat",
		description: "Set or view a persistent heartbeat",
		argumentHint: "[status|pause|resume|stop]",
		source: "builtin",
	},
	{ name: "heartbeats", description: "View user and agent heartbeats", source: "builtin" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes", source: "builtin" },
	{ name: "update", description: "Update Prime Agent (TUI-only)", source: "builtin" },
	{ name: "fullscreen", description: "Toggle fullscreen (TUI-only)", source: "builtin" },
	{ name: "quit", description: "Quit (TUI-only; close this tab instead)", source: "builtin" },
];

export type SettingsSlashTab = "appearance" | "sandbox" | "providers" | "llm-models" | "skills" | "pi-harness";

export type LocalSlashAction =
	| { type: "open-model-picker"; modelKey?: string }
	| { type: "open-effort-picker"; unknownLevel?: string }
	| { type: "set-thinking-level"; level: ChatThinkingLevel }
	| { type: "open-settings"; tab: SettingsSlashTab }
	| { type: "new-session" }
	| { type: "session-info" }
	| { type: "session-rename"; name: string | undefined }
	| { type: "session-context" }
	| { type: "session-system-prompt" }
	| { type: "session-logs" }
	| { type: "session-export"; outputPath: string | undefined }
	| { type: "session-fork"; args: string }
	| { type: "session-clone" }
	| { type: "session-tree"; args: string }
	| { type: "session-share" }
	| { type: "session-import"; path: string }
	| { type: "session-btw"; question: string }
	| { type: "open-providers" } // /login — top-level "providers" settings tab
	| { type: "open-logout" } // /logout — provider auth cleanup
	| { type: "open-mcp"; args: string } // /mcp [args]
	| { type: "fast-toggle" } // /fast
	| { type: "reload-resources" } // /reload
	| { type: "show-changelog" } // /changelog
	| { type: "show-hotkeys" } // /hotkeys
	| { type: "copy-last-reply" } // /copy
	| { type: "update-check"; args: string } // /update — TUI only, toast
	| { type: "rlm-max-depth"; args: string } // /rlm-max-depth
	| { type: "heartbeat-list" } // /heartbeats
	| { type: "heartbeat-manage"; args: string } // /heartbeat
	| { type: "session-traces" } // /traces
	| { type: "session-agents" } // /agents
	| { type: "toggle-fullscreen" } // /fullscreen — TUI only, toast
	| { type: "quit-app" } // /quit — TUI only, toast
	| { type: "echo"; text: string }; // advertised builtin with no web wiring yet

/**
 * Aliases are resolved **server-side** by `resolveBuiltinSlashCommandName` in
 * the TUI; mirror that mapping here so `/clear` works as `/new` etc.
 */
const SLASH_COMMAND_ALIASES: Record<string, string> = {
	clear: "new",
	usage: "context",
	thinking: "effort",
	rename: "name",
	side: "btw",
};

function parseThinkingLevelArg(args: string): ChatThinkingLevel | undefined {
	const parsed = ChatThinkingLevelSchema.safeParse(args.trim().toLowerCase());
	return parsed.success ? parsed.data : undefined;
}

export function resolveSlashCommandAlias(command: string): string {
	return SLASH_COMMAND_ALIASES[command] ?? command;
}

/** Parse a `/cmd [args]` string from the composer. Returns null if not slash. */
export function parseSlashInput(message: string) {
	const match = message.trim().match(/^\/(\S+)(?:\s+(.*))?$/);
	if (!match) return null;
	const [, command = "", rawArgs = ""] = match;
	return {
		command,
		args: rawArgs.trim(),
	};
}

/** Strip a matched pair of quotes wrapping a single path argument (TUI parity with getPathCommandArgument). */
export function parseQuotedPathArgument(args: string): string | undefined {
	const trimmed = args.trim();
	if (!trimmed) return undefined;
	const first = trimmed[0];
	if (first !== '"' && first !== "'") return trimmed;
	const end = trimmed.indexOf(first, 1);
	return end < 0 ? undefined : trimmed.slice(1, end);
}

/**
 * Map a slash command (+ optional args) to a client-side action. Every action
 * above `// Serverwork` either calls a bridge endpoint directly or opens a
 * settings surface — nothing returns null for a canonical builtin.
 */
export function resolveLocalSlashAction(command: string, args = ""): LocalSlashAction | null {
	const canonical = resolveSlashCommandAlias(command);
	const trimmedArgs = args.trim();
	switch (canonical) {
		// --- Local-UI rewrites (no backend call) ---------------------------
		case "model": {
			// Strip optional `:thinking` suffix from Pi-style args.
			const modelKey = trimmedArgs ? trimmedArgs.replace(/:[\w.-]+$/, "") : undefined;
			return { type: "open-model-picker", modelKey };
		}
		case "effort": {
			if (!trimmedArgs) return { type: "open-effort-picker" };
			const level = parseThinkingLevelArg(trimmedArgs);
			if (level) return { type: "set-thinking-level", level };
			return { type: "open-effort-picker", unknownLevel: trimmedArgs };
		}
		case "models":
		case "scoped-models":
			return { type: "open-settings", tab: "llm-models" };
		case "settings":
			return { type: "open-settings", tab: "appearance" };
		case "config":
			return { type: "open-settings", tab: "pi-harness" };
		case "new":
			return { type: "new-session" };
		case "login":
			return { type: "open-providers" };
		case "logout":
			return { type: "open-logout" };
		// --- Bridge actions (call into prime-agent, render result) ---------
		case "session":
			return { type: "session-info" };
		case "name":
			return { type: "session-rename", name: trimmedArgs || undefined };
		case "context":
			return { type: "session-context" };
		case "system-prompt":
			return { type: "session-system-prompt" };
		case "logs":
			return { type: "session-logs" };
		case "export":
			return {
				type: "session-export",
				outputPath: parseQuotedPathArgument(trimmedArgs),
			};
		case "fork":
			return { type: "session-fork", args: trimmedArgs };
		case "clone":
			return { type: "session-clone" };
		case "tree":
			return { type: "session-tree", args: trimmedArgs };
		case "share":
			return { type: "session-share" };
		case "import":
			return {
				type: "session-import",
				path: trimmedArgs ? (parseQuotedPathArgument(trimmedArgs) ?? trimmedArgs) : "",
			};
		case "btw":
			return { type: "session-btw", question: trimmedArgs };
		case "fast":
			return { type: "fast-toggle" };
		case "reload":
			return { type: "reload-resources" };
		case "mcp":
			return { type: "open-mcp", args: trimmedArgs };
		case "rlm-max-depth":
			return { type: "rlm-max-depth", args: trimmedArgs };
		case "heartbeat":
			return { type: "heartbeat-manage", args: trimmedArgs };
		case "heartbeats":
			return { type: "heartbeat-list" };
		case "traces":
			return { type: "session-traces" };
		case "agents":
			return { type: "session-agents" };
		case "compact":
		case "refine":
		case "goal":
		case "autonomous":
			return {
				type: "echo",
				text: trimmedArgs
					? `/${canonical} is not wired in the web port. Arguments were not applied:\n${trimmedArgs}`
					: `/${canonical} is not wired in the web port.`,
			};
		// --- TUI-only; show explicit "not available in web" toast -----------
		case "changelog":
			return { type: "show-changelog" };
		case "hotkeys":
			return { type: "show-hotkeys" };
		case "copy":
			return { type: "copy-last-reply" };
		case "update":
			return { type: "update-check", args: trimmedArgs };
		case "fullscreen":
			return { type: "toggle-fullscreen" };
		case "quit":
			return { type: "quit-app" };
		default:
			return null;
	}
}

export type SlashCommandSuggestion = {
	id: string;
	label: string;
	value: string;
	description?: string;
};

function normalizeSlashCommandName(name: string) {
	const normalized = name.trim().replace(/\s+/g, "-");
	return /^[\w.-]+$/.test(normalized) ? normalized : "";
}

function toSlashSuggestion(command: {
	name: string;
	description?: string;
	argumentHint?: string;
}): SlashCommandSuggestion {
	return {
		id: command.name,
		label: `/${command.name}`,
		value: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""} `,
		description: command.description,
	};
}

/**
 * Merge client dispatcher builtins with the API catalog and optional
 * skill/prompt commands. API results must not replace builtins — the server
 * catalog is a short session-command subset.
 */
export function buildSlashCommands(
	resources: ChatResourcesResponse | null,
	enabled: boolean,
	commandsData?: {
		commands: Array<{
			name: string;
			description?: string;
			argumentHint?: string;
		}>;
	},
): Array<SlashCommandSuggestion> {
	const byId = new Map<string, SlashCommandSuggestion>();
	for (const command of WEB_BUILTIN_SLASH_COMMANDS) {
		byId.set(command.name, toSlashSuggestion(command));
	}
	for (const command of commandsData?.commands ?? []) {
		if (!byId.has(command.name)) byId.set(command.name, toSlashSuggestion(command));
	}

	if (!enabled || !resources) return Array.from(byId.values());

	for (const resource of [...resources.skills, ...resources.prompts]) {
		if (resource.activationStatus && resource.activationStatus !== "active") continue;
		const commandName = normalizeSlashCommandName(resource.name);
		if (!commandName || byId.has(commandName)) continue;
		byId.set(commandName, {
			id: commandName,
			label: `/${commandName}`,
			value: `/${commandName} `,
			description: resource.description,
		});
	}

	return Array.from(byId.values());
}
