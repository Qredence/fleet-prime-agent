import { Bot, FileCode2, FilePlus2, ListTodo, Settings2, Sparkles, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  useMentionMatches,
  useSlashMatches,
  type ComposerCommand,
  type ComposerPerson,
} from "../../elements/composer"
import { PromptInput } from "../../agents/prompt-input"
import { ComposerLoader } from "../../agent-elements/composer-loader"
import { useQuestionBarNavigation } from "../../agent-elements/hooks/use-question-bar-navigation"
import { FileAttachment } from "../../agent-elements/input/file-attachment"
import { InputQuestionBar } from "../../agent-elements/input/question-bar"
import { ModeSelector } from "../../agent-elements/input/mode-selector"
import {
  ComposerTriggerPopover,
  type ComposerTriggerGroup,
  type ComposerTriggerItem,
} from "../../assistant-ui/composer-trigger-popover"
import { ModelSelector } from "../../assistant-ui/model-selector"
import { cn } from "../../../lib/utils"
import type { InputBarProps } from "../../agent-elements/input-bar"
import type { SuggestionItem } from "../../agent-elements/input/suggestions"
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract"
import type {
  ChatMode,
  ChatThinkingLevel,
} from "@prime-agent/web-protocol/chat-protocol"
import {
  availableThinkingLevels,
  clampThinkingLevel,
  thinkingLevelLabel,
  type ChatModelOption,
} from "../../../lib/pi/chat-helpers"
import {
  ProviderBrandIcon,
  formatProviderLabel,
} from "../pi/config-panel/shared/provider-brand-icon"

export function withFleetPiSuggestionStyles(
  suggestions: InputBarProps["suggestions"],
): InputBarProps["suggestions"] {
  return suggestions
}

export const FLEET_PI_CHAT_MODES = [
  { id: "agent", label: "Agent", icon: Bot, description: "Default coding agent" },
  { id: "plan", label: "Plan", icon: ListTodo, description: "Plan before executing" },
  { id: "harness", label: "Harness", icon: Settings2, description: "Harness-aware turn" },
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
  onSlashCommandSelect?: (item: SuggestionItem) => boolean | void
  onLocalSlashSubmit?: (message: string) => boolean
  modelPickerOpen?: boolean
  onModelPickerOpenChange?: (open: boolean) => void
  effortPickerOpen?: boolean
  onEffortPickerOpenChange?: (open: boolean) => void
  workspaceReferences?: Array<WorkspaceAttachment>
  workspaceSuggestions?: InputBarProps["slashCommands"]
  onWorkspaceReferenceSelect?: (item: SuggestionItem) => void
  onRemoveWorkspaceReference?: (relativePath: string) => void
}

type SuggestionConfig = NonNullable<InputBarProps["slashCommands"]>

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

export function FleetPiInputBar(props: FleetPiInputBarProps) {
  return <FleetPiInputBarContent {...props} />
}

