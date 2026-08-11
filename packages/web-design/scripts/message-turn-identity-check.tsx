import assert from "node:assert/strict"

import { isValidElement } from "react"
import {
  buildAssistantElements,
  getAssistantToolElementKey,
} from "../src/components/agent-elements/message-turns"

const noIdTask = { type: "tool-Task" }

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
    "unkeyed-tool:message-1:tool-Task:0",
    "tool-call:unkeyed-tool:message-1:tool-Task:0",
    "tool-call:parent",
    "unkeyed-tool:message-1:tool-Task:1",
    "unkeyed-tool:message-1:tool-Read:0",
  ]
)

console.log("Message turn identity checks passed.")
