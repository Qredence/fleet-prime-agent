import { AlertCircle } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "../../agents/message"
import { MessageScroller } from "../../agents/message-scroller"
import { StreamingResponse } from "../../agents/streaming-response"
import { type AgentActivityItem } from "../../agents/agent-activity"
import { PromptSuggestions } from "../../elements/prompt-suggestions"
import { buildAssistantElements } from "../../agent-elements/message-turns"
import { UserMessage } from "../../agent-elements/user-message"
import { normalizeAssistantToolParts } from "../../agent-elements/utils/tool-part-normalizer"
import { cn } from "../../../lib/utils"
import { GenerativeTextRenderer } from "../../openui/inline-renderer"
import { PI_TOOL_RENDERERS } from "../pi/tool-renderers"
import { FleetPiToolRenderer } from "./fleet-pi-tool-renderer"
import { FleetReasoningPanel } from "../../assistant-ui/fleet-reasoning-panel"
import { FleetTurnStatus } from "./fleet-turn-status"
import { ToolTimeline, type TimelineStep } from "../../elements/tool-timeline"
import { FilePenLine, FileSearch, Search, Terminal, Wrench, type LucideIcon } from "lucide-react"
import {
  FleetPiInputBar,
  withFleetPiSuggestionStyles,
} from "./fleet-pi-input-bar"
import type { AgentChatProps } from "../../agent-elements/types"
import type { SuggestionItem } from "../../agent-elements/input/suggestions"
import type { ChatReasoningPresentation } from "@prime-agent/web-protocol/chat-protocol"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"
import type { FleetPiInputBarProps } from "./fleet-pi-input-bar"

export type FleetPiAgentChatProps = Omit<
  AgentChatProps,
  "slots" | "toolRenderers" | "style" | "suggestions"
> & {
  toolRenderers?: AgentChatProps["toolRenderers"]
  suggestions?: AgentChatProps["suggestions"]
  className?: string
  workspaceName?: string
  activityLabel?: string
  inputBar: Omit<
    FleetPiInputBarProps,
    "onSend" | "onStop" | "status" | "suggestions"
  >
}

type ConversationTurn = {
  user?: ChatMessage
  assistants: Array<ChatMessage>
}

function groupMessages(messages: Array<ChatMessage>): Array<ConversationTurn> {
  const turns: Array<ConversationTurn> = []
  let current: ConversationTurn | undefined

  for (const message of messages) {
    if (message.role === "user") {
      if (current) turns.push(current)
      current = { user: message, assistants: [] }
      continue
    }
    if (message.role !== "assistant") continue
    if (!current || message.source === "local") {
      if (current) turns.push(current)
      current = { assistants: [message] }
      continue
    }
    current.assistants.push(message)
  }

  if (current) turns.push(current)
  return turns
}

function textFromMessage(message: ChatMessage) {
  return (message.parts ?? [])
    .flatMap((part) => {
      if (
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        return [part.text]
      }
      return []
    })
    .join("\n\n")
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown, ...keys: string[]) {
  const source = record(value)
  for (const key of keys) {
    const candidate = source?.[key]
    if (typeof candidate === "string" && candidate.trim()) return candidate
  }
  return undefined
}

function reasoningPresentationFromMessages(
  messages: Array<ChatMessage>,
): ChatReasoningPresentation | undefined {
  for (const message of [...messages].reverse()) {
    for (const part of [...(message.parts ?? [])].reverse()) {
      const source = record(part)
      if (source?.type !== "tool-FleetReasoning") continue
      const presentation = record(source.input)
      if (
        typeof presentation?.runId !== "string" ||
        typeof presentation.phase !== "string" ||
        !Array.isArray(presentation.steps) ||
        typeof presentation.visibleSteps !== "number" ||
        typeof presentation.streaming !== "boolean" ||
        typeof presentation.startedAt !== "number" ||
        typeof presentation.restingLabel !== "string"
      ) {
        continue
      }
      return presentation as unknown as ChatReasoningPresentation
    }
  }
  return undefined
}