function FleetPiInputBarContent({
  modelKey,
  models,
  status,
  infoDescription,
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
  workspaceReferences = [],
  workspaceSuggestions,
  onWorkspaceReferenceSelect,
  onRemoveWorkspaceReference,
  controlled,
  disabled,
  autoFocus,
  placeholder,
  attachments,
  questionBar,
  slashCommands,
  className,
}: FleetPiInputBarProps) {
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
        description: [item.description, slashArgumentHint(item)]
          .filter(Boolean)
          .join(" "),
        icon: Sparkles,
      })),
    [commands],
  )
  const mentionElementPeople = useMemo<ComposerPerson[]>(
    () =>
      workspaceItems.map((item) => {
        return {
          id: item.id,
          name: item.label,
          path: item.value ?? item.label,
          kind: item.metadata?.kind === "folder" ? "folder" : "file",
          description: item.description,
          role: "human",
        }
      }),
    [workspaceItems],
  )
  const slashMatch = value.match(/^\/([^\s/]*)$/)
  const workspaceMentionMatch = value.match(/(?:^|\s)@([^\s@]*)$/)
  const slashQuery = slashMatch?.[1]?.toLowerCase()
  const workspaceQuery = workspaceMentionMatch?.[1]?.toLowerCase()
  const triggerKind = slashQuery !== undefined ? "slash" : workspaceQuery !== undefined ? "mention" : undefined
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

      if (isSuggestionMenuOpen) {
        if (event.key === "Escape") {
          event.preventDefault()
          setValue(triggerKind === "slash" ? removeTriggerToken(slashMatch) : removeTriggerToken(workspaceMentionMatch))
          return
        }
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
      filteredCommands,
      filteredWorkspaceItems,
      isStreaming,
      onRemoveWorkspaceReference,
      removeTriggerToken,
      selectCommand,
      selectWorkspaceReference,
      send,
      setValue,
      slashQuery,
      slashMatch,
      triggerItems,
      triggerKind,
      value,
      workspaceQuery,
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
        description: [item.description, slashArgumentHint(item)]
          .filter(Boolean)
          .join(" · "),
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
  // The slash dispatcher keeps model and effort open flags for compatibility
  // with the existing shell. Treat either flag as the single combined
  // selector state so `/effort` cannot be masked by modelPickerOpen=false.
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
        const levels = availableThinkingLevels(nextModel)
        onThinkingLevelChange?.(clampThinkingLevel(thinkingLevel, levels))
      }
    },
    [models, onModelChange, onThinkingLevelChange, thinkingLevel],
  )

  return (
    <div className={cn("shrink-0 px-3 pb-3", className)}>
      <div className="relative mx-auto w-full max-w-an">
        <ComposerLoader label={infoDescription ?? undefined} isActive={isStreaming} />
        {showQuestion ? (
          <InputQuestionBar
            questionBar={questionBar}
            navigation={navigation}
            roundedTop
            onDismiss={setDismissedQuestionId}
          />
        ) : null}
        <ComposerTriggerPopover
          open={triggerOpen}
          kind={triggerKind ?? "slash"}
          query={triggerKind === "slash" ? slashQuery : workspaceQuery}
          items={triggerKind === "mention" ? filteredWorkspaceItems : undefined}
          groups={triggerKind === "slash" ? commandGroups : undefined}
          activeIndex={activeTriggerIndex}
          onActiveIndexChange={setActiveTriggerIndex}
          onSelect={(item: ComposerTriggerItem) => {
            if (triggerKind === "slash") selectCommand(item)
            else selectWorkspaceReference(item)
          }}
          onClose={() =>
            setValue(
              triggerKind === "slash"
                ? removeTriggerToken(slashMatch)
                : removeTriggerToken(workspaceMentionMatch),
            )
          }
          title={triggerKind === "slash" ? "Commands" : "Workspace references"}
          listId="fleet-composer-trigger-list"
        />
        {images.length > 0 || files.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2 rounded-xl border bg-muted/40 p-2">
            {images.map((image) => (
              <div key={image.id} className="group relative">
                <img
                  src={image.url}
                  alt={image.filename}
                  className="size-16 rounded-lg border object-cover"
                />
                <button
                  type="button"
                  aria-label={`Remove ${image.filename}`}
                  onClick={() => attachments?.onRemoveImage?.(image.id)}
                  className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full border bg-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {files.map((file) => (
              <FileAttachment
                key={file.id}
                id={file.id}
                filename={file.filename}
                size={file.size}
                onRemove={
                  attachments?.onRemoveFile
                    ? () => attachments.onRemoveFile?.(file.id)
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}
        {workspaceReferences.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5 rounded-xl border bg-muted/40 p-2">
            {workspaceReferences.map((attachment) => (
              <div
                key={attachment.relativePath}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs text-foreground/75"
              >
                <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-[min(28rem,70vw)] truncate">@{attachment.relativePath}</span>
                <button
                  type="button"
                  aria-label={`Remove workspace reference ${attachment.relativePath}`}
                  onClick={() => onRemoveWorkspaceReference?.(attachment.relativePath)}
                  className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <PromptInput
          id="fleet-composer-prompt"
          name="prompt"
          value={value}
          onValueChange={setValue}
          onSubmit={(content) => send(content)}
          loading={isStreaming}
          onStop={onStop}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder ?? "Send a message…"}
          onPaste={attachments?.onPaste}
          aria-controls={triggerOpen ? "fleet-composer-trigger-list" : undefined}
          aria-expanded={triggerOpen}
          aria-haspopup="listbox"
          aria-activedescendant={
            triggerOpen && triggerItems[activeTriggerIndex]
              ? `fleet-composer-trigger-list-${triggerItems[activeTriggerIndex].id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
              : undefined
          }
          actions={
            attachments?.onAttach
              ? [
                  {
                    value: "attach",
                    label: "Attach file",
                    description: "Add a file or image to this turn",
                    icon: <FilePlus2 />,
                  },
                ]
              : []
          }
          onAction={(action) => {
            if (action === "attach") attachments?.onAttach?.()
          }}
          onKeyDown={handlePromptKeyDown}
          leadingAction={
            <>
              <ModeSelector
                modes={[...FLEET_PI_CHAT_MODES]}
                value={chatMode}
                onChange={(id) => onChatModeChange?.(id as ChatMode)}
              />
              <ModelSelector
                models={selectorModels}
                value={modelKey}
                effort={thinkingLevel}
                onModelChange={handleSelectorModelChange}
                onEffortChange={(level) => onThinkingLevelChange?.(level as ChatThinkingLevel)}
                open={combinedPickerOpen}
                onOpenChange={handleCombinedPickerOpenChange}
                placeholder="Model"
              />
            </>
          }
        />
      </div>
    </div>
  )
}
