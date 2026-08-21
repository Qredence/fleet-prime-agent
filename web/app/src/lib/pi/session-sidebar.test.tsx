import { fireEvent, render } from "@testing-library/react"
import type { ChatSessionInfo, ProjectSummary } from "@prime-agent/web-protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FleetSessionSidebar } from "@prime-agent/web-design/components/fleet-pi/session-sidebar"
import { AnimatedSidebarProvider } from "@prime-agent/web-design/components/motion/animated-sidebar"

function project(projectId: string): ProjectSummary {
  return {
    projectId,
    name: projectId,
    pathLabel: `/workspace/${projectId}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sessionCount: 1,
    status: "active",
  }
}

function session(sessionId: string, projectId: string): ChatSessionInfo {
  return {
    sessionId,
    projectId,
    title: sessionId,
    firstMessage: sessionId,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "idle",
    messageCount: 1,
  }
}

describe("FleetSessionSidebar project rows", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("toggles a project without selecting it or opening a session", () => {
    const onNewSession = vi.fn()
    const onNewSessionInProject = vi.fn()
    const onProjectSelect = vi.fn()
    const { getByRole } = render(
      <AnimatedSidebarProvider>
        <FleetSessionSidebar
          sessions={[]}
          projects={[project("alpha"), project("beta")]}
          projectSessions={[session("alpha-session", "alpha"), session("beta-session", "beta")]}
          activeProjectId="alpha"
          onNewSession={onNewSession}
          onNewSessionInProject={onNewSessionInProject}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onProjectSelect={onProjectSelect}
        />
      </AnimatedSidebarProvider>,
    )

    const beta = getByRole("treeitem", { name: /beta/i })
    expect(beta.getAttribute("aria-expanded")).toBe("false")

    fireEvent.click(beta)

    expect(beta.getAttribute("aria-expanded")).toBe("true")
    expect(onNewSession.mock.calls.length).toBe(0)
    expect(onNewSessionInProject.mock.calls.length).toBe(0)
    expect(onProjectSelect.mock.calls.length).toBe(0)
  })
})