function buildActivityItems(messages: Array<ChatMessage>): AgentActivityItem[] {
  const items = new Map<string, AgentActivityItem>()
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      const partRecord = record(part)
      const type = partRecord?.type
      if (typeof type !== "string" || !type.startsWith("tool-")) continue
      const source = partRecord ?? {}
      const name = type.slice(5)
      if (name === "FleetReasoning") continue
      const id = String(source.toolCallId ?? source.id ?? `${message.id}-${items.size}`)
      const input = record(source.input) ?? record(source.args)
      // Legacy detailed-thinking parts are intentionally never rendered in the
      // standard Fleet transcript. Safe progress uses FleetReasoningPanel.
      if (name === "Thinking") continue
      if (name === "WebSearch" || name === "Grep" || name === "Glob") {
        items.set(id, {
          id,
          type: "search",
          query: stringValue(input, "query", "pattern", "path") ?? name,
        })
        continue
      }
      const action = name.toLowerCase().includes("edit") || name.toLowerCase().includes("write")
        ? "edit"
        : name.toLowerCase().includes("read")
          ? "read"
          : name.toLowerCase().includes("bash") || name.toLowerCase().includes("python")
            ? "run"
            : "run"
      items.set(id, {
        id,
        type: "tool",
        action,
        target: stringValue(input, "path", "filePath", "command", "cmd", "code") ?? name,
      })
    }
  }
  return Array.from(items.values())
}

function activityText(value: ReactNode, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}
function timelineChip(value: ReactNode, fallback: string) {
  const source = activityText(value, fallback).replace(/\s+/g, " ").trim()
  return source.length > 56 ? source.slice(0, 53).trimEnd() + "…" : source
}
function toolIcon(action: string): LucideIcon {
  switch (action) {
    case "read":
      return FileSearch
    case "edit":
      return FilePenLine
    case "run":
      return Terminal
    default:
      return Wrench
  }
}
function toolTimelineSteps(items: AgentActivityItem[]): TimelineStep[] {
  return items.flatMap((item) => {
    if (item.type === "search") {
      return [{
        verb: "Searching",
        chip: timelineChip(item.query, "workspace"),
        icon: Search,
      }]
    }
    if (item.type === "tool") {
      return [{
        verb: item.action === "read" ? "Reading" : item.action === "edit" ? "Editing" : "Running",
        chip: timelineChip(item.target, "tool task"),
        icon: toolIcon(item.action),
      }]
    }
    return []
  })
}

function AssistantMessage({
  messages,
  isLast,
  isStreaming,
  suppressQuestionTool,
  toolRenderers,
  onOpenUIAction,
  activityLabel,
}: {
  messages: Array<ChatMessage>
  isLast: boolean
  isStreaming: boolean
  suppressQuestionTool: boolean
  toolRenderers: NonNullable<AgentChatProps["toolRenderers"]>
  onOpenUIAction?: (message: string) => void
  activityLabel?: string
}) {
  const turnStreaming = isLast && isStreaming
  const elements = useMemo(
    () =>
      messages.flatMap((message, index) =>
        buildAssistantElements(
          normalizeAssistantToolParts(
            (message.parts ?? []).filter((part) => part.type !== "tool-FleetReasoning"),
          ),
          {
            messageId: message.id,
            isLast: isLast && index === messages.length - 1,
            isStreaming: turnStreaming,
            suppressQuestionTool,
            suppressTextWhenPlanWrite: true,
            ToolRendererComponent: FleetPiToolRenderer,
            TextRendererComponent: GenerativeTextRenderer,
            toolRenderers,
            onOpenUIAction,
          },
        ),
      ),
	    [
	      isLast,
	      turnStreaming,
      messages,
      onOpenUIAction,
      suppressQuestionTool,
      toolRenderers,
    ],
  )
  const copyText = messages
    .flatMap((message) => {
      const text = textFromMessage(message)
      return text ? [text] : []
    })
    .join("\n\n")
  const activityItems = useMemo(() => buildActivityItems(messages), [messages])
  const reasoningPresentation = useMemo(
    () => reasoningPresentationFromMessages(messages),
    [messages],
  )
  const toolTimeline = useMemo(() => toolTimelineSteps(activityItems), [activityItems])
  const [toolTimelineOpen, setToolTimelineOpen] = useState(turnStreaming)
  const wasToolTimelineStreaming = useRef(turnStreaming)
  useEffect(() => {
    if (turnStreaming) {
      setToolTimelineOpen(true)
    } else if (wasToolTimelineStreaming.current) {
      setToolTimelineOpen(false)
    }
    wasToolTimelineStreaming.current = turnStreaming
  }, [turnStreaming])

  return (
    <Message from="assistant" animateIn={!turnStreaming}>
      <MessageContent>
        <MessageBubble variant="ghost">
          <MessageBubbleContent>
            {reasoningPresentation ? (
              <FleetReasoningPanel
                presentation={reasoningPresentation}
                className="mb-2"
              />
            ) : null}
            {isLast && isLifecycleNotice(activityLabel) ? (
              <FleetTurnStatus label={activityLabel} className="mb-2" />
            ) : null}
            {toolTimeline.length > 0 ? (
              <ToolTimeline
                steps={toolTimeline}
                visibleSteps={toolTimeline.length}
                streaming={turnStreaming}
                open={toolTimelineOpen}
                onOpenChange={setToolTimelineOpen}
                activeLabel={activityLabelFor(activityItems)}
                restingLabel={activitySummary(activityItems)}
                stats={[]}
                className="mb-2 max-w-none"
              />
            ) : null}
            <StreamingResponse
              status={turnStreaming ? "streaming" : "complete"}
              copyText={copyText || undefined}
              announce={false}
              contentClassName="flex flex-col gap-3"
            >
              {elements}
            </StreamingResponse>
          </MessageBubbleContent>
        </MessageBubble>
      </MessageContent>
    </Message>
  )
}

