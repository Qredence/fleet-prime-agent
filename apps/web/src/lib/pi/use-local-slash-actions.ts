import { useCallback } from "react"
import { toast } from "sonner"
import { parseSlashInput, resolveLocalSlashAction } from "./slash-commands"
import type { LocalSlashAction, SettingsSlashTab } from "./slash-commands"
import type { SuggestionItem } from "@prime-agent/web-design/components/agent-elements/input/suggestions"
import type { ChatModelOption } from "@prime-agent/web-design/lib/pi/chat-helpers"

type UseLocalSlashActionsArgs = {
  models: Array<ChatModelOption>
  openSettings: (tab?: SettingsSlashTab) => void
  sessionId: string | undefined
  sessionFile: string | null | undefined
  setModelKey: (key: string | undefined) => void
  setModelPickerOpen: (open: boolean) => void
  startNewSession: () => void
}

export function useLocalSlashActions({
  models,
  openSettings,
  sessionId,
  sessionFile,
  setModelKey,
  setModelPickerOpen,
  startNewSession,
}: UseLocalSlashActionsArgs) {
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
        case "show-session": {
          const currentSessionId = sessionId ?? "none"
          const currentSessionFile = sessionFile ?? "none"
          toast.message("Current session", {
            description: `${currentSessionId}\n${currentSessionFile}`,
          })
          return true
        }
        default: {
          const exhaustiveCheck: never = action
          void exhaustiveCheck
          return false
        }
      }
    },
    [
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
