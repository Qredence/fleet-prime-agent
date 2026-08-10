import type {
  ChatResourcesResponse,
  ChatSlashCommandInfo,
} from "@prime-agent/web-protocol/chat-protocol"

/**
 * Fleet Pi UI builtins for the InputBar slash menu.
 * Selecting or submitting these runs a local UI action (model picker,
 * Settings tab, new session) instead of prompting the agent.
 * Package/OAuth/compact/reload backends are intentionally not shipped yet.
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
    name: "models",
    description: "Open LLM Models settings",
    source: "builtin",
  },
  {
    name: "scoped-models",
    description: "Open LLM Models settings",
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
  {
    name: "config",
    description: "Open Pi Harness settings",
    source: "builtin",
  },
]

export type SettingsSlashTab =
  | "appearance"
  | "sandbox"
  | "providers"
  | "llm-models"
  | "skills"
  | "pi-harness"

export type LocalSlashAction =
  | { type: "open-model-picker"; modelKey?: string }
  | { type: "open-settings"; tab: SettingsSlashTab }
  | { type: "new-session" }
  | { type: "show-session" }

/**
 * Map a slash command (+ optional args) to a client-only UI action.
 * Returns null for resource/skill commands that should reach the agent.
 */
export function resolveLocalSlashAction(
  command: string,
  args = ""
): LocalSlashAction | null {
  const trimmedArgs = args.trim()
  switch (command) {
    case "model": {
      // Strip optional `:thinking` suffix from Pi-style args.
      const modelKey = trimmedArgs
        ? trimmedArgs.replace(/:[\w.-]+$/, "")
        : undefined
      return { type: "open-model-picker", modelKey }
    }
    case "effort":
      // TUI parity: /effort opens the same model settings surface where the
      // thinking-level drop-down lives (the model picker doesn't currently
      // expose per-provider thinking levels on the wire).
      return { type: "open-settings", tab: "llm-models" }
    case "models":
    case "scoped-models":
      return { type: "open-settings", tab: "llm-models" }
    case "settings":
      return { type: "open-settings", tab: "appearance" }
    case "config":
      return { type: "open-settings", tab: "pi-harness" }
    case "new":
      return { type: "new-session" }
    case "session":
      return { type: "show-session" }
    default:
      return null
  }
}

const WEB_BUILTIN_COMMAND_NAMES = new Set(
  WEB_BUILTIN_SLASH_COMMANDS.map((command) => command.name)
)

export function isWebBuiltinSlashCommand(commandName: string) {
  return WEB_BUILTIN_COMMAND_NAMES.has(commandName)
}

export function parseSlashInput(message: string) {
  const match = message.trim().match(/^\/(\S+)(?:\s+(.*))?$/)
  if (!match) return null
  const [, command = "", rawArgs = ""] = match
  return {
    command,
    args: rawArgs.trim(),
  }
}

export type SlashCommandSuggestion = {
  id: string
  label: string
  value: string
  description?: string
}

function normalizeSlashCommandName(name: string) {
  const normalized = name.trim().replace(/\s+/g, "-")
  return /^[\w.-]+$/.test(normalized) ? normalized : ""
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
      name: string
      description?: string
      argumentHint?: string
    }>
  }
): Array<SlashCommandSuggestion> {
  if (commandsData && commandsData.commands.length > 0) {
    return commandsData.commands.map((command) => ({
      id: command.name,
      label: `/${command.name}`,
      value: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""} `,
      description: command.description,
    }))
  }

  const builtins = WEB_BUILTIN_SLASH_COMMANDS.map((command) => ({
    id: command.name,
    label: `/${command.name}`,
    value: `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ""} `,
    description: command.description,
  }))

  if (!enabled || !resources) return builtins

  const resourceCommands = [...resources.skills, ...resources.prompts]
    .filter(
      (resource) =>
        !resource.activationStatus || resource.activationStatus === "active"
    )
    .map((resource) => {
      const commandName = normalizeSlashCommandName(resource.name)
      if (!commandName) return null
      return {
        id: commandName,
        label: `/${commandName}`,
        value: `/${commandName} `,
        description: resource.description,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return Array.from(
    new Map(
      [...builtins, ...resourceCommands].map((item) => [item.id, item])
    ).values()
  )
}