function isLifecycleNotice(label: string | undefined) {
  if (!label) return false
  return /queued|steered|retry|compact|reset|recover|sign in/i.test(label)
}

function activityLabelFor(items: AgentActivityItem[]) {
  if (items.length === 1) {
    const item = items[0]
    if (item?.type === "search") return "Checking a source…"
    if (item?.type === "tool") return "Working with " + item.action + "…"
  }
  if (items.length > 1) return "Coordinating " + items.length + " active actions…"
  return "Working through the run…"
}

function activitySummary(items: AgentActivityItem[]) {
  const count = items.length
  if (count === 1) return "Completed 1 tracked action"
  return "Completed " + count + " tracked actions"
}

function resolveSuggestions(suggestions: FleetPiAgentChatProps["suggestions"]) {
  if (Array.isArray(suggestions)) return suggestions
  return suggestions?.items ?? []
}

const WELCOME_TASKS: SuggestionItem[] = [
  {
    id: "welcome-explore-codebase",
    label: "Explore codebase",
    value:
      "Explore this codebase and explain its architecture, important modules, and main entry points.",
  },
  {
    id: "welcome-review-changes",
    label: "Review changes",
    value:
      "Review my current changes for bugs, regressions, architecture issues, and code quality problems.",
  },
  {
    id: "welcome-fix-issue",
    label: "Fix an issue",
    value: "Help me investigate and fix an issue in this project.",
  },
  {
    id: "welcome-plan-feature",
    label: "Plan a feature",
    value:
      "Explore the relevant code and create an implementation plan for a new feature before making changes.",
  },
]

