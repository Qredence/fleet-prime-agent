import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"

// Mirroring prime-agent's `packages/coding-agent/src/core/slash-commands.ts` —
// `CANONICAL_BUILTIN_SLASH_COMMANDS` is the static catalog of CLI commands
// like `/model`, `/settings`, `/effort`, etc. The list lives only inside the
// interactive TUI's closure (not exported via the package's `index.ts`), so we
// inline it here. Drift risk is low: commands are user-visible API and
// prime-agent's CHANGELOG announces changes. Keep this list in sync when
// bumping prime-agent.
const BUILTIN_SLASH_COMMANDS: ReadonlyArray<{
	name: string
	description: string
	argumentHint?: string
}> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "[search]" },
	{ name: "effort", description: "Select reasoning/thinking level (opens selector UI)", argumentHint: "[level]" },
	{ name: "fast", description: "Toggle OpenAI Fast mode" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)", argumentHint: "[path]" },
	{ name: "import", description: "Import and resume a session from a JSONL file", argumentHint: "<path.jsonl>" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "btw", description: "Ask a side question without adding it to the session", argumentHint: "<question>" },
	{ name: "name", description: "Set or show the session display name", argumentHint: "[name]" },
	{ name: "session", description: "Show session info" },
	{ name: "system-prompt", description: "Show the exact system prompt sent to the model" },
	{ name: "logs", description: "Show where daemon and client logs are saved" },
	{ name: "traces", description: "Preview, upload, or configure Prime Agent traces", argumentHint: "[status|on|off|preview|upload|upload-current|upload-all|login]" },
	{ name: "context", description: "Show token, cost, and context usage for agent and sub-agents" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "update", description: "Update Prime Agent and installed packages", argumentHint: "[source|--self|--extensions]" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "login", description: "Configure provider authentication" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "mcp", description: "Open MCP Connections or manage MCP integrations", argumentHint: "[list|login <name>|logout <name>]" },
	{ name: "new", description: "Start a new session, optionally named and/or with an initial prompt", argumentHint: '[--name "session name" --] [prompt]' },
	{ name: "compact", description: "Compact the session context; optional instructions focus the summary", argumentHint: "[instructions]" },
	{ name: "refine", description: "Refine continual harness prompt notes, skills, subagents, and memory" },
	{ name: "goal", description: "Set or view a persistent goal; supports pause, resume, and clear", argumentHint: "[objective]" },
	{ name: "autonomous", description: "Set or view autonomous mode", argumentHint: "[status|on|off]" },
	{ name: "rlm-max-depth", description: "Set/view the per-chat persistent RLM max depth", argumentHint: "[<int> [--global]]" },
	{ name: "heartbeat", description: "Set or view a persistent heartbeat", argumentHint: "[status|pause|resume|stop|[every <duration>] [--steer|--follow-up] <instruction>]" },
	{ name: "heartbeats", description: "View and manage all user and agent heartbeats" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, and themes" },
	{ name: "fullscreen", description: "Toggle fullscreen (alternate screen) rendering with scrollable transcript", argumentHint: "[on|off]" },
	{ name: "quit", description: "Quit Prime Agent" },
]

// GET /api/chat/commands — enumerate slash commands the chat composer can
// offer in autocomplete. Combines:
//   1. The CLI's builtin list (`/model`, `/settings`, ...) with source="builtin"
//   2. Skills loaded by the resource loader as `/skill:<name>` "skill" entries
//   3. Prompt templates loaded by the resource loader as "prompt" entries
//   4. Extension commands registered in the last reload as "extension" entries
//
// The wire `ChatSlashCommandInfo.passThrough` flag is true for skill commands
// (the agent expands them inline rather than running them locally).

export const Route = createFileRoute("/api/chat/commands")({
	server: {
		handlers: {
			GET: async ({ request }) =>
				wrapApiHandler(async () => {
					const url = new URL(request.url)
					const cwd = url.searchParams.get("cwd") ?? getPrimeConfig().defaultCwd
					const config = getPrimeConfig()
					const loader = await config.resourceLoaderFor(cwd)

					const skillsResult = loader.getSkills()
					const promptsResult = loader.getPrompts()
					const extensionsResult = loader.getExtensions()
					const enableSkillCommands = config.settingsFor(cwd).getEnableSkillCommands()

					const builtin = BUILTIN_SLASH_COMMANDS.map((cmd) => ({
						name: cmd.name,
						description: cmd.description,
						argumentHint: cmd.argumentHint,
						source: "builtin" as const,
					}))

					const skillCommands = enableSkillCommands
						? skillsResult.skills.map((skill) => ({
								name: `skill:${skill.name}`,
								description: skill.description,
								source: "skill" as const,
								passThrough: true,
							}))
						: []

					const promptCommands = promptsResult.prompts.map((p) => ({
						name: p.name,
						description: p.description,
						argumentHint: p.argumentHint,
						source: "prompt" as const,
						passThrough: true,
					}))

					const extensionCommands = extensionsResult.extensions.flatMap((ext) =>
						Array.from(ext.commands.values()).map((cmd) => ({
							name: cmd.name,
							description: cmd.description,
							source: "extension" as const,
						})),
					)

					const diagnostics: string[] = [
						...skillsResult.diagnostics.map((d) => d.message),
						...promptsResult.diagnostics.map((d) => d.message),
						...extensionsResult.errors.map((e) => `${e.path}: ${e.error}`),
					]

					return Response.json({
						commands: [
							...builtin,
							...skillCommands,
							...promptCommands,
							...extensionCommands,
						],
						diagnostics,
					})
				}),
		},
	},
})
