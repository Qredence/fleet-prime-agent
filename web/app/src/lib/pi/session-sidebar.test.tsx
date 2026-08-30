import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type {
  ChatSessionInfo,
  ProjectDirectoryBrowseResponse,
  ProjectSummary,
} from "@prime-agent/web-protocol"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FleetSessionSidebar } from "@prime-agent/web-design/components/product/fleet-pi/session-sidebar"
import type { FleetSessionSidebarDependencies } from "@prime-agent/web-design/components/product/fleet-pi/session-sidebar/types"
import { AnimatedSidebarProvider } from "@prime-agent/web-design/components/registry/beui/motion/animated-sidebar"

function SidebarHarness({
  sessions,
  projects,
  projectSessions,
  activeProjectId,
  activeSessionId,
  onNewSession,
  onNewSessionInProject,
  onResumeSession,
  onRenameSession,
  onDeleteSession,
  onProjectSelect,
  onCreateProject,
  onRenameProject,
  onUnregisterProject,
  onForkSessionIntoProject,
  onOpenPanelAction,
  onBrowseDirectories,
  onOpenSettings,
  accountMenu,
}: FleetSessionSidebarDependencies) {
  return (
    <FleetSessionSidebar
      data={{ sessions, projects, projectSessions, activeProjectId, activeSessionId }}
      sessionActions={{
        onNewSession,
        onNewSessionInProject,
        onResumeSession,
        onRenameSession,
        onDeleteSession,
      }}
      projectActions={{
        onProjectSelect,
        onCreateProject,
        onRenameProject,
        onUnregisterProject,
        onForkSessionIntoProject,
      }}
      navigationActions={{ onOpenPanelAction, onBrowseDirectories, onOpenSettings }}
      slots={{ accountMenu }}
    />
  )
}

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
        <SidebarHarness
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

  it("redacts credentials from session labels and accessible names", () => {
    const exposedSecret = "sk-examplecredential123456789"
    const sensitiveSession = session("sensitive-session", "alpha")
    sensitiveSession.title = `Configure API key ${exposedSecret}`
    sensitiveSession.firstMessage = sensitiveSession.title

    const { container, getByRole } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[sensitiveSession]}
          projects={[project("alpha")]}
          projectSessions={[sensitiveSession]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </AnimatedSidebarProvider>,
    )

    expect(container.textContent).not.toContain(exposedSecret)
    expect(container.innerHTML).not.toContain(exposedSecret)
    expect(getByRole("treeitem", { name: /Configure API key \[redacted\]/i })).toBeTruthy()
  })

  it("makes the selected directory and child paths explicit", async () => {
    const root: ProjectDirectoryBrowseResponse = {
      pathLabel: "~/workspace",
      directoryToken: "root-token",
      parentToken: null,
      entries: [
        {
          directoryToken: "child-token",
          name: "prime-agent",
          pathLabel: "~/workspace/prime-agent",
          hasChildren: true,
        },
      ],
    }
    const child: ProjectDirectoryBrowseResponse = {
      pathLabel: "~/workspace/prime-agent",
      directoryToken: "child-token",
      parentToken: "root-token",
      entries: [],
    }
    const browseDirectories = vi.fn(async (input: { token?: string }) =>
      input.token ? child : root,
    )

    const { getByRole, getByText } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[]}
          projects={[project("alpha")]}
          projectSessions={[]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onCreateProject={vi.fn()}
          onBrowseDirectories={browseDirectories}
        />
      </AnimatedSidebarProvider>,
    )

    fireEvent.click(getByRole("button", { name: /^Add project$/ }))
    await waitFor(() => expect(browseDirectories).toHaveBeenCalledWith({}))
    expect(getByText("Selected directory")).toBeTruthy()
    expect(getByText("~/workspace", { exact: true })).toBeTruthy()

    fireEvent.click(getByRole("combobox", { name: "Search child directories" }))
    fireEvent.click(getByRole("option", { name: /prime-agent/ }))
    await waitFor(() =>
      expect(browseDirectories).toHaveBeenLastCalledWith({ token: "child-token" }),
    )
    expect(getByText("~/workspace/prime-agent", { exact: true })).toBeTruthy()
  })

  it("keeps browse failures visible and offers a retry", async () => {
    const browseDirectories = vi
      .fn()
      .mockRejectedValue(new Error("Directory service unavailable"))

    const { getByRole, getByText } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[]}
          projects={[project("alpha")]}
          projectSessions={[]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onCreateProject={vi.fn()}
          onBrowseDirectories={browseDirectories}
        />
      </AnimatedSidebarProvider>,
    )

    fireEvent.click(getByRole("button", { name: /^Add project$/ }))
    await waitFor(() => expect(getByText("Directory service unavailable")).toBeTruthy())
    expect(getByRole("button", { name: "Try again" })).toBeTruthy()

    fireEvent.click(getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(browseDirectories).toHaveBeenCalledTimes(2))
  })

  it("keeps the dialog open when project registration fails", async () => {
    const createProject = vi
      .fn()
      .mockRejectedValue(new Error("Project is already registered"))

    const { getByRole, getByText } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[]}
          projects={[project("alpha")]}
          projectSessions={[]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onCreateProject={createProject}
        />
      </AnimatedSidebarProvider>,
    )

    fireEvent.click(getByRole("button", { name: /^Add project$/ }))
    fireEvent.change(getByRole("textbox", { name: "Project directory" }), {
      target: { value: "/workspace/alpha" },
    })
    const dialog = getByRole("dialog", { name: "Add project" })
    fireEvent.click(within(dialog).getByRole("button", { name: /^Add project$/ }))

    await waitFor(() => expect(getByText("Project is already registered")).toBeTruthy())
    expect(getByRole("dialog", { name: "Add project" })).toBeTruthy()
    expect(createProject).toHaveBeenCalledTimes(1)
  })
})

