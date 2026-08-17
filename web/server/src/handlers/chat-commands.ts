import { getPrimeConfig } from "../prime-config";
import { cwdForRequest } from "../project-request";
import { wrapApiHandler } from "../wrap-api-handler";

const BUILTIN_SLASH_COMMANDS: ReadonlyArray<{
	name: string;
	description: string;
	argumentHint?: string;
}> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "[search]" },
	{ name: "effort", description: "Select reasoning/thinking level (opens selector UI)", argumentHint: "[level]" },
	{ name: "fast", description: "Toggle OpenAI Fast mode" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{
		name: "export",
		description: "Export session (HTML default, or specify path: .html/.jsonl)",
		argumentHint: "[path]",
	},
	{ name: "import", description: "Import and resume a session from a JSONL file", argumentHint: "<path.jsonl>" },
	{ name: "share", description: "Copy the transcript (Gist upload is TUI-only)" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "btw", description: "Ask a side question without adding it to the session", argumentHint: "<question>" },
	{ name: "name", description: "Set or show the session display name", argumentHint: "[name]" },
	{ name: "session", description: "Show session info" },
	{ name: "system-prompt", description: "Show the exact system prompt sent to the model" },
	{ name: "logs", description: "Show where daemon and client logs are saved" },
	{ name: "traces", description: "Preview, upload, or configure Prime Agent traces" },
	{ name: "context", description: "Show token, cost, and context usage" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous user message", argumentHint: "[message-entry-id]" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "agents", description: "List saved sessions" },
	{ name: "login", description: "Configure provider authentication" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "mcp", description: "Open MCP Connections", argumentHint: "[list|login <name>|logout <name>]" },
	{
		name: "new",
		description: "Start a new session, optionally named and/or with an initial prompt",
		argumentHint: '[--name "session name" --] [prompt]',
	},
	{
		name: "compact",
		description: "Compact the session context; optional instructions focus the summary",
		argumentHint: "[instructions]",
	},
	{ name: "refine", description: "Refine continual harness prompt notes, skills, subagents, and memory" },
	{
		name: "goal",
		description: "Set or view a persistent goal; supports pause, resume, and clear",
		argumentHint: "[objective]",
	},
	{ name: "autonomous", description: "Set or view autonomous mode", argumentHint: "[status|on|off]" },
	{ name: "rlm-max-depth", description: "Set or view per-chat RLM max depth", argumentHint: "[<int> [--global]]" },
	{ name: "heartbeat", description: "Set or view a persistent heartbeat" },
	{ name: "heartbeats", description: "View and manage all user and agent heartbeats" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ name: "update", description: "Update Prime Agent (TUI-only)" },
	{ name: "fullscreen", description: "Toggle fullscreen (TUI-only)" },
	{ name: "quit", description: "Quit (TUI-only)" },
];

export function handleChatCommandsGet(request: Request): Promise<Response> {
	return wrapApiHandler(async () => {
		const cwd = await cwdForRequest(request);
		const config = getPrimeConfig();
		const loader = await config.resourceLoaderFor(cwd);

		const skillsResult = loader.getSkills();
		const promptsResult = loader.getPrompts();
		const extensionsResult = loader.getExtensions();
		const enableSkillCommands = config.settingsFor(cwd).getEnableSkillCommands();

		const builtin = BUILTIN_SLASH_COMMANDS.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
			argumentHint: cmd.argumentHint,
			source: "builtin" as const,
		}));

		const skillCommands = enableSkillCommands
			? skillsResult.skills.map((skill) => ({
					name: `skill:${skill.name}`,
					description: skill.description,
					source: "skill" as const,
					passThrough: true,
				}))
			: [];

		const promptCommands = promptsResult.prompts.map((p) => ({
			name: p.name,
			description: p.description,
			argumentHint: p.argumentHint,
			source: "prompt" as const,
			passThrough: true,
		}));

		const extensionCommands = extensionsResult.extensions.flatMap((ext) =>
			Array.from(ext.commands.values()).map((cmd) => ({
				name: cmd.name,
				description: cmd.description,
				source: "extension" as const,
			})),
		);

		const diagnostics: string[] = [
			...skillsResult.diagnostics.map((d) => d.message),
			...promptsResult.diagnostics.map((d) => d.message),
			...extensionsResult.errors.map((e) => `${e.path}: ${e.error}`),
		];

		return Response.json({
			commands: [...builtin, ...skillCommands, ...promptCommands, ...extensionCommands],
			diagnostics,
		});
	});
}
