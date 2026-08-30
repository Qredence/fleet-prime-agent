import { AlertCircle } from "lucide-react"
import { lazy, memo, Suspense, useMemo, useState, type ComponentProps, type ReactNode } from "react"
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "../../../registry/beui/agents/message"
import { MessageScroller } from "../../../registry/beui/agents/message-scroller"
import { StreamingResponse } from "../../../registry/beui/agents/streaming-response"
import { AgentActivity, type AgentActivityItem } from "../../../registry/beui/agents/agent-activity/index"
import { PromptSuggestions } from "../../../registry/assistant-ui/elements/prompt-suggestions"
import { buildAssistantElements } from "../../../registry/beui/agents/message-turns"
import { UserMessage } from "../../../registry/beui/agents/user-message"
import { normalizeAssistantToolParts } from "../../../registry/beui/agents/utils/tool-part-normalizer"
import { cn } from "../../../../lib/utils"
import { FleetGenerativeTextRenderer } from "./generative-text-renderer"
import type { OpenUIArtifactCandidate } from "../../../openui/html-artifact"
import { PI_TOOL_RENDERERS } from "../pi/tool-renderers"
import { FleetTurnStatus } from "./fleet-turn-status"
import {
  FleetPiInputBar,
  withFleetPiSuggestionStyles,
} from "./fleet-pi-input-bar"
import type { AgentChatProps } from "../../../registry/beui/agents/types"
import type { SuggestionItem } from "../../../registry/beui/agents/input/suggestions"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"
import type {
  ChatReasoningPresentation,
  PrimeAgentArtifactRun,
  PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol"
import { NETWORK_DISCONNECTED_MESSAGE } from "@prime-agent/web-protocol/chat-protocol"
import type { FleetPiInputBarProps } from "./fleet-pi-input-bar"
import { FleetReasoningPanel } from "../../../registry/assistant-ui/elements/fleet-reasoning-panel"

const LazyFleetPiToolRenderer = lazy(() =>
  import("./fleet-pi-tool-renderer").then(({ FleetPiToolRenderer }) => ({
    default: FleetPiToolRenderer,
  }))
)

function FleetPiToolRenderer(props: ComponentProps<typeof LazyFleetPiToolRenderer>) {
  return (
    <Suspense fallback={<div className="h-7 animate-pulse rounded-md bg-muted/40" aria-label="Loading tool" />}>
      <LazyFleetPiToolRenderer {...props} />
    </Suspense>
  )
}

export type FleetPiAgentChatProps = Omit<
  AgentChatProps,
  "slots" | "toolRenderers" | "style" | "suggestions"
> & {
  toolRenderers?: AgentChatProps["toolRenderers"]
  suggestions?: AgentChatProps["suggestions"]
	className?: string
	workspaceName?: string
	activityLabel?: string
	presentation?: PrimeAgentSessionPresentation
	artifactRuns?: Array<PrimeAgentArtifactRun>
	onOpenArtifact?: (artifactId: string) => void
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>
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

function buildActivityItems(
	messages: Array<ChatMessage>,
	presentation?: PrimeAgentSessionPresentation,
	artifactRuns: Array<PrimeAgentArtifactRun> = [],
	onOpenArtifact?: (artifactId: string) => void,
): AgentActivityItem[] {
  const items = new Map<string, AgentActivityItem>()
	const artifacts = artifactRuns.flatMap((run) => run.artifacts)
	const openArtifactAction = (sourceId: string) => {
		const artifactIndex = artifacts.findIndex(
			(candidate) => candidate.sourceToolCallId === sourceId,
		)
		const artifact = artifactIndex >= 0 ? artifacts[artifactIndex] : undefined
		return artifact && onOpenArtifact
			? {
					label: "Open in Artifacts",
					ariaLabel: `Open ${artifact.title || "tool result"} artifact ${artifactIndex + 1}`,
					onClick: () => onOpenArtifact(artifact.id),
				}
			: undefined
	}
  for (const message of messages) {
    for (const [partIndex, part] of (message.parts ?? []).entries()) {
      const partRecord = record(part)
      const type = partRecord?.type
      if (typeof type !== "string" || !type.startsWith("tool-")) continue

      const source = partRecord ?? {}
      const name = type.slice(5)
      const lowerName = name.toLowerCase()
      if (lowerName === "fleetreasoning" || lowerName === "thinking" || lowerName === "taskoutput") {
        continue
      }

      const id = String(
        source.toolCallId ?? source.id ?? `${message.id}-${lowerName}-${partIndex}`,
      )
      const input = record(source.input) ?? record(source.args)
      if (lowerName === "websearch" || lowerName === "grep" || lowerName === "glob") {
        items.set(id, {
          id,
          type: "search",
          query: stringValue(input, "query", "pattern", "path") ?? name,
        })
        continue
      }

      const action = lowerName.includes("edit") || lowerName.includes("write")
        ? "edit"
        : lowerName.includes("read")
          ? "read"
          : "run"
      items.set(id, {
        id,
        type: "tool",
        action,
        target:
          stringValue(input, "path", "filePath", "command", "cmd", "code") ?? name,
				openAction: openArtifactAction(id),
      })
    }
	}
	const presentationItems: AgentActivityItem[] = []
	for (const entry of presentation?.userBash ?? []) {
		if (entry.status !== "running") continue
		presentationItems.push({
			id: entry.id,
			type: "trace",
			kind: "run",
			label: "Bash",
			detail: entry.command || "User command",
			action: openArtifactAction(entry.runId),
		})
	}
	for (const child of presentation?.rlmChildren ?? []) {
		if (child.status !== "queued" && child.status !== "running") continue
		presentationItems.push({
			id: `rlm-${child.id}`,
			type: "trace",
			kind: "run",
			label: `RLM · ${child.label}`,
			detail: child.answerPreview || child.status,
			action: openArtifactAction(child.id),
		})
	}
	if (presentation?.goal?.active && presentation.goal.status === "active" && presentation.goal.objective) {
		presentationItems.push({
			id: `goal-${presentation.goal.goalId ?? "current"}`,
			type: "step",
			label: presentation.goal.objective,
			status: presentation.goal.status === "active" ? "active" : "complete",
			meta: presentation.goal.status,
		})
	}
	return [
		...presentationItems,
		...Array.from(items.values()),
	]
}

function AssistantMessage({
  messages,
  isLast,
  isStreaming,
  suppressQuestionTool,
	toolRenderers,
	onOpenUIAction,
	activityLabel,
	presentation,
	artifactRuns,
	onOpenArtifact,
	onOpenUIArtifactReady,
}: {
  messages: Array<ChatMessage>
  isLast: boolean
  isStreaming: boolean
  suppressQuestionTool: boolean
	toolRenderers: NonNullable<AgentChatProps["toolRenderers"]>
	onOpenUIAction?: (message: string) => void
	activityLabel?: string
	presentation?: PrimeAgentSessionPresentation
	artifactRuns?: Array<PrimeAgentArtifactRun>
	onOpenArtifact?: (artifactId: string) => void
	onOpenUIArtifactReady?: (candidate: OpenUIArtifactCandidate) => void | Promise<string | undefined>
}) {
  const turnStreaming = isLast && isStreaming
  const elements = useMemo(
    () =>
      messages.flatMap((message, index) =>
        buildAssistantElements(
          normalizeAssistantToolParts(
            (message.parts ?? []).filter(
              (part) => part.type !== "tool-FleetReasoning" && part.type !== "tool-Thinking",
            ),
          ),
          {
            messageId: message.id,
            isLast: isLast && index === messages.length - 1,
            isStreaming: turnStreaming,
            suppressQuestionTool,
            suppressTextWhenPlanWrite: true,
            ToolRendererComponent: FleetPiToolRenderer,
            TextRendererComponent: FleetGenerativeTextRenderer,
					toolRenderers,
					onOpenUIAction,
					onOpenUIArtifactReady,
					onOpenArtifact,
				},
        ),
      ),
    [
      isLast,
      turnStreaming,
      messages,
      onOpenArtifact,
      onOpenUIAction,
      onOpenUIArtifactReady,
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
  const activityItems = useMemo(
		() => buildActivityItems(messages, presentation, artifactRuns, onOpenArtifact),
		[artifactRuns, messages, onOpenArtifact, presentation],
  )
  const reasoningPresentation = useMemo(() => reasoningPresentationFromMessages(messages), [messages])
  const [activityOpen, setActivityOpen] = useState(turnStreaming)
  const [prevTurnStreaming, setPrevTurnStreaming] = useState(turnStreaming)
  if (prevTurnStreaming !== turnStreaming) {
    setPrevTurnStreaming(turnStreaming)
    setActivityOpen(turnStreaming)
  }

  return (
    <Message from="assistant" animateIn={!turnStreaming}>
      <MessageContent>
        <MessageBubble variant="ghost">
          <MessageBubbleContent>
			{reasoningPresentation ? (
				<FleetReasoningPanel presentation={reasoningPresentation} className="mb-2" />
			) : null}
            {isLast && isLifecycleNotice(activityLabel) ? (
              <FleetTurnStatus label={activityLabel} className="mb-2" />
            ) : null}
            <StreamingResponse
              status={turnStreaming ? "streaming" : "complete"}
              copyText={copyText || undefined}
              announce={false}
              contentClassName="flex flex-col gap-3"
            >
              {elements}
            </StreamingResponse>
            {activityItems.length > 0 ? (
              <AgentActivity
                items={activityItems}
                status={turnStreaming ? "working" : "complete"}
                open={activityOpen}
                onOpenChange={setActivityOpen}
                activeLabel={activityLabelFor(activityItems)}
                summary={activitySummary(activityItems)}
                collapseOnComplete
                maxHeight={208}
                className="mt-2 max-w-none"
              />
            ) : null}
          </MessageBubbleContent>
        </MessageBubble>
      </MessageContent>
    </Message>
  )
}

type ConversationTurnViewProps = {
  turn: ConversationTurn
  state: {
    isLast: boolean
    isStreaming: boolean
    suppressQuestionTool: boolean
  }
  rendering: {
    toolRenderers: NonNullable<AgentChatProps["toolRenderers"]>
    onOpenUIAction?: (message: string) => void
    onOpenUIArtifactReady?: (
      candidate: OpenUIArtifactCandidate
    ) => void | Promise<string | undefined>
    onOpenArtifact?: (artifactId: string) => void
  }
  activity: {
    label?: string
    presentation?: PrimeAgentSessionPresentation
    artifactRuns?: Array<PrimeAgentArtifactRun>
  }
}

function sameMessages(
  previous: Array<ChatMessage>,
  next: Array<ChatMessage>
) {
  return (
    previous.length === next.length &&
    previous.every((message, index) => message === next[index])
  )
}

export const ConversationTurnView = memo(
  function ConversationTurnView({
    turn,
    state,
    rendering,
    activity,
  }: ConversationTurnViewProps) {
    return (
      <div className="flex flex-col gap-3">
        {turn.user ? (
          <Message from="user" animateIn={!state.isStreaming}>
            <MessageContent>
              <UserMessage message={turn.user} />
            </MessageContent>
          </Message>
        ) : null}
        {turn.assistants.length > 0 ? (
          <AssistantMessage
            messages={turn.assistants}
            isLast={state.isLast}
            isStreaming={state.isStreaming}
            suppressQuestionTool={state.suppressQuestionTool}
            toolRenderers={rendering.toolRenderers}
            onOpenUIAction={rendering.onOpenUIAction}
            onOpenUIArtifactReady={rendering.onOpenUIArtifactReady}
            onOpenArtifact={rendering.onOpenArtifact}
            activityLabel={activity.label}
            presentation={activity.presentation}
            artifactRuns={activity.artifactRuns}
          />
        ) : null}
      </div>
    )
  },
  (previous, next) =>
    previous.turn.user === next.turn.user &&
    sameMessages(previous.turn.assistants, next.turn.assistants) &&
    previous.state.isLast === next.state.isLast &&
    previous.state.isStreaming === next.state.isStreaming &&
    previous.state.suppressQuestionTool === next.state.suppressQuestionTool &&
    previous.rendering.toolRenderers === next.rendering.toolRenderers &&
    previous.rendering.onOpenUIAction === next.rendering.onOpenUIAction &&
    previous.rendering.onOpenUIArtifactReady ===
      next.rendering.onOpenUIArtifactReady &&
    previous.rendering.onOpenArtifact === next.rendering.onOpenArtifact &&
    previous.activity.label === next.activity.label &&
    previous.activity.presentation === next.activity.presentation &&
    previous.activity.artifactRuns === next.activity.artifactRuns
)

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

export function getChatErrorPresentation(error: Error) {
  if (
    (error as { code?: unknown }).code === "NETWORK_DISCONNECTED" ||
    /Cannot send daemon command/i.test(error.message) ||
    /Prime Agent daemon is not connected/i.test(error.message) ||
    /not connected to the Prime Agent runtime/i.test(error.message)
  ) {
    return {
      title: "Agent unavailable",
      message: NETWORK_DISCONNECTED_MESSAGE,
    }
  }

  return {
    title: "Request failed",
    message: error.message.replace(
      /\s+(?:Socket|Daemon log):\s*[^\n]*(?:\s+(?:Socket|Daemon log):\s*[^\n]*)*/gi,
      "",
    ),
  }
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
}: {
  disabled: boolean
  onSelect: (item: SuggestionItem) => void
  composer: ReactNode
}) {
  return (
    <section
      aria-labelledby="fleet-welcome-title"
      className="flex w-full max-w-an flex-col items-center text-center"
    >
      <h1
        id="fleet-welcome-title"
        className="text-2xl font-normal tracking-tight text-foreground sm:text-3xl"
      >
        What should Fleet Prime Agent work on?
      </h1>
      <div className="mt-6 w-full">{composer}</div>
      <div
        aria-label="Suggested prompts"
        className="mt-4 flex w-full flex-wrap justify-center gap-2"
      >
        {WELCOME_TASKS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={disabled || item.disabled}
            onClick={() => onSelect(item)}
            className="inline-flex min-h-8 items-center rounded-full border border-border/70 bg-background/70 px-4 py-1.5 text-center text-sm text-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
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
	activityLabel,
	presentation,
	artifactRuns,
	onOpenArtifact,
	onOpenUIArtifactReady,
}: FleetPiAgentChatProps) {
  const [draft, setDraft] = useState("")
  const turns = useMemo(() => groupMessages(messages), [messages])
  const styledSuggestions = withFleetPiSuggestionStyles(suggestions)
  const suggestionItems = resolveSuggestions(styledSuggestions)
  const suggestionTexts = useMemo(
    () => suggestionItems.flatMap((item) => (item.disabled ? [] : [item.value ?? item.label])),
    [suggestionItems],
  )
  const suggestionCycle = suggestionTexts.join("\u0000")
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null)
  const [prevSuggestionCycle, setPrevSuggestionCycle] = useState(suggestionCycle)
  if (prevSuggestionCycle !== suggestionCycle) {
    setPrevSuggestionCycle(suggestionCycle)
    setSelectedSuggestion(null)
  }
  const isStreaming = status === "streaming" || status === "submitted"
  const isEmpty = turns.length === 0 && !error
  const errorPresentation = error ? getChatErrorPresentation(error) : null
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
        smooth={isStreaming}
        contentClassName={cn(
          "mx-auto flex w-full max-w-an flex-col gap-5 px-4",
          isEmpty
            ? "min-h-full items-center justify-center py-8"
            : "py-6",
        )}
      >
        {isEmpty ? (
          <WelcomeState
            disabled={isStreaming}
            onSelect={(item) => setDraft(item.value ?? item.label)}
            composer={inputBarNode}
          />
        ) : null}
        {turns.map((turn, turnIndex) => {
          const key = turn.user?.id ?? `assistant-turn-${turnIndex}`
          const isLast = turnIndex === turns.length - 1
          return (
            <ConversationTurnView
              key={key}
              turn={turn}
              state={{
                isLast,
                isStreaming: isLast && isStreaming,
                suppressQuestionTool,
              }}
              rendering={{
                toolRenderers,
                onOpenUIAction,
                onOpenUIArtifactReady,
                onOpenArtifact,
              }}
              activity={{
                label: isLast ? activityLabel : undefined,
                presentation: isLast ? presentation : undefined,
                artifactRuns: isLast ? artifactRuns : undefined,
              }}
            />
          )
        })}
        {errorPresentation ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">{errorPresentation.title}</p>
              <p className="mt-1 text-xs opacity-90">{errorPresentation.message}</p>
            </div>
          </div>
        ) : null}
        {turns.length > 0 && suggestionTexts.length > 0 && !isStreaming && !error ? (
          <PromptSuggestions
            suggestions={suggestionTexts}
            selectedSuggestion={selectedSuggestion}
            cycle={turns.length}
            onSuggestion={(suggestion) => {
              setSelectedSuggestion(suggestion)
              setDraft(suggestion)
            }}
            className="px-0"
          />
        ) : null}
      </MessageScroller>
      {!isEmpty ? inputBarNode : null}
    </div>
  )
}
