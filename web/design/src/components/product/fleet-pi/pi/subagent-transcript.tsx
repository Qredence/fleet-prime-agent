import { AlertCircle, Bot, RefreshCw } from "lucide-react"
import { useMemo } from "react"
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type {
  PrimeAgentArtifact,
  PrimeAgentRlmChild,
  PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol"
import { Button } from "../../../ui/button"
import {
  Message,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
} from "../../../registry/beui/agents/message"
import { MessageScroller } from "../../../registry/beui/agents/message-scroller"
import { UserMessage } from "../../../registry/beui/agents/user-message"
import { buildAssistantElements } from "../../../registry/beui/agents/message-turns"
import { normalizeAssistantToolParts } from "../../../registry/beui/agents/utils/tool-part-normalizer"
import { FleetSubagentList } from "../../../registry/assistant-ui/elements/fleet-subagent-list"
import { FleetToolTimeline } from "../../../registry/assistant-ui/elements/fleet-tool-timeline"
import { groupMessages, type ConversationTurn } from "../../../../lib/pi/conversation-turns"
import { cn } from "../../../../lib/utils"
import { FleetGenerativeTextRenderer } from "../chat/generative-text-renderer"
import { FleetPiToolRenderer } from "../chat/fleet-pi-tool-renderer"
import { derivePrimeAgentArtifactRuns } from "./prime-agent-artifacts"
import { PI_TOOL_RENDERERS } from "./tool-renderers"

export type SubagentTranscriptState = {
  status: "loading" | "ready" | "error"
  messages: Array<ChatMessage>
  presentation?: PrimeAgentSessionPresentation
  error?: Error
}

/**
 * Maps a subagent's lifecycle state to the corresponding chat status.
 *
 * @param child - The subagent whose status determines the chat status
 * @returns `streaming` for running or recovering subagents, `error` for failed subagents, and `ready` otherwise
 */
export function transcriptStatus(child: PrimeAgentRlmChild): ChatStatus {
  if (child.status === "running" || child.status === "recovering") return "streaming"
  if (child.status === "error" || child.status === "failed") return "error"
  return "ready"
}

/**
 * Renders a conversation turn with its user message, assistant content, tool timeline, and subagent hierarchy.
 *
 * @param turn - The user and assistant messages comprising the conversation turn
 * @param isLast - Whether this is the final turn in the transcript
 * @param isStreaming - Whether assistant content is currently streaming
 * @param artifacts - Artifacts associated with the turn's tool activity
 * @param presentation - Optional session data used to render the subagent hierarchy
 */
export function SubagentTurnView({
  turn,
  isLast,
  isStreaming,
  artifacts,
  presentation,
}: {
  turn: ConversationTurn
  isLast: boolean
  isStreaming: boolean
  artifacts: Array<PrimeAgentArtifact>
  presentation?: PrimeAgentSessionPresentation
}) {
  const assistantElements = useMemo(
    () =>
      turn.assistants.flatMap((message, index) =>
        buildAssistantElements(normalizeAssistantToolParts(message.parts ?? []), {
          messageId: message.id,
          isLast: isLast && index === turn.assistants.length - 1,
          isStreaming,
          suppressQuestionTool: true,
          ToolRendererComponent: FleetPiToolRenderer,
          TextRendererComponent: FleetGenerativeTextRenderer,
          toolRenderers: PI_TOOL_RENDERERS,
        }),
      ),
    [isLast, isStreaming, turn.assistants],
  )

  return (
    <div className="flex flex-col gap-3">
      {turn.user ? (
        <Message from="user">
          <MessageContent>
            <UserMessage message={turn.user} enableImagePreview={false} />
          </MessageContent>
        </Message>
      ) : null}
      {turn.assistants.length > 0 ? (
        <Message from="assistant">
          <MessageContent>
            <MessageBubble variant="ghost">
              <MessageBubbleContent>
                {isLast ? (
                  <FleetToolTimeline
                    messages={turn.assistants}
                    artifacts={artifacts}
                    streaming={isStreaming}
                  />
                ) : null}
                <div className="flex flex-col gap-3">{assistantElements}</div>
                {isLast && presentation ? (
                  <FleetSubagentList
                    children={presentation.rlmChildren}
                    tree={presentation.rlmTree}
                  />
                ) : null}
              </MessageBubbleContent>
            </MessageBubble>
          </MessageContent>
        </Message>
      ) : null}
    </div>
  )
}

/**
 * Renders a subagent conversation thread with metadata, transcript messages, and status feedback.
 *
 * @param child - The subagent whose thread is displayed
 * @param parentSessionId - The active parent session identifier
 * @param transcript - The current transcript state and optional presentation data
 * @param onRefresh - Callback invoked when the thread is refreshed
 * @param fullWidth - Whether to render the thread in a full-width layout
 * @param statusOverride - Optional status used instead of the status derived from the subagent
 * @returns The rendered subagent thread
 */
export function SubagentTranscriptView({
  child,
  parentSessionId,
  transcript,
  onRefresh,
  fullWidth = false,
  status: statusOverride,
}: {
  child: PrimeAgentRlmChild
  parentSessionId?: string
  transcript?: SubagentTranscriptState
  onRefresh?: () => void
  fullWidth?: boolean
  status?: ChatStatus
}) {
  const turns = useMemo(
    () => (transcript?.status !== "loading" ? groupMessages(transcript?.messages ?? []) : []),
    [transcript],
  )
  const childStatus = statusOverride ?? transcriptStatus(child)
  const artifactRuns = useMemo(
    () =>
      transcript?.status !== "loading"
        ? derivePrimeAgentArtifactRuns(transcript?.messages ?? [], transcript?.presentation, childStatus)
        : [],
    [childStatus, transcript],
  )
  const artifacts = useMemo(() => artifactRuns.flatMap((run) => run.artifacts), [artifactRuns])
  const title = child.sessionName || child.label

  return (
    <section
      aria-label={`Subagent thread: ${child.label}`}
      className={cn(fullWidth ? "flex min-h-0 min-w-0 flex-1 flex-col" : "space-y-2", "min-w-0")}
      data-testid={fullWidth ? "subagent-conversation-surface" : undefined}
    >
      <div className="flex min-w-0 items-start gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2">
        <Bot className="mt-0.5 size-3.5 shrink-0 text-foreground/45" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/80">{title}</span>
            <span className="shrink-0 text-[10px] capitalize text-foreground/45">{child.status}</span>
          </div>
          {child.model ? <p className="truncate font-mono text-[10px] text-foreground/40">{child.model}</p> : null}
          {child.lastHeardFrom ? (
            <p className="truncate text-[10px] text-foreground/40">
              Heartbeat: {new Date(child.lastHeardFrom).toLocaleTimeString()}
            </p>
          ) : null}
          {child.answerPreview || child.recap ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-foreground/55">
              {child.answerPreview ?? child.recap}
            </p>
          ) : null}
        </div>
        {onRefresh ? (
          <Button
            aria-label={`Refresh ${child.label} thread`}
            className="shrink-0 text-foreground/40 hover:text-foreground/70"
            onClick={onRefresh}
            size="icon-sm"
            title={`Refresh ${child.label} thread`}
            type="button"
            variant="ghost"
          >
            <RefreshCw className={cn("size-3.5", transcript?.status === "loading" && "animate-spin")} />
          </Button>
        ) : null}
      </div>

      {!parentSessionId ? (
        <p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-[11px] leading-4 text-foreground/45">
          This subagent thread is unavailable until the parent session is active.
        </p>
      ) : transcript?.status === "loading" ? (
        <div className={cn("flex items-center justify-center rounded-md border border-dashed border-border/70 text-[11px] text-foreground/45", fullWidth ? "min-h-32 flex-1" : "min-h-32")}>
          Loading subagent thread…
        </div>
      ) : transcript?.status === "error" && turns.length === 0 ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] leading-4 text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{transcript.error?.message ?? "Unable to load this subagent thread."}</span>
        </div>
      ) : turns.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/70 px-3 py-3 text-[11px] leading-4 text-foreground/45">
          This subagent thread has no messages yet.
        </p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {transcript?.error ? (
            <div role="alert" className="mx-4 mt-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] leading-4 text-destructive sm:mx-6">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{transcript.error.message}</span>
            </div>
          ) : null}
          <div className={cn("min-h-0 rounded-md border border-border/60 bg-background", fullWidth ? "flex min-h-0 flex-1 flex-col border-x-0 rounded-none border-b-0" : "h-96 max-h-[calc(100svh-18rem)]")}>
            <MessageScroller
              busy={childStatus === "streaming"}
              className={fullWidth ? "min-h-0 flex-1" : undefined}
              followOutput={childStatus === "streaming"}
              label={`Transcript for ${child.label}`}
              smooth={childStatus === "streaming"}
              viewportClassName={fullWidth ? "px-0" : undefined}
              contentClassName={cn(
                "flex flex-col gap-4",
                fullWidth ? "mx-auto w-full max-w-3xl px-4 py-6 sm:px-6" : "px-2.5 py-3",
              )}
            >
              {turns.map((turn, index) => {
                const isLast = index === turns.length - 1
                return (
                  <SubagentTurnView
                    key={turn.user?.id ?? `subagent-turn-${index}`}
                    turn={turn}
                    isLast={isLast}
                    isStreaming={isLast && childStatus === "streaming"}
                    artifacts={isLast ? artifacts : []}
                    presentation={isLast ? transcript?.presentation : undefined}
                  />
                )
              })}
            </MessageScroller>
          </div>
        </div>
      )}
    </section>
  )
}
