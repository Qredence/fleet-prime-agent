import { fireEvent, render, screen } from "@testing-library/react"
import {
  RightPanelLauncher,
  RightPanelTrigger,
} from "@prime-agent/web-design/components/product/fleet-pi/pi/right-panel-launcher"
import { SessionInsightsPanel } from "@prime-agent/web-design/components/product/fleet-pi/pi/session-insights-panel"
import { deriveSessionInsights } from "@prime-agent/web-design/components/product/fleet-pi/pi/session-insights"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"
import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol"
import { describe, expect, it, vi } from "vitest"

const presentation: PrimeAgentSessionPresentation = {
  revision: 1,
  goal: {
    active: true,
    status: "active",
    objective: "Validate the session insights panel",
    tokenBudget: 1000,
    tokensUsed: 250,
    timeUsedSeconds: 90,
    continuationsUsed: 1,
  },
  userBash: [
    {
      id: "bash-1",
      runId: "run-1",
      command: "npm run check",
      output: "ok",
      status: "success",
      cancelled: false,
      truncated: false,
      excludeFromContext: false,
      startedAt: 1,
    },
  ],
  rlmChildren: [
    { id: "child-1", label: "Inspect UI", status: "running", timestamp: 1 },
    { id: "child-2", label: "Summarize", status: "done", timestamp: 2 },
  ],
  refinements: [
    {
      id: "refinement-1",
      summary: "Tighten copy",
      rationale: "Clearer status",
      expectedOutcome: "More useful panel",
      edits: [],
      status: "success",
      timestamp: 1,
    },
  ],
  artifactRuns: [],
}

const messages: Array<ChatMessage> = [
  { id: "user-1", role: "user", parts: [{ type: "text", text: "Review this" }] },
  { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Working" }] },
]

describe("SessionInsightsPanel", () => {
  it("derives live goal, queue, and progress facts without a model request", () => {
    const insights = deriveSessionInsights({
      activityLabel: "Inspecting current state",
      artifactRuns: [
        {
          id: "run-1",
          runId: "run-1",
          artifacts: [
            {
              id: "ipython-1",
              runId: "run-1",
              kind: "ipython",
              title: "Inspect data",
              status: "success",
              timestamp: 1,
            },
          ],
        },
      ],
      messages,
      presentation,
      queue: { steering: ["Clarify"], followUp: ["Report"] },
    })

    expect(insights).toMatchObject({
      activity: "Inspecting current state",
      artifactCount: 1,
      assistantMessages: 1,
      bashCommands: 1,
      ipythonCells: 1,
      queuedFollowUps: 1,
      queuedSteering: 1,
      refinements: { successful: 1, failed: 0, total: 1 },
      rlmChildren: { running: 1, done: 1 },
      userMessages: 1,
    })
  })

  it.each([
    ["budget_limited", true],
    ["complete", false],
  ] as const)("retains a %s goal state for the active session", (status, active) => {
    const insights = deriveSessionInsights({
      artifactRuns: [],
      messages: [],
      presentation: {
        ...presentation,
        goal: { ...presentation.goal!, active, status },
      },
      queue: { steering: [], followUp: [] },
    })

    expect(insights.goal).toMatchObject({ active, status })
  })

  it("renders the selected session's live insight sections and existing recap", () => {
    render(
      <SessionInsightsPanel
        activityLabel="Inspecting current state"
        artifactRuns={[]}
        chatMode="agent"
        messages={messages}
        presentation={{ ...presentation, recap: "The current session is on track." }}
        queue={{ steering: ["Clarify"], followUp: [] }}
        selectedModelKey="openai/gpt-5.6"
        sessionId="session-1"
        status="streaming"
        thinkingLevel="high"
      />,
    )

    expect(screen.getByRole("region", { name: "Session insights" })).toBeTruthy()
    expect(screen.getByText("Current state")).toBeTruthy()
    expect(screen.getByText("Run status")).toBeTruthy()
    expect(screen.getByText("Queued steering")).toBeTruthy()
    expect(screen.getByText("Queued follow-ups")).toBeTruthy()
    expect(screen.getByText("Token budget")).toBeTruthy()
    expect(screen.getByText("Validate the session insights panel")).toBeTruthy()
    expect(screen.getByText("The current session is on track.")).toBeTruthy()
    expect(screen.getByText("streaming")).toBeTruthy()
  })

  it("shows an empty state until a session is selected", () => {
    render(
      <SessionInsightsPanel
        artifactRuns={[]}
        chatMode="agent"
        messages={[]}
        presentation={{ ...presentation, goal: undefined }}
        queue={{ steering: [], followUp: [] }}
        status="ready"
      />,
    )

    expect(screen.getByText("Start or open a session to view its live insights.")).toBeTruthy()
  })

  it("does not invent a recap when the presentation has none", () => {
    render(
      <SessionInsightsPanel
        artifactRuns={[]}
        chatMode="agent"
        messages={[]}
        presentation={{ ...presentation, goal: undefined, recap: undefined }}
        queue={{ steering: [], followUp: [] }}
        sessionId="session-1"
        status="ready"
      />,
    )

    expect(screen.queryByText("Existing recap")).toBeNull()
    expect(screen.queryByText("Summary")).toBeNull()
  })

  it("adds Session insights to the existing right-panel tabs", () => {
    const onPanelChange = vi.fn()
    render(
      <RightPanelLauncher
        activePanel={null}
        onPanelChange={onPanelChange}
        resources={null}
        workspace={null}
      />,
    )

    fireEvent.click(screen.getByRole("tab", { name: "Session insights" }))
    expect(onPanelChange).toHaveBeenCalledWith("session-insights")
  })

  it("provides an accessible collapsed side-panel trigger", () => {
    const onOpen = vi.fn()
    render(<RightPanelTrigger onOpen={onOpen} />)

    const trigger = screen.getByRole("button", { name: "Open side panel" })
    expect(trigger.getAttribute("title")).toBe("Open side panel")
    fireEvent.click(trigger)

    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