describe("FleetSessionSidebar empty projects", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("offers a Start first chat action for projects without sessions", () => {
    const onNewSessionInProject = vi.fn()
    const { getByRole } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[]}
          projects={[project("alpha")]}
          projectSessions={[]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onNewSessionInProject={onNewSessionInProject}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </AnimatedSidebarProvider>,
    )

    fireEvent.click(getByRole("treeitem", { name: "Start first chat" }))
    expect(onNewSessionInProject).toHaveBeenCalledWith("alpha")
  })

  it("falls back to selecting the project and opening a new session without onNewSessionInProject", () => {
    const onNewSession = vi.fn()
    const onProjectSelect = vi.fn()
    const { getByRole } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[]}
          projects={[project("alpha")]}
          projectSessions={[]}
          activeProjectId="alpha"
          onNewSession={onNewSession}
          onProjectSelect={onProjectSelect}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </AnimatedSidebarProvider>,
    )

    fireEvent.click(getByRole("treeitem", { name: "Start first chat" }))
    expect(onProjectSelect).toHaveBeenCalledWith("alpha")
    expect(onNewSession).toHaveBeenCalledTimes(1)
  })
})

describe("FleetSessionSidebar fork dialog", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("uses a design-system select and forks into another project", async () => {
    const onForkSessionIntoProject = vi.fn()
    render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[]}
          projects={[project("alpha"), project("beta")]}
          projectSessions={[session("s1", "alpha")]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
          onForkSessionIntoProject={onForkSessionIntoProject}
        />
      </AnimatedSidebarProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Actions for s1" }))
    fireEvent.click(await screen.findByText("Fork into project"))

    const dialog = await screen.findByRole("dialog", { name: "Fork session into project" })
    // The fork target picker is the design-system Select, not a native element.
    expect(dialog.querySelector("select")).toBeNull()
    const targetPicker = within(dialog).getByRole("combobox", { name: "Target project" })
    expect(targetPicker.textContent).toContain("beta — /workspace/beta")

    fireEvent.click(within(dialog).getByRole("button", { name: "Fork session" }))
    expect(onForkSessionIntoProject).toHaveBeenCalledWith("s1", "beta")
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Fork session into project" })).toBeNull(),
    )
  })
})

describe("FleetSessionSidebar draft sessions", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function draftSession(sessionId: string, projectId: string): ChatSessionInfo {
    return {
      ...session(sessionId, projectId),
      title: "(no messages)",
      firstMessage: "",
      messageCount: 0,
    }
  }

  it("hides message-less sessions from the project tree", () => {
    const { queryByRole, getByRole } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[session("messaged-chat", "alpha"), draftSession("draft-chat", "alpha")]}
          projects={[project("alpha")]}
          projectSessions={[session("messaged-chat", "alpha"), draftSession("draft-chat", "alpha")]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </AnimatedSidebarProvider>,
    )

    expect(queryByRole("treeitem", { name: /draft-chat/i })).toBeNull()
    expect(getByRole("treeitem", { name: /messaged-chat/i })).toBeTruthy()
  })

  it("keeps the active message-less session visible while composing", () => {
    const { getByRole } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[draftSession("draft-chat", "alpha")]}
          projects={[project("alpha")]}
          projectSessions={[draftSession("draft-chat", "alpha")]}
          activeProjectId="alpha"
          activeSessionId="draft-chat"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </AnimatedSidebarProvider>,
    )

    expect(getByRole("treeitem", { name: /\(no messages\)/i })).toBeTruthy()
  })

  it("offers Start first chat when a project only has message-less sessions", () => {
    const { getByRole } = render(
      <AnimatedSidebarProvider>
        <SidebarHarness
          sessions={[draftSession("draft-chat", "alpha")]}
          projects={[project("alpha")]}
          projectSessions={[draftSession("draft-chat", "alpha")]}
          activeProjectId="alpha"
          onNewSession={vi.fn()}
          onResumeSession={vi.fn()}
          onRenameSession={vi.fn()}
          onDeleteSession={vi.fn()}
        />
      </AnimatedSidebarProvider>,
    )

    expect(getByRole("treeitem", { name: "Start first chat" })).toBeTruthy()
  })
})
