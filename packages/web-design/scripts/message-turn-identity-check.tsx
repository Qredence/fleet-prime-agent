import assert from "node:assert/strict"

import { isValidElement } from "react"
import {
  buildAssistantElements,
  getAssistantToolElementKey,
} from "../src/components/agent-elements/message-turns"

const noIdTask = { type: "tool-Task" }

assert.equal(
  getAssistantToolElementKey("message-1", noIdTask, 0),
  "message-1:tool:tool-Task:0"
)
assert.equal(
  getAssistantToolElementKey("message-1", noIdTask, 1),
  "message-1:tool:tool-Task:1"
)
assert.equal(
  getAssistantToolElementKey(
    "message-1",
    { type: "tool-Task", toolCallId: "call-42" },
    0
  ),
  "call-42"
)

const renderedElements = buildAssistantElements(
  [
    { type: "tool-Task" },
    { type: "tool-Question" },
    { type: "tool-TaskOutput" },
    { type: "tool-Task", toolCallId: "parent" },
    { type: "tool-Read", toolCallId: "parent:child" },
    { type: "tool-Task" },
    { type: "tool-Read" },
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

assert.deepEqual(
  renderedElements.filter(isValidElement).map((element) => element.key),
  [
    "message-1:tool:tool-Task:0",
    "parent",
    "message-1:tool:tool-Task:1",
    "message-1:tool:tool-Read:0",
  ]
)

console.log("Message turn identity checks passed.")
