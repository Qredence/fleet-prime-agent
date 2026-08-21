import { Sparkles } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  useMentionMatches,
  useSlashMatches,
  type ComposerCommand,
  type ComposerPerson,
} from "../../elements/composer"
import type { ComposerTriggerGroup } from "../../elements/composer-trigger-popover"
import { useQuestionBarNavigation } from "../../agent-elements/hooks/use-question-bar-navigation"
import type { SuggestionItem } from "../../agent-elements/input/suggestions"
import type { WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract"
import {
  availableThinkingLevels,
  clampThinkingLevel,
  thinkingLevelLabel,
} from "../../../lib/pi/chat-helpers"
import {
  ProviderBrandIcon,
  formatProviderLabel,
} from "../pi/config-panel/shared/provider-brand-icon"
import type { FleetPiInputBarProps } from "./fleet-pi-input-bar"

type SuggestionConfig = NonNullable<FleetPiInputBarProps["slashCommands"]>
const EMPTY_WORKSPACE_REFERENCES: Array<WorkspaceAttachment> = []

function suggestionItems(config: SuggestionConfig | undefined) {
  if (!config) return []
  return Array.isArray(config) ? config : config.items
}

function slashCommandName(item: SuggestionItem) {
  return (item.value ?? item.id).trim().replace(/^\/+/, "").split(/\s+/, 1)[0] ?? item.id
}

function slashArgumentHint(item: SuggestionItem) {
  const value = item.value?.trim() ?? ""
  const match = value.match(/^\/\S+\s+(.+)$/)
  return match?.[1]
}

export function useFleetPiInputBarState({
  models,
  status,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
  onSend,
  onSlashCommandSelect,
  onLocalSlashSubmit,
  modelPickerOpen,
  onModelPickerOpenChange,
  effortPickerOpen,
  onEffortPickerOpenChange,
  workspaceReferences = EMPTY_WORKSPACE_REFERENCES,
  workspaceSuggestions,
  onWorkspaceReferenceSelect,
  onRemoveWorkspaceReference,
  controlled,
  disabled,
  questionBar,
  attachments,
  slashCommands,
}: Pick<
  FleetPiInputBarProps,
  | "models"
  | "status"
  | "thinkingLevel"
  | "onModelChange"
  | "onThinkingLevelChange"
  | "onSend"
  | "onSlashCommandSelect"
  | "onLocalSlashSubmit"
  | "modelPickerOpen"
  | "onModelPickerOpenChange"
  | "effortPickerOpen"
  | "onEffortPickerOpenChange"
  | "workspaceReferences"
  | "workspaceSuggestions"
  | "onWorkspaceReferenceSelect"
  | "onRemoveWorkspaceReference"
  | "controlled"
  | "disabled"
  | "questionBar"
  | "attachments"
  | "slashCommands"
>) {
  const [internalValue, setInternalValue] = useState("")
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(null)
  const value = controlled?.value ?? internalValue
  const setValue = controlled?.onChange ?? setInternalValue
  const isStreaming = status === "streaming" || status === "submitted"
  const navigation = useQuestionBarNavigation(questionBar)
  const commands = suggestionItems(slashCommands)
  const workspaceItems = suggestionItems(workspaceSuggestions)
  const slashElementCommands = useMemo<ComposerCommand[]>(
    () =>
      commands.map((item) => ({
        name: slashCommandName(item),
        description: [item.description, slashArgumentHint(item)].filter(Boolean).join(" "),
        icon: Sparkles,
      })),
    [commands],
  )
  const mentionElementPeople = useMemo<ComposerPerson[]>(
    () =>
      workspaceItems.map((item) => ({
        id: item.id,
        name: item.label,
        path: item.value ?? item.label,
        kind: item.metadata?.kind === "folder" ? "folder" : "file",
        description: item.description,
        role: "human",
      })),
    [workspaceItems],
  )
  const slashMatch = value.match(/^\/([^\s/]*)$/)
  const workspaceMentionMatch = value.match(/(?:^|\s)@([^\s@]*)$/)
  const slashQuery = slashMatch?.[1]?.toLowerCase()
  const workspaceQuery = workspaceMentionMatch?.[1]?.toLowerCase()
  const triggerKind: "slash" | "mention" | undefined =
    slashQuery !== undefined ? "slash" : workspaceQuery !== undefined ? "mention" : undefined
  const slashMatches = useSlashMatches(value, slashElementCommands)
  const mentionMatches = useMentionMatches(value, mentionElementPeople)
  const filteredCommands = useMemo(() => {
    const matchingNames = new Set(slashMatches.map((item) => item.name))
    return commands.filter((item) => matchingNames.has(slashCommandName(item)))
  }, [commands, slashMatches])
  const filteredWorkspaceItems = useMemo(() => {
    const matchingIds = new Set(
      mentionMatches.map((item) => item.id).filter((id): id is string => Boolean(id)),
    )
    return workspaceItems.filter((item) => matchingIds.has(item.id))
  }, [mentionMatches, workspaceItems])
  const triggerItems = triggerKind === "slash" ? filteredCommands : filteredWorkspaceItems
  const [activeTriggerIndex, setActiveTriggerIndex] = useState(0)

  useEffect(() => {
    setActiveTriggerIndex(0)
  }, [triggerKind, slashQuery, workspaceQuery, triggerItems.length])

  const send = useCallback(
    (content: string, altKey = false) => {
      if (onLocalSlashSubmit?.(content) === true) {
        setValue("")
        return
      }
      onSend({ role: "user", content, altKey })
      setValue("")
    },
    [onLocalSlashSubmit, onSend, setValue],
  )

  const selectCommand = useCallback(
    (item: SuggestionItem) => {
      if (onSlashCommandSelect?.(item) === true) {
        setValue("")
        return
      }
      setValue(item.value ?? item.label)
    },
    [onSlashCommandSelect, setValue],
  )

  const removeTriggerToken = useCallback(
    (match: RegExpMatchArray | null) => {
      if (!match) return value
      const leadingWhitespace = match[0].length - match[0].trimStart().length
      const tokenStart = value.length - match[0].length + leadingWhitespace
      return value.slice(0, tokenStart)
    },
    [value],
  )

  const selectWorkspaceReference = useCallback(
    (item: SuggestionItem) => {
      onWorkspaceReferenceSelect?.(item)
      setValue(removeTriggerToken(workspaceMentionMatch))
    },
    [onWorkspaceReferenceSelect, removeTriggerToken, setValue, workspaceMentionMatch],
  )

  const handlePromptKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const isSuggestionMenuOpen = !isStreaming && !disabled && triggerKind !== undefined

      if (event.key === "Backspace" && value.length === 0 && workspaceReferences.length > 0) {
        const lastReference = workspaceReferences[workspaceReferences.length - 1]
        if (lastReference) {
          event.preventDefault()
          onRemoveWorkspaceReference?.(lastReference.relativePath)
          return
        }
      }

      if (isSuggestionMenuOpen && event.key === "Escape") {
        event.preventDefault()
        setValue(triggerKind === "slash" ? removeTriggerToken(slashMatch) : removeTriggerToken(workspaceMentionMatch))
        return
      }

      if (isSuggestionMenuOpen && triggerItems.length > 0) {
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActiveTriggerIndex((index) => (index + 1) % triggerItems.length)
          return
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          setActiveTriggerIndex((index) => (index - 1 + triggerItems.length) % triggerItems.length)
          return
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault()
          const item = triggerItems[activeTriggerIndex]
          if (item) {
            if (triggerKind === "slash") selectCommand(item)
            else selectWorkspaceReference(item)
          }
          return
        }
      }

      if (event.key === "Enter" && event.altKey && !event.shiftKey) {
        event.preventDefault()
        const content = value.trim()
        if (content && !isStreaming && !disabled) send(content, true)
      }
    },
    [
      activeTriggerIndex,
      disabled,
      isStreaming,
      onRemoveWorkspaceReference,
      removeTriggerToken,
      selectCommand,
      selectWorkspaceReference,
      send,
      setValue,
      slashMatch,
      triggerItems,
      triggerKind,
      value,
      workspaceMentionMatch,
      workspaceReferences,
    ],
  )

  const showQuestion = questionBar && questionBar.id !== dismissedQuestionId
  const files = attachments?.files ?? []
  const images = attachments?.images ?? []
  const triggerOpen = Boolean(triggerKind && !isStreaming && !disabled)
  const commandGroups = useMemo<ComposerTriggerGroup[]>(() => {
    if (triggerKind !== "slash") return []
    const groups = new Map<string, SuggestionItem[]>()
    for (const item of filteredCommands) {
      const category = item.category ?? "builtin"
      const group = groups.get(category) ?? []
      group.push(item)
      groups.set(category, group)
    }
    const labels: Record<string, string> = {
      builtin: "Built-in",
      extension: "Extensions",
      prompt: "Prompts",
      skill: "Skills",
    }
    return [...groups.entries()].map(([id, group]) => ({
      id,
      label: labels[id] ?? id,
      items: group.map((item) => ({
        ...item,
        description: [item.description, slashArgumentHint(item)].filter(Boolean).join(" · "),
      })),
    }))
  }, [filteredCommands, triggerKind])
  const selectorModels = useMemo(
    () =>
      models.map((model) => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        providerLabel: formatProviderLabel(model.provider),
        modelId: model.modelId,
        icon: <ProviderBrandIcon provider={model.provider} className="size-4" />,
        disabled: model.available === false,
        reasoning: model.reasoning,
        keywords: [model.provider, model.modelId, model.id],
        efforts: availableThinkingLevels(model).map((level) => ({
          id: level,
          name: thinkingLevelLabel(level),
        })),
      })),
    [models],
  )
  const combinedPickerOpen = modelPickerOpen === true || effortPickerOpen === true
  const handleCombinedPickerOpenChange = useCallback(
    (open: boolean) => {
      onModelPickerOpenChange?.(open)
      onEffortPickerOpenChange?.(open)
    },
    [onEffortPickerOpenChange, onModelPickerOpenChange],
  )
  const handleSelectorModelChange = useCallback(
    (nextModelKey: string) => {
      const nextModel = models.find((model) => model.id === nextModelKey)
      onModelChange(nextModelKey)
      if (nextModel) {
        onThinkingLevelChange?.(
          clampThinkingLevel(thinkingLevel, availableThinkingLevels(nextModel)),
        )
      }
    },
    [models, onModelChange, onThinkingLevelChange, thinkingLevel],
  )

  return {
    activeTriggerIndex,
    combinedPickerOpen,
    commandGroups,
    files,
    handleCombinedPickerOpenChange,
    handlePromptKeyDown,
    handleSelectorModelChange,
    images,
    isStreaming,
    navigation,
    selectorModels,
    selectCommand,
    selectWorkspaceReference,
    removeTriggerToken,
    send,
    setActiveTriggerIndex,
    setDismissedQuestionId,
    setValue,
    showQuestion,
    triggerItems,
    triggerKind,
    triggerOpen,
    slashMatch,
    slashQuery,
    workspaceMentionMatch,
    workspaceQuery,
    filteredCommands,
    filteredWorkspaceItems,
    value,
  }
}
