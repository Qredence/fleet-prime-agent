import { strict as assert } from "node:assert"
import { sessionAgentPlanPresentation } from "@/components/tools/session-agent-plan"

const pending = [
  { id: "1", title: "Inspect the request", status: "pending" as const },
  { id: "2", title: "Build the change", status: "pending" as const },
]

assert.deepEqual(sessionAgentPlanPresentation(pending), {
  steps: ["Inspect the request", "Build the change"],
  activeIndex: 0,
})

assert.deepEqual(
  sessionAgentPlanPresentation([
    { id: "1", title: "Inspect the request", status: "completed" },
    { id: "2", title: "Build the change", status: "in_progress" },
    { id: "3", title: "Validate the result", status: "pending" },
  ]),
  {
    steps: ["Inspect the request", "Build the change", "Validate the result"],
    activeIndex: 1,
  },
)

assert.deepEqual(
  sessionAgentPlanPresentation([
    { id: "1", title: "Inspect the request", status: "completed" },
    { id: "2", title: "Build the change", status: "completed" },
  ]),
  {
    steps: ["Inspect the request", "Build the change"],
    activeIndex: 2,
  },
)

assert.equal(
  sessionAgentPlanPresentation([
    { id: "1", title: "Inspect the request", status: "pending" },
    { id: "2", title: "Build the change", status: "completed" },
  ]),
  undefined,
)

assert.equal(
  sessionAgentPlanPresentation([{ id: "1", title: "   ", status: "pending" }]),
  undefined,
)

console.log("Fleet Agent Plan adapter checks passed.")
