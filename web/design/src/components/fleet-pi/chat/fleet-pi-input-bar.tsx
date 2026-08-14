import { Bot, ListTodo, Settings2 } from "lucide-react"
import { useCallback, useState } from "react"
import { InputBar } from "../../agent-elements/input-bar"
import { EffortPicker } from "../../agent-elements/input/effort-picker"
import { ModelPicker } from "../../agent-elements/input/model-picker"
import { ModeSelector } from "../../agent-elements/input/mode-selector"
import { ComposerLoader } from "../../agent-elements/composer-loader"
import { SUGGESTION_ITEM_CLASS, SUGGESTION_LIST_CLASS } from "../styles/tokens"
import { ChatStopControl } from "./chat-stop-control"
import type { InputBarProps } from "../../agent-elements/input-bar"
import type { SuggestionItem } from "../../agent-elements/input/suggestions"
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { ChatMode, ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol"
import {
  availableThinkingLevels,
  type ChatModelOption,
} from "../../../lib/pi/chat-helpers"

export const FLEET_PI_SUGGESTION_ITEM_CLASSNAME = SUGGESTION_ITEM_CLASS
const FLEET_PI_SUGGESTION_CLASSNAME = SUGGESTION_LIST_CLASS

export function withFleetPiSuggestionStyles(
  suggestions: InputBarProps["suggestions"]
): InputBarProps["suggestions"] {
  if (!suggestions) return suggestions

  if (Array.isArray(suggestions)) {
    return {
      items: suggestions,
      className: FLEET_PI_SUGGESTION_CLASSNAME,
      itemClassName: FLEET_PI_SUGGESTION_ITEM_CLASSNAME,
    }
  }

  return {
    ...suggestions,
    className: suggestions.className ?? FLEET_PI_SUGGESTION_CLASSNAME,
    itemClassName:
      suggestions.itemClassName ?? FLEET_PI_SUGGESTION_ITEM_CLASSNAME,
  }
}

export const FLEET_PI_CHAT_MODES = [
  {
    id: "agent",
    label: "Agent",
    icon: Bot,
    description: "Default coding agent",
  },
  {
    id: "plan",
    label: "Plan",
    icon: ListTodo,
    description: "Plan before executing",
  },
  {
    id: "harness",
    label: "Harness",
    icon: Settings2,
    description: "Harness-aware turn",
  },
] as const

export type FleetPiInputBarProps = Omit<
  InputBarProps,
  "leftActions" | "rightActions" | "status"
> & {
  modelKey: string | undefined
  models: Array<ChatModelOption>
  status: ChatStatus
  infoDescription?: string | null
  chatMode?: ChatMode
  onChatModeChange?: (mode: ChatMode) => void
  onModelChange: (modelKey: string) => void
  thinkingLevel?: ChatThinkingLevel
  onThinkingLevelChange?: (level: ChatThinkingLevel) => void
  /**
   * When a slash suggestion is selected, return true to consume it
   * (clears the input instead of inserting the command text).
   */
  onSlashCommandSelect?: (item: SuggestionItem) => boolean | void
  /**
   * When the user sends a message that is a local UI slash command,
   * return true to skip prompting the agent.
   */
  onLocalSlashSubmit?: (message: string) => boolean
  /** Imperatively open the model picker (e.g. from `/model`). */
  modelPickerOpen?: boolean
  onModelPickerOpenChange?: (open: boolean) => void
  /** Imperatively open the effort picker (e.g. from `/effort`). */
  effortPickerOpen?: boolean
  onEffortPickerOpenChange?: (open: boolean) => void
}

export function FleetPiInputBar({
  modelKey,
  models,
  status,
  infoDescription,
  suggestions,
  chatMode = "agent",
  onChatModeChange,
  onModelChange,
  thinkingLevel,
  onThinkingLevelChange,
  onStop,
  onSend,
  onSlashCommandSelect,
  onLocalSlashSubmit,
  modelPickerOpen,
  onModelPickerOpenChange,
  effortPickerOpen,
  onEffortPickerOpenChange,
  ...inputBarProps
}: FleetPiInputBarProps) {
  const displayStatus = status === "streaming" ? "ready" : status
  const [uncontrolledModelPickerOpen, setUncontrolledModelPickerOpen] =
    useState(false)
  const isModelPickerControlled = modelPickerOpen !== undefined
  const resolvedModelPickerOpen = isModelPickerControlled
    ? modelPickerOpen
    : uncontrolledModelPickerOpen
  const [uncontrolledEffortPickerOpen, setUncontrolledEffortPickerOpen] =
    useState(false)
  const isEffortPickerControlled = effortPickerOpen !== undefined
  const resolvedEffortPickerOpen = isEffortPickerControlled
    ? effortPickerOpen
    : uncontrolledEffortPickerOpen
  const selectedModel = models.find((model) => model.id === modelKey)

  const handleModelPickerOpenChange = useCallback(
    (open: boolean) => {
      if (!isModelPickerControlled) setUncontrolledModelPickerOpen(open)
      onModelPickerOpenChange?.(open)
    },
    [isModelPickerControlled, onModelPickerOpenChange]
  )

  const handleEffortPickerOpenChange = useCallback(
    (open: boolean) => {
      if (!isEffortPickerControlled) setUncontrolledEffortPickerOpen(open)
      onEffortPickerOpenChange?.(open)
    },
    [isEffortPickerControlled, onEffortPickerOpenChange]
  )

  const handleSend = useCallback(
    (message: {
      role: "user"
      content: string
      /** Mirror of React.KeyboardEvent 'altKey' at send time. */
      altKey?: boolean
    }) => {
      if (onLocalSlashSubmit?.(message.content) === true) return
      onSend(message)
    },
    [onLocalSlashSubmit, onSend]
  )

  return (
    <div className="flex flex-col">
      <ComposerLoader
        label={infoDescription ?? undefined}
        isActive={status === "streaming" || status === "submitted"}
      />
      <InputBar
        {...inputBarProps}
        status={displayStatus}
        onSend={handleSend}
        onStop={onStop}
        onSlashCommandSelect={onSlashCommandSelect}
        suggestions={suggestions}
        leftActions={
          <>
            <ModeSelector
              modes={[...FLEET_PI_CHAT_MODES]}
              value={chatMode}
              onChange={(id) => onChatModeChange?.(id as ChatMode)}
            />
            <ModelPicker
              models={models}
              value={modelKey}
              onChange={onModelChange}
              open={resolvedModelPickerOpen}
              onOpenChange={handleModelPickerOpenChange}
              placeholder="Model"
            />
            <EffortPicker
              levels={availableThinkingLevels(selectedModel)}
              value={thinkingLevel}
              onChange={onThinkingLevelChange}
              open={resolvedEffortPickerOpen}
              onOpenChange={handleEffortPickerOpenChange}
            />
          </>
        }
        rightActions={
          <ChatStopControl status={status} onStop={onStop} />
        }
      />
    </div>
  )
}