function WelcomeState({
  disabled,
  onSelect,
  composer,
  workspaceName,
}: {
  disabled: boolean
  onSelect: (item: SuggestionItem) => void
  composer: ReactNode
  workspaceName?: string
}) {
  return (
    <section
      aria-labelledby="fleet-welcome-title"
      className="flex w-full max-w-an flex-col items-start text-left"
    >
      <div className="grid size-14 place-items-center rounded-2xl border border-primary/20 bg-primary/10 shadow-sm">
        <img
          src="/brand/logo-qredence-light-1.svg"
          alt="Qredence"
          className="size-10 object-contain dark:hidden"
        />
        <img
          src="/brand/logo-qredence-dark-1.svg"
          alt=""
          aria-hidden="true"
          className="hidden size-10 object-contain dark:block"
        />
      </div>
      <p className="mt-5 text-xs font-medium tracking-[0.18em] text-muted-foreground">
        Qredence
      </p>
      <h1
        id="fleet-welcome-title"
        className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl"
      >
        What should Fleet Prime Agent work on?
      </h1>
      <p className="mt-2 text-lg text-muted-foreground">
        {workspaceName?.trim() || "your workspace"}
      </p>
      <div className="mt-6 w-full">{composer}</div>
      <div
        aria-label="Suggested prompts"
        className="mt-4 grid w-full grid-cols-1 gap-2 md:grid-cols-2"
      >
        {WELCOME_TASKS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={disabled || item.disabled}
            onClick={() => onSelect(item)}
            className="flex min-h-10 items-center rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-left text-sm text-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  )
}

export function FleetPiAgentChat({
  toolRenderers = PI_TOOL_RENDERERS,
  suggestions,
  status,
  onStop,
  onSend,
  inputBar,
  className,
  messages,
  error,
  suppressQuestionTool = false,
  onOpenUIAction,
  workspaceName,
  activityLabel,
}: FleetPiAgentChatProps) {
  const [draft, setDraft] = useState("")
  const turns = useMemo(() => groupMessages(messages), [messages])
  const styledSuggestions = withFleetPiSuggestionStyles(suggestions)
  const suggestionItems = resolveSuggestions(styledSuggestions)
  const suggestionTexts = useMemo(
    () => suggestionItems.filter((item) => !item.disabled).map((item) => item.value ?? item.label),
    [suggestionItems],
  )
  const suggestionCycle = suggestionTexts.join("\u0000")
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null)
  useEffect(() => setSelectedSuggestion(null), [suggestionCycle])
  const isStreaming = status === "streaming" || status === "submitted"
  const isEmpty = turns.length === 0 && !error
  const inputBarNode = (
    <FleetPiInputBar
      {...inputBar}
      className={cn(inputBar.className, isEmpty && "px-0 pb-0")}
      placeholder={
        isEmpty
          ? "Ask Prime to build, investigate, or change something…"
          : inputBar.placeholder
      }
      controlled={{ value: draft, onChange: setDraft }}
      status={status}
      suggestions={styledSuggestions}
      onSend={onSend}
      onStop={onStop}
    />
  )

  return (
    <div
      className={cn(
        "fleet-pi-agent-chat flex h-full min-h-0 flex-col bg-background",
        className,
      )}
    >
      <MessageScroller
        className="flex-1"
        busy={isStreaming}
        followOutput
        contentClassName={cn(
          "mx-auto flex w-full max-w-an flex-col gap-5 px-4",
          isEmpty
            ? "min-h-full items-center justify-start pt-[clamp(4rem,12vh,8rem)] pb-8"
            : "py-6",
        )}
      >
        {isEmpty ? (
          <WelcomeState
            disabled={isStreaming}
            onSelect={(item) => setDraft(item.value ?? item.label)}
            composer={inputBarNode}
            workspaceName={workspaceName}
          />
        ) : null}
        {turns.map((turn, turnIndex) => {
          const key = turn.user?.id ?? `assistant-turn-${turnIndex}`
          const isLast = turnIndex === turns.length - 1
          return (
            <div key={key} className="flex flex-col gap-3">
              {turn.user ? (
                <Message from="user" animateIn={!isStreaming}>
                  <MessageContent>
                    <UserMessage message={turn.user} />
                  </MessageContent>
                </Message>
              ) : null}
              {turn.assistants.length > 0 ? (
                <AssistantMessage
                  messages={turn.assistants}
                  isLast={isLast}
                  isStreaming={isStreaming}
                  suppressQuestionTool={suppressQuestionTool}
                  toolRenderers={toolRenderers}
                  onOpenUIAction={onOpenUIAction}
                  activityLabel={activityLabel}
                />
              ) : null}
            </div>
          )
        })}
        {error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Request failed</p>
              <p className="mt-1 text-xs opacity-90">{error.message}</p>
            </div>
          </div>
        ) : null}
        {turns.length > 0 && suggestionTexts.length > 0 && !isStreaming ? (
          <PromptSuggestions
            suggestions={suggestionTexts}
            selectedSuggestion={selectedSuggestion}
            cycle={turns.length}
            onSuggestion={(suggestion) => {
              setSelectedSuggestion(suggestion)
              onSend({ role: "user", content: suggestion })
            }}
            className="px-0"
          />
        ) : null}
      </MessageScroller>
      {!isEmpty ? inputBarNode : null}
    </div>
  )
}
