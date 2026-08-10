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

export function applyChatStreamEvent(
  transition: ChatStreamTransition,
  event: ChatStreamEvent
): ChatStreamTransition {
  const { assistantId, snapshot } = transition

  if (event.type === "start") {
    return {
      assistantId: event.id,
      snapshot: {
        ...snapshot,
        activityLabel: event.sessionReset
          ? "Started a fresh Pi session"
          : event.diagnostics?.[0],
        messages: [
          ...snapshot.messages,
          createTextMessage("assistant", "", event.id),
        ],
        sessionMetadata: {
          sessionFile: event.sessionFile,
          sessionId: event.sessionId,
        },
      },
    }
  }

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
        messages: replaceOrAppendMessage(snapshot.messages, event.message),
        queue: EMPTY_QUEUE_STATE,
        sessionMetadata: {
          sessionFile: event.sessionFile,
          sessionId: event.sessionId,
        },
      },
    }
  }

  return transition
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
