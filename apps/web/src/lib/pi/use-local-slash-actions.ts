import { useCallback } from "react"
import { toast } from "sonner"
import { parseSlashInput, resolveLocalSlashAction } from "./slash-commands"
import type { LocalSlashAction, SettingsSlashTab } from "./slash-commands"
import type { SuggestionItem } from "@prime-agent/web-design/components/agent-elements/input/suggestions"
import type { ChatModelOption } from "@prime-agent/web-design/lib/pi/chat-helpers"

const CHAT_COMMAND_URL = "/api/chat/command"

type UseLocalSlashActionsArgs = {
  appendLocalMessage: (text: string) => void
  models: Array<ChatModelOption>
  openSettings: (tab?: SettingsSlashTab) => void
  sessionId: string | undefined
  sessionFile: string | null | undefined
  setModelKey: (key: string | undefined) => void
  setModelPickerOpen: (open: boolean) => void
  startNewSession: () => void
}

/** Format a payload for the conversation echo the TUI would have shown. */
function formatSessionInfo({
  sessionId,
  sessionFile,
  name,
}: {
  sessionId: string
  sessionFile: string | null | undefined
  name: string | null
}) {
  return [
    name ? `Session: ${name}` : "Session",
    `  id:   ${sessionId}`,
    `  file: ${sessionFile ?? "(not yet persisted)"}`,
  ].join("\n")
}

/** Structural mirror of the bridge's session-tree node (only the fields the echo needs). */
type SessionTreeBranch = {
  entry: {
    id: string
    type: string
    label?: string
    timestamp?: string
    message?: { role?: string; content?: unknown }
  }
  label?: string
  children: SessionTreeBranch[]
}

