import {
  appendAssistantDelta,
  createTextMessage,
  upsertAssistantThinkingPart,
  upsertAssistantToolPart,
} from "./chat-message-helpers"
import { labelForState } from "./chat-fetch"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"
import type { QueueState } from "./chat-fetch"
import type {
  ChatSessionMetadata,
  ChatStreamEvent,
} from "@prime-agent/web-protocol/chat-protocol"

export type ChatStreamSnapshot = {
  activityLabel?: string
  messages: Array<ChatMessage>
  planLabel?: string
  queue: QueueState
  sessionMetadata: ChatSessionMetadata
}

export type ChatStreamTransition = {
  assistantId: string | null
  snapshot: ChatStreamSnapshot
}

export const EMPTY_QUEUE_STATE: QueueState = {
  steering: [],
  followUp: [],
}

function hasRenderableParts(message: ChatMessage): boolean {
  return (message.parts ?? []).some((part) => {
    if (part.type === "text") {
      return typeof part.text === "string" && part.text.trim().length > 0
    }
    return true
  })
}

/**
 * Reconcile the in-flight assistant bubble id with a streamed `messageId`.
 * The `start` frame may open a placeholder id before the mapper assigns
 * `run-…-a0`; rename (or create) the bubble once without re-entering the
 * event reducer.
 */
function reconcileAssistantId(
  transition: ChatStreamTransition,
  messageId: string | undefined
): ChatStreamTransition {
  if (!messageId) return transition
  const { assistantId, snapshot } = transition
  if (assistantId === messageId) return transition

  if (assistantId) {
    const renamed = snapshot.messages.map((message) =>
      message.id === assistantId && message.role === "assistant"
        ? { ...message, id: messageId }
        : message
    )
    return {
      assistantId: messageId,
      snapshot: { ...snapshot, messages: renamed },
    }
  }

  return {
    assistantId: messageId,
    snapshot: {
      ...snapshot,
      messages: [
        ...snapshot.messages,
        createTextMessage("assistant", "", messageId),
      ],
    },
  }
}

function replaceOrAppendMessage(
  messages: Array<ChatMessage>,
  nextMessage: ChatMessage
) {
  return messages.some((message) => message.id === nextMessage.id)
    ? messages.map((message) =>
        message.id === nextMessage.id ? nextMessage : message
      )
    : [...messages, nextMessage]
}

/**
 * Merge a `done` frame into the transcript. When `done` arrives with an empty
 * body, keep renderable parts already streamed into this turn's bubble
 * (matched by `assistantId` / `nextMessage.id` only — never a prior turn).
 */
function replaceOrAppendInFlight(
  messages: Array<ChatMessage>,
  nextMessage: ChatMessage,
  assistantId: string | null
): Array<ChatMessage> {
  if (!hasRenderableParts(nextMessage)) {
    const candidates = [
      assistantId
        ? messages.find((m) => m.id === assistantId && m.role === "assistant")
        : undefined,
      messages.find((m) => m.id === nextMessage.id && m.role === "assistant"),
    ].filter(Boolean) as Array<ChatMessage>
    const donor = candidates.find((m) => hasRenderableParts(m))
    if (donor) {
      return replaceOrAppendMessage(messages, {
        ...nextMessage,
        parts: donor.parts,
        createdAt: nextMessage.createdAt ?? donor.createdAt,
      })
    }
  }

  if (messages.some((m) => m.id === nextMessage.id)) {
    return messages.map((m) => (m.id === nextMessage.id ? nextMessage : m))
  }
  if (assistantId && assistantId !== nextMessage.id) {
    const matched = messages.some(
      (m) => m.id === assistantId && m.role === "assistant"
    )
    if (matched) {
      return messages.map((m) =>
        m.id === assistantId && m.role === "assistant" ? nextMessage : m
      )
    }
  }
  return [...messages, nextMessage]
}

export function applyChatStreamEvent(
  transition: ChatStreamTransition,
  event: ChatStreamEvent
): ChatStreamTransition {
  if (event.type === "start") {
    const alreadyPresent = transition.snapshot.messages.some(
      (message) => message.id === event.id && message.role === "assistant"
    )
    return {
      assistantId: event.id,
      snapshot: {
        ...transition.snapshot,
        activityLabel: event.sessionReset
          ? "Started a fresh Pi session"
          : event.diagnostics?.[0],
        messages: alreadyPresent
          ? transition.snapshot.messages
          : [
              ...transition.snapshot.messages,
              createTextMessage("assistant", "", event.id),
            ],
        sessionMetadata: {
          sessionFile: event.sessionFile,
          sessionId: event.sessionId,
        },
      },
    }
  }

  const reconciled =
    event.type === "delta" || event.type === "thinking" || event.type === "tool"
      ? reconcileAssistantId(transition, event.messageId)
      : transition
  const { assistantId, snapshot } = reconciled

  if (event.type === "delta" && assistantId) {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        messages: appendAssistantDelta(
          snapshot.messages,
          assistantId,
          event.text
        ),
      },
    }
  }

  if (event.type === "thinking" && assistantId) {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        messages: upsertAssistantThinkingPart(
          snapshot.messages,
          assistantId,
          event.text
        ),
      },
    }
  }

  if (event.type === "tool" && assistantId) {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        messages: upsertAssistantToolPart(
          snapshot.messages,
          assistantId,
          event.part
        ),
      },
    }
  }

  if (event.type === "queue") {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        queue: { steering: event.steering, followUp: event.followUp },
      },
    }
  }

  if (event.type === "plan") {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        planLabel: event.message,
      },
    }
  }

  if (event.type === "state") {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        activityLabel: labelForState(event.state.name),
      },
    }
  }

  if (event.type === "compaction") {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        activityLabel:
          event.phase === "start"
            ? "Compacting session"
            : "Compaction finished",
      },
    }
  }

  if (event.type === "retry") {
    return {
      assistantId,
      snapshot: {
        ...snapshot,
        activityLabel:
          event.phase === "start"
            ? `Retrying request ${event.attempt}/${event.maxAttempts}`
            : event.success
              ? "Retry succeeded"
              : "Retry failed",
      },
    }
  }

  if (event.type === "done") {
    return {
      assistantId: null,
      snapshot: {
        ...snapshot,
        activityLabel: undefined,
        messages: replaceOrAppendInFlight(
          snapshot.messages,
          event.message,
          assistantId
        ),
        queue: EMPTY_QUEUE_STATE,
        sessionMetadata: {
          sessionFile: event.sessionFile,
          sessionId: event.sessionId,
        },
      },
    }
  }

  return reconciled
}
