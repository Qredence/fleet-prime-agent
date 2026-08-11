import assert from "node:assert/strict"

import { getAssistantToolElementKey } from "../src/components/agent-elements/message-turns"

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

console.log("Message turn identity checks passed.")
