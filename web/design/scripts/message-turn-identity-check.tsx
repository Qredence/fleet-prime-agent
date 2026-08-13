import assert from "node:assert/strict"

import { isValidElement } from "react"
import {
  AssistantTurn,
  buildAssistantElements,
  getAssistantToolElementKey,
  UserTurn,
} from "../src/components/agent-elements/message-turns"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"

const noIdTask = { type: "tool-Task" }
const compatibilityMessage = { id: "compatibility-message" } as ChatMessage

// These flat prop shapes were public before the grouped internal contract.
// Keep them type-checked so package consumers do not lose source compatibility.
void (
  <UserTurn
    message={compatibilityMessage}
    UserMessageComponent={() => null}
    enableImagePreview
    showCopyToolbar
    isMounted
    isCopyVisible={false}
    onCopied={() => {}}
  />
)
void (
  <AssistantTurn
    assistantMsgs={[compatibilityMessage]}
    turnKey="compatibility-turn"
    isLastTurn
    isStreaming={false}
    showCopyToolbar
    suppressQuestionTool={false}
    ToolRendererComponent={() => null}
    TextRendererComponent={() => null}
    isCopyVisible={false}
    onCopied={() => {}}
  />
)

assert.equal(
  getAssistantToolElementKey("message-1", noIdTask, 0),
  "unkeyed-tool:message-1:tool-Task:0"
)
assert.equal(
  getAssistantToolElementKey("message-1", noIdTask, 1),
  "unkeyed-tool:message-1:tool-Task:1"
)
assert.equal(
  getAssistantToolElementKey(
    "message-1",
    { type: "tool-Task", toolCallId: "" },
    0
  ),
  "unkeyed-tool:message-1:tool-Task:0"
)
assert.equal(
  getAssistantToolElementKey(
    "message-1",
    { type: "tool-Task", toolCallId: "call-42" },
    0
  ),
  "tool-call:call-42"
)

const renderedElements = buildAssistantElements(
  [
    { type: "tool-Task" },
    {
      type: "tool-Read",
      toolCallId: "unkeyed-tool:message-1:tool-Task:0",
    },
    { type: "tool-Question" },
    { type: "tool-TaskOutput" },
    { type: "tool-Task", toolCallId: "parent" },
    { type: "tool-Read", toolCallId: "parent:child" },
    { type: "tool-Task" },
    { type: "tool-Read" },
    { type: "tool-Task", toolCallId: "" },
    { type: "tool-Task", toolCallId: "" },
  ],
  {
    messageId: "message-1",
    isLast: false,
    isStreaming: false,
    suppressQuestionTool: true,
    ToolRendererComponent: () => null,
    TextRendererComponent: () => null,
  }
)

const renderedElementKeys = renderedElements
  .filter(isValidElement)
  .map((element) => element.key)

assert.equal(
  new Set(renderedElementKeys).size,
  renderedElementKeys.length,
  "Rendered assistant elements must have unique React keys."
)

assert.deepEqual(
  renderedElementKeys,
  [
    "unkeyed-tool:message-1:tool-Task:0",
    "tool-call:unkeyed-tool:message-1:tool-Task:0",
    "tool-call:parent",
    "unkeyed-tool:message-1:tool-Task:1",
    "unkeyed-tool:message-1:tool-Read:0",
    "unkeyed-tool:message-1:tool-Task:2",
    "unkeyed-tool:message-1:tool-Task:3",
  ]
)

console.log("Message turn identity checks passed.")