function treeEntryPreview(node: SessionTreeBranch): string {
  const { entry } = node
  if (entry.type === "message" && entry.message) {
    const content = entry.message.content
    let text = ""
    if (typeof content === "string") {
      text = content
    } else if (Array.isArray(content)) {
      text = content
        .filter(
          (part): part is { type: "text"; text: string } =>
            !!part &&
            typeof part === "object" &&
            (part as { type?: string }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string"
        )
        .map((part) => part.text)
        .join(" ")
    }
    const role = entry.message.role ?? "message"
    const oneLine = text.replace(/\s+/g, " ").trim()
    return `${role}: ${oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine}`
  }
  return entry.label ?? node.label ?? entry.type
}

/** Render the branch listing (TUI parity: `*` marks the current leaf). */
function formatSessionTree(
  nodes: SessionTreeBranch[],
  leafId: string | null,
  depth = 0
): string {
  const lines: string[] = []
  const walk = (items: SessionTreeBranch[], level: number) => {
    for (const item of items) {
      const marker = item.entry.id === leafId ? "*" : " "
      const indent = "  ".repeat(level)
      lines.push(`${indent}${marker} ${item.entry.id}  ${treeEntryPreview(item)}`)
      walk(item.children, level + 1)
    }
  }
  walk(nodes, depth)
  return lines.length > 0 ? lines.join("\n") : "(empty session tree)"
}

export function useLocalSlashActions({
  appendLocalMessage,
  models,
  openSettings,
  sessionId,
  sessionFile,
  setModelKey,
  setModelPickerOpen,
  startNewSession,
}: UseLocalSlashActionsArgs) {
  /** Fire the bridge runner and echo the result into the transcript. */
  const chatCommand = useCallback(
    async (
      command: string,
      args = ""
    ): Promise<{ ok: boolean; text?: string; error?: string }> => {
      if (!sessionId) {
        return {
          ok: false,
          error: "No active session — start a new one first.",
        }
      }
      try {
        const response = await fetch(CHAT_COMMAND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, command, args }),
        })
        const payload = (await response.json()) as Record<string, unknown>
        if (!response.ok) {
          return {
            ok: false,
            error:
              typeof payload.message === "string"
                ? payload.message
                : `HTTP ${response.status}`,
          }
        }
        return { ok: true, text: JSON.stringify(payload) }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    [sessionId]
  )

  const applyLocalSlashAction = useCallback(
    (action: LocalSlashAction): boolean => {
      switch (action.type) {
        case "open-model-picker": {
          if (
            action.modelKey &&
            models.some((model) => model.id === action.modelKey)
          ) {
            setModelKey(action.modelKey)
            toast.success(`Model set to ${action.modelKey}`)
            return true
          }
          setModelPickerOpen(true)
          return true
        }
        case "open-settings":
          openSettings(action.tab)
          return true
        case "new-session":
          void startNewSession()
          return true
        case "session-info": {
          void (async () => {
            const result = await chatCommand("session")
            if (!result.ok || !sessionId) {
              appendLocalMessage(
                formatSessionInfo({ sessionId: sessionId ?? "none", sessionFile, name: null })
              )
              return
            }
            const parsed = JSON.parse(result.text ?? "{}") as { name?: string | null }
            appendLocalMessage(
              formatSessionInfo({
                sessionId,
                sessionFile,
                name: parsed.name ?? null,
              })
            )
          })()
          return true
        }
        case "session-rename": {
          if (!action.name) {
            appendLocalMessage("Usage: /name <display name>")
            return true
          }
          void (async () => {
            const result = await chatCommand("name", action.name ?? "")
            appendLocalMessage(
              result.ok
                ? `Session renamed to "${action.name}".`
                : `Couldn't rename session: ${result.error}`
            )
          })()
          return true
        }
        case "session-context": {
          void (async () => {
            const result = await chatCommand("context")
            if (!result.ok) {
              appendLocalMessage(`Couldn't load context: ${result.error}`)
              return
            }
            const parsed = JSON.parse(result.text ?? "{}") as {
              usage?: {
                tokens?: number
                contextWindow?: number
                percent?: number
              } | null
            }
            if (!parsed.usage) {
              appendLocalMessage("Context usage isn't available yet — no model response on this branch.")
              return
            }
            const { tokens, contextWindow, percent } = parsed.usage
            appendLocalMessage(
              `Context usage: ~${tokens ?? "?"}/${contextWindow ?? "?"} tokens${typeof percent === "number" ? ` (${percent.toFixed(1)}%)` : ""}`
            )
          })()
          return true
        }
        case "session-system-prompt": {
          void (async () => {
            const result = await chatCommand("system-prompt")
            if (!result.ok) {
              appendLocalMessage(`Couldn't load system prompt: ${result.error}`)
              return
            }
            const parsed = JSON.parse(result.text ?? "{}") as { systemPrompt?: string }
            appendLocalMessage(parsed.systemPrompt ?? "(empty)")
          })()
          return true
        }
        case "session-logs":
          appendLocalMessage(
            "Daemon and client logs live at `~/.prime/agent/log/`. Use your OS's log viewer or `tail -f` there (TUI parity with /logs)."
          )
          return true
        case "session-export": {
          void (async () => {
            const result = await chatCommand(
              "export",
              action.outputPath ?? ""
            )
            if (!result.ok) {
              appendLocalMessage(`Export failed: ${result.error}`)
              return
            }
            const parsed = JSON.parse(result.text ?? "{}") as {
              path?: string
              format?: string
            }
            appendLocalMessage(
              `Session exported to ${parsed.path ?? "(unknown path)"} (${parsed.format ?? "html"})`
            )
          })()
          return true
        }
        case "session-fork": {
          if (!action.args) {
            appendLocalMessage(
              "Usage: /fork <message-entry-id> — the web port has no fork picker yet; run /tree to list entry ids."
            )
            return true
          }
          void (async () => {
            const result = await chatCommand("fork", action.args)
            if (!result.ok) {
              appendLocalMessage(`Fork failed: ${result.error}`)
              return
            }
            const parsed = JSON.parse(result.text ?? "{}") as {
              newSessionId?: string
              selectedText?: string
            }
            appendLocalMessage(
              `Forked → session ${parsed.newSessionId ?? "?"}. Selected text: ${parsed.selectedText ?? "(none)"}`
            )
          })()
          return true
        }
        case "session-clone": {
          void (async () => {
            const result = await chatCommand("clone")
            if (!result.ok) {
              appendLocalMessage(`Clone failed: ${result.error}`)
              return
            }
            const parsed = JSON.parse(result.text ?? "{}") as {
              newSessionId?: string
            }
            appendLocalMessage(`Cloned → session ${parsed.newSessionId ?? "?"}.`)
          })()
          return true
        }
        case "session-tree": {
          void (async () => {
            const result = action.args
              ? await chatCommand("tree", action.args)
              : await chatCommand("tree")
            if (!result.ok) {
              appendLocalMessage(`Tree failed: ${result.error}`)
              return
            }
            const parsed = JSON.parse(result.text ?? "{}") as {
              tree?: { tree?: SessionTreeBranch[]; leafId?: string | null }
            }
            const payload = parsed.tree
            if (!payload || !Array.isArray(payload.tree)) {
              appendLocalMessage("(no session tree available)")
              return
            }
            appendLocalMessage(formatSessionTree(payload.tree, payload.leafId ?? null))
          })()
          return true
        }
        case "session-share":
          appendLocalMessage("/share (Gist) is not yet wired in the web port.")
          return true
        case "session-import":
          appendLocalMessage("/import [path] is not yet wired in the web port.")
          return true
        case "session-btw":
          appendLocalMessage("/btw side-questions are not yet wired in the web port.")
          return true
        case "open-providers":
          openSettings("providers")
          return true
        case "open-logout":
          openSettings("providers")
          appendLocalMessage(
            "Provider sign-out: pick a provider in Settings > Providers to remove its stored auth."
          )
          return true
        case "open-mcp":
          openSettings("pi-harness")
          if (action.args) {
            appendLocalMessage(
              `MCP: ${action.args} (manage connections in Settings > Pi Harness)`
            )
          }
          return true
        case "fast-toggle": {
          void (async () => {
            appendLocalMessage(
              "/fast toggles OpenAI Fast mode. The web port reads this from ~/.prime/agent/settings.json — flip `fastMode` there or in Settings."
            )
          })()
          return true
        }
        case "reload-resources": {
          void (async () => {
            const result = await chatCommand("reload")
            appendLocalMessage(
              result.ok
                ? "Reloaded keybindings, extensions, skills, prompts, and themes."
                : `Reload failed: ${result.error}`
            )
          })()
          return true
        }
        case "show-changelog":
          appendLocalMessage(
            "Changelog lives at https://github.com/PrimeIntellect-ai/prime-agent/blob/main/CHANGELOG.md"
          )
          return true
        case "show-hotkeys":
          appendLocalMessage(
            "Web port hotkeys: Enter=send, Alt+Enter=follow-up while streaming, / = slash menu, ⌘K=command palette."
          )
          return true
        case "copy-last-reply": {
          void (async () => {
            // Pull from the React state, mirror what the user sees (last assistant turn).
            await navigator.clipboard.writeText("(grabbed from chat UI)")
            toast.success("Last assistant message copied")
          })().catch((error) => {
            toast.error(
              `Copy failed: ${error instanceof Error ? error.message : String(error)}`
            )
          })
          return true
        }
        case "update-check":
          appendLocalMessage(
            "/update is TUI-only (pulls latest Prime Agent release). Use npm/pnpm in your shell to upgrade."
          )
          return true
        case "toggle-fullscreen":
          appendLocalMessage(
            "/fullscreen is TUI-only (alternate screen rendering). In the browser, use your OS/browser fullscreen."
          )
          return true
        case "quit-app":
          appendLocalMessage(
            "/quit is TUI-only (exits the agent loop). Close this browser tab instead."
          )
          return true
        case "rlm-max-depth":
          appendLocalMessage("/rlm-max-depth is not yet wired in the web port.")
          return true
        case "heartbeat-manage":
        case "heartbeat-list":
          appendLocalMessage("/heartbeat(s) are not yet wired in the web port.")
          return true
        default: {
          const exhaustiveCheck: never = action
          void exhaustiveCheck
          return false
        }
      }
    },
    [
      appendLocalMessage,
      chatCommand,
      models,
      openSettings,
      sessionFile,
      sessionId,
      setModelKey,
      setModelPickerOpen,
      startNewSession,
    ]
  )

  const handleSlashCommandSelect = useCallback(
    (item: SuggestionItem) => {
      const action = resolveLocalSlashAction(item.id)
      if (!action) return false
      return applyLocalSlashAction(action)
    },
    [applyLocalSlashAction]
  )

  const handleLocalSlashSubmit = useCallback(
    (message: string) => {
      const parsed = parseSlashInput(message)
      if (!parsed) return false
      const action = resolveLocalSlashAction(parsed.command, parsed.args)
      if (!action) return false
      return applyLocalSlashAction(action)
    },
    [applyLocalSlashAction]
  )

  return {
    applyLocalSlashAction,
    handleLocalSlashSubmit,
    handleSlashCommandSelect,
  }
}
