import { Bot, FileCode2, FilePlus2, ListTodo, Settings2, X } from "lucide-react"
import { PromptInput } from "../../agents/prompt-input"
import { ComposerLoader } from "../../agent-elements/composer-loader"
import { FileAttachment } from "../../agent-elements/input/file-attachment"
import { InputQuestionBar } from "../../agent-elements/input/question-bar"
import { ModeSelector } from "../../agent-elements/input/mode-selector"
import {
  ComposerTriggerPopover,
  type ComposerTriggerItem,
} from "../../elements/composer-trigger-popover"
import { ModelSelector } from "../../elements/model-selector"
import { cn } from "../../../lib/utils"
import { useFleetPiInputBarState } from "./fleet-pi-input-bar-state"
import type { InputBarProps } from "../../agent-elements/input-bar"
import type { SuggestionItem } from "../../agent-elements/input/suggestions"
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract"
import type {
  ChatMode,
  ChatThinkingLevel,
} from "@prime-agent/web-protocol/chat-protocol"
import type { ChatModelOption } from "../../../lib/pi/chat-helpers"

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

const EMPTY_WORKSPACE_REFERENCES: Array<WorkspaceAttachment> = []

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
  workspaceReferences = EMPTY_WORKSPACE_REFERENCES,
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
  const {
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
    filteredWorkspaceItems,
    removeTriggerToken,
    selectCommand,
    selectWorkspaceReference,
    selectorModels,
    send,
    setActiveTriggerIndex,
    setDismissedQuestionId,
    setValue,
    showQuestion,
    slashMatch,
    slashQuery,
    triggerItems,
    triggerKind,
    triggerOpen,
    value,
    workspaceMentionMatch,
    workspaceQuery,
  } = useFleetPiInputBarState({
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
    workspaceReferences,
    workspaceSuggestions,
    onWorkspaceReferenceSelect,
    onRemoveWorkspaceReference,
    controlled,
    disabled,
    questionBar,
    attachments,
    slashCommands,
  })

  return (
    <div className={cn("shrink-0 px-3 pb-3", className)}>
      <div className="relative mx-auto w-full max-w-an">
        <ComposerLoader label={infoDescription ?? undefined} isActive={isStreaming} />
        {showQuestion ? (
          <InputQuestionBar
            questionBar={questionBar!}
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
