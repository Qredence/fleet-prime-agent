import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConversationTurnView } from "@prime-agent/web-design/components/product/fleet-pi/chat/fleet-pi-agent-chat"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"

const renderCounter = vi.hoisted(() => ({ userMessage: 0 }))

vi.mock("@prime-agent/web-design/components/registry/beui/agents/user-message", () => ({
  UserMessage: ({ message }: { message: ChatMessage }) => {
    renderCounter.userMessage += 1
    return <div>{message.id}</div>
  },
}))

describe("conversation turn rendering", () => {
  beforeEach(() => {
    renderCounter.userMessage = 0
  })

  it("does not rerender a completed turn while the active turn streams", () => {
    const completedMessage = {
      id: "completed-user",
      role: "user",
      parts: [{ type: "text", text: "Completed prompt" }],
    } as ChatMessage
    const completedTurn = { user: completedMessage, assistants: [] }
    const rendering = { toolRenderers: {} }
    const activity = {}
    const { rerender } = render(
      <>
        <ConversationTurnView
          turn={completedTurn}
          state={{ isLast: false, isStreaming: false, suppressQuestionTool: false }}
          rendering={rendering}
          activity={activity}
        />
        <div data-stream-update="1">active stream update</div>
      </>,
    )

    expect(renderCounter.userMessage).toBe(1)
    rerender(
      <>
        <ConversationTurnView
          turn={{ user: completedMessage, assistants: [] }}
          state={{ isLast: false, isStreaming: false, suppressQuestionTool: false }}
          rendering={rendering}
          activity={activity}
        />
        <div data-stream-update="2">active stream update</div>
      </>,
    )

    expect(renderCounter.userMessage).toBe(1)
  })
})
