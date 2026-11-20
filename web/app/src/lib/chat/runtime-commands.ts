import type { ChatCommandsResponse } from "@prime-agent/web-protocol/chat-protocol";

/** Commands the terminal client owns. The web menu does not offer them. */
export const TUI_ONLY_COMMANDS = new Set(["fullscreen", "quit", "traces", "update"]);

/** Commands the browser applies itself because they open product UI. */
const LOCAL_UI_COMMANDS = new Set(["clear", "effort", "model", "new", "settings", "thinking"]);

const SESSION_TRANSPORT_COMMANDS = new Set(["autonomous", "compact", "goal", "refine"]);

const ALIASES: Record<string, string> = {
	clear: "new",
	rename: "name",
	side: "btw",
	thinking: "effort",
	usage: "context",
};

export type RuntimeCommandSuggestion = {
	id: string;
	label: string;
	value: string;
	description?: string;
	category?: "builtin" | "extension" | "prompt" | "skill";
	metadata?: Record<string, string | undefined>;
};

export function parseSlashInput(message: string): { command: string; args: string } | null {
	const match = message.trim().match(/^\/(\S+)(?:\s+(.*))?$/);
	if (!match) return null;
	const [, command = "", rawArgs = ""] = match;
	return { command, args: rawArgs.trim() };
}

export function canonicalCommandName(command: string): string {
	return ALIASES[command] ?? command;
}

export function isLocalUiCommand(command: string): boolean {
	return LOCAL_UI_COMMANDS.has(command) || LOCAL_UI_COMMANDS.has(canonicalCommandName(command));
}

/** Session commands the daemon executes when the text is sent as a turn. */
export function isSessionTransportCommand(command: string): boolean {
	return SESSION_TRANSPORT_COMMANDS.has(canonicalCommandName(command));
}

const LOCAL_UI_LIST = [
	{ name: "new", description: "Start a new session" },
	{ name: "model", description: "Choose a model" },
	{ name: "effort", description: "Choose a thinking level" },
	{ name: "settings", description: "Open settings" },
];

export function commandSuggestions(response: ChatCommandsResponse | undefined): Array<RuntimeCommandSuggestion> {
	const suggestions: Array<RuntimeCommandSuggestion> = [];
	const seen = new Set<string>();
	const listed: Array<{
		name: string;
		description?: string;
		argumentHint?: string;
		source?: RuntimeCommandSuggestion["category"];
	}> = [...LOCAL_UI_LIST, ...(response?.commands ?? [])];
	for (const command of listed) {
		if (seen.has(command.name)) continue;
		seen.add(command.name);
		if (TUI_ONLY_COMMANDS.has(command.name)) continue;
		const hint = command.argumentHint?.trim();
		suggestions.push({
			id: command.name,
			label: `/${command.name}`,
			value: hint ? `/${command.name} ` : `/${command.name}`,
			description: command.description,
			category: command.source,
			...(hint ? { metadata: { argumentHint: hint } } : {}),
		});
	}
	return suggestions;
}

export function commandInsertsPrefix(item: { metadata?: Record<string, string | undefined>; value?: string }): boolean {
	return Boolean(item.metadata?.argumentHint) || item.value?.endsWith(" ") === true;
}
