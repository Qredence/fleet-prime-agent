import { createFileRoute } from "@tanstack/react-router"
import { wrapApiHandler } from "@/lib/api-utils"
import { getPrimeConfig } from "@/server/prime-config"

// Slash commands the web port can actually honor. The TUI's full builtin list
// (~35 entries) lives in `packages/coding-agent/src/core/slash-commands.ts`,
// but most of them (`/fork`, `/export`, `/mcp`, `/copy`, `/login`, `/reload`,
// `/update`, `/hotkeys`, `/quit`, ...) are wired only into the TUI's UI
// context — there is no server-side runner for them in this web port. Showing
// them in autocomplete would let the user submit them and have them go to the
// LLM as plain prompt text (bug review H2), so we whitelist just the commands
// this port routes locally or through `parseSessionCommands`:
//   - Local-UI: handled by `resolveLocalSlashAction` in `apps/web/src/lib/pi/slash-commands.ts`
//   - Session:  forwarded via `session.prompt({ parseSessionCommands: true })`.
// When you add a server-side runner for a builtin (e.g. `/export`), add it here.
const BUILTIN_SLASH_COMMANDS: ReadonlyArray<{
	name: string
	description: string
	argumentHint?: string
}> = [
	// Local-UI (client-side rewrites; composer never prompts the agent).
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "[search]" },
	{ name: "effort", description: "Select reasoning/thinking level (opens selector UI)", argumentHint: "[level]" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "session", description: "Show session info" },
	{ name: "new", description: "Start a new session, optionally named and/or with an initial prompt", argumentHint: '[--name "session name" --] [prompt]' },
	// Session commands forwarded via parseSessionCommands inside session.prompt().
	{ name: "compact", description: "Compact the session context; optional instructions focus the summary", argumentHint: "[instructions]" },
	{ name: "refine", description: "Refine continual harness prompt notes, skills, subagents, and memory" },
	{ name: "goal", description: "Set or view a persistent goal; supports pause, resume, and clear", argumentHint: "[objective]" },
	{ name: "autonomous", description: "Set or view autonomous mode", argumentHint: "[status|on|off]" },
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
