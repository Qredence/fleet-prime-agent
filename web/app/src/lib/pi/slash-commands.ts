import type { ChatResourcesResponse, ChatSlashCommandInfo } from "@prime-agent/web-protocol/chat-protocol";

/**
 * Web port of prime-agent's builtin slash-command dispatcher
 * (`packages/coding-agent/src/core/slash-commands.ts` + the handler chain in
 * `packages/coding-agent/src/modes/interactive/interactive-mode.ts`). Every
 * canonical name (and the `clear`/`usage`/`thinking`/`rename`/`side` aliases)
 * resolves to a route HERE — autocomplete can freely advertise the full
 * surface because nothing falls through to the LLM.
 */
export const WEB_BUILTIN_SLASH_COMMANDS: Array<ChatSlashCommandInfo> = [
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
	{
		name: "settings",
		description: "Open Settings",
		source: "builtin",
	},
	{
		name: "new",
		description: "Start a new chat session",
		source: "builtin",
	},
	{
		name: "session",
		description: "Show current session metadata",
		source: "builtin",
	},
];

export type SettingsSlashTab = "appearance" | "sandbox" | "providers" | "llm-models" | "skills" | "pi-harness";

export type LocalSlashAction =
	| { type: "open-model-picker"; modelKey?: string }
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
	| { type: "toggle-fullscreen" } // /fullscreen — TUI only, toast
	| { type: "quit-app" }; // /quit — TUI only, toast

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
		case "effort":
			// TUI parity: /effort opens the same model settings surface where the
			// thinking-level drop-down lives (the model picker doesn't currently
			// expose per-provider thinking levels on the wire).
			return { type: "open-settings", tab: "llm-models" };
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
			return trimmedArgs
				? { type: "session-import", path: parseQuotedPathArgument(trimmedArgs) ?? trimmedArgs }
				: null;
		case "btw":
			return trimmedArgs ? { type: "session-btw", question: trimmedArgs } : null;
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

/**
 * Prefer API command catalog when present; otherwise fall back to builtins
 * (and optional skill/prompt slash commands when enabled).
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
	if (commandsData && commandsData.commands.length > 0) {
		return commandsData.commands.map((command) => ({
			id: command.name,
			label: `/${command.name}`,
			value: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""} `,
			description: command.description,
		}));
	}

	const builtins = WEB_BUILTIN_SLASH_COMMANDS.map((command) => ({
		id: command.name,
		label: `/${command.name}`,
		value: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""} `,
		description: command.description,
	}));

	if (!enabled || !resources) return builtins;

	const resourceCommands = [...resources.skills, ...resources.prompts].flatMap((resource) => {
		if (resource.activationStatus && resource.activationStatus !== "active") {
			return [];
		}
		const commandName = normalizeSlashCommandName(resource.name);
		if (!commandName) return [];
		return [
			{
				id: commandName,
				label: `/${commandName}`,
				value: `/${commandName} `,
				description: resource.description,
			},
		];
	});

	return Array.from(new Map([...builtins, ...resourceCommands].map((item) => [item.id, item])).values());
}
