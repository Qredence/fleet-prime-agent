import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type {
  ChatSessionResponse,
  PrimeAgentArtifactRun,
  PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ArtifactsPanelContent } from "@prime-agent/web-design/components/product/fleet-pi/pi/artifacts-panel"
import { RightPanelLauncher } from "@prime-agent/web-design/components/product/fleet-pi/pi/right-panel-launcher"
import { ReplPanelContent } from "@prime-agent/web-design/components/product/fleet-pi/pi/repl-panel"
import { SubagentsPanelContent } from "@prime-agent/web-design/components/product/fleet-pi/pi/subagents-panel"
import { useChatShellState } from "./use-chat-shell-state"

vi.mock("@prime-agent/web-design/components/product/fleet-pi/chat/generative-text-renderer", () => ({
	FleetGenerativeTextRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))
vi.mock("@prime-agent/web-design/components/product/fleet-pi/chat/fleet-pi-tool-renderer", () => ({
  FleetPiToolRenderer: () => null,
}))
vi.mock("@prime-agent/web-design/components/openui/inline-renderer", () => ({
  GenerativeTextRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))

const emptyPresentation: PrimeAgentSessionPresentation = {
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
  artifactRuns: [],
}

let notifyResize: (() => void) | undefined

function ChatShellStateProbe() {
	const { openArtifact, rightPanel, selectedArtifactId } = useChatShellState(undefined, {
		sessionMetadata: {},
		setSessionMetadata: vi.fn(),
	})

	return (
		<div>
			<button type="button" onClick={() => openArtifact("repl-1", "repl")}>
				Open REPL cell
			</button>
			<span data-testid="probe-panel">{rightPanel ?? "closed"}</span>
			<span data-testid="probe-selection">{selectedArtifactId ?? "none"}</span>
		</div>
	)
}

function mockLauncherLayout(availableWidth: number, requiredWidth: number) {
  const observers = new Set<TestResizeObserver>()

  class TestResizeObserver {
    readonly callback: ResizeObserverCallback

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
      observers.add(this)
    }

    observe() {}

    unobserve() {}

    disconnect() {
      observers.delete(this)
    }
  }

  vi.stubGlobal("ResizeObserver", TestResizeObserver)
  notifyResize = () => {
    for (const observer of observers) observer.callback([], observer)
  }

  return (launcher: HTMLElement) => {
    const measurement = launcher.querySelector<HTMLElement>("[data-panel-launcher-measurement]")
    expect(measurement).not.toBeNull()
    Object.defineProperty(launcher, "clientWidth", {
      configurable: true,
      value: availableWidth,
    })
    if (launcher.parentElement) {
      Object.defineProperty(launcher.parentElement, "clientWidth", {
        configurable: true,
        value: availableWidth,
      })
    }
    if (measurement) {
      vi.spyOn(measurement, "getBoundingClientRect").mockReturnValue({
        width: requiredWidth,
      } as DOMRect)
    }
    act(() => notifyResize?.())
  }
}

afterEach(() => {
  notifyResize = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("right-panel execution tabs", () => {
  it("exposes all registry panels in fit-mode tabs and toggles the active panel closed", () => {
    const onPanelChange = vi.fn()
    const layout = mockLauncherLayout(500, 400)
    const { getByTestId, rerender } = render(
      <RightPanelLauncher
        activePanel={null}
        onPanelChange={onPanelChange}
        resources={null}
        replRuns={2}
        sessionBlocks={1}
        subagents={1}
        openUIArtifacts={2}
        workspace={null}
      />,
    )
    layout(getByTestId("right-panel-inline-launcher"))

    expect(getByTestId("right-panel-inline-launcher").getAttribute("data-panel-launcher-mode")).toBe("tabs")
    expect(screen.getAllByRole("tab")).toHaveLength(6)

    const repl = screen.getByRole("tab", { name: "REPL runs" })
    const subagents = screen.getByRole("tab", { name: "Subagents" })
    expect(repl).toBeTruthy()
    expect(subagents).toBeTruthy()
    expect(repl.textContent).toContain("2")
    expect(subagents.textContent).toContain("1")
    expect(screen.getByRole("tab", { name: "Artifacts" }).textContent).toContain("3")

    fireEvent.click(repl)
    expect(onPanelChange).toHaveBeenCalledWith("repl")

    rerender(
      <RightPanelLauncher
        activePanel="subagents"
        onPanelChange={onPanelChange}
        resources={null}
        workspace={null}
      />,
    )
    layout(getByTestId("right-panel-inline-launcher"))
    fireEvent.click(screen.getByRole("tab", { name: "Subagents" }))
    expect(onPanelChange).toHaveBeenLastCalledWith(null)
  })

  it("exposes all registry panels in overflow-mode dropdown and closes on the active option", async () => {
    const onPanelChange = vi.fn()
    const layout = mockLauncherLayout(120, 400)
    const { getByRole, getByTestId, rerender } = render(
      <RightPanelLauncher
        activePanel="subagents"
        onPanelChange={onPanelChange}
        resources={null}
        workspace={null}
      />,
    )
    layout(getByTestId("right-panel-inline-launcher"))
    await waitFor(() =>
      expect(getByTestId("right-panel-inline-launcher").getAttribute("data-panel-launcher-mode")).toBe("dropdown"),
    )

    const select = getByRole("combobox", { name: "Select panel" })
    fireEvent.click(select)
    const options = await screen.findAllByRole("option")
    expect(options).toHaveLength(6)
    expect(options.map((option) => option.textContent?.trim())).toEqual([
      "Resources",
      "Workspace",
      "Artifacts",
      "REPL",
      "Subagents",
      "Session insights",
    ])

    const replOption = getByRole("option", { name: "REPL" })
    fireEvent.pointerDown(replOption, { pointerType: "mouse" })
    fireEvent.click(replOption)
    expect(onPanelChange).toHaveBeenCalledWith("repl")

    rerender(
      <RightPanelLauncher
        activePanel="subagents"
        onPanelChange={onPanelChange}
        resources={null}
        workspace={null}
      />,
    )
    layout(getByTestId("right-panel-inline-launcher"))
    fireEvent.click(getByRole("combobox", { name: "Select panel" }))
    const subagentsOption = getByRole("option", { name: "Subagents" })
    fireEvent.pointerDown(subagentsOption, { pointerType: "mouse" })
    fireEvent.click(subagentsOption)
    expect(onPanelChange).toHaveBeenLastCalledWith(null)
  })

  it("counts and renders OpenUI and technical artifacts with session UI blocks", () => {
    const artifactRuns: Array<PrimeAgentArtifactRun> = [
      {
        id: "run-1",
        runId: "run-1",
        artifacts: [
          {
            id: "openui-1",
            runId: "run-1",
            kind: "openui-html",
            title: "Generated dashboard",
            status: "success",
            output: { title: "Generated dashboard", document: "<div>Dashboard</div>" },
            timestamp: 1,
          },
          {
            id: "ipython-1",
            runId: "run-1",
            kind: "ipython",
            title: "IPython",
            status: "success",
            input: { code: "print('hello')" },
            output: { stdout: "hello" },
            timestamp: 2,
          },
          {
            id: "diff-1",
            runId: "run-1",
            kind: "diff",
            title: "Edit",
            status: "error",
            output: { error: "permission denied" },
            timestamp: 3,
          },
        ],
      },
    ]
    const messages: Array<ChatMessage> = [
      {
        id: "assistant-ui",
        role: "assistant",
        parts: [{ type: "text", text: "```openui\nroot = Card\n```" }],
      },
    ]

    render(
      <ArtifactsPanelContent
        artifactRuns={artifactRuns}
        messages={messages}
        status="ready"
      />,
    )

    expect(screen.getByText("OpenUI artifacts")).toBeTruthy()
    expect(screen.getByText("Generated dashboard")).toBeTruthy()
    expect(screen.getByText("Generative UI")).toBeTruthy()
    expect(screen.getByText("Card")).toBeTruthy()
    expect(screen.getByText("Technical artifacts")).toBeTruthy()
    expect(screen.queryByText("print('hello')")).toBeNull()
    expect(screen.getByText("permission denied")).toBeTruthy()
  })

	it("renders recorded IPython cells in the REPL panel", () => {
		const artifactRuns: Array<PrimeAgentArtifactRun> = [
			{
				id: "run-1",
				runId: "run-1",
				artifacts: [
					{
						id: "repl-1",
						runId: "run-1",
						kind: "ipython",
						title: "IPython",
						status: "success",
						input: { code: "print('hello')" },
						output: { stdout: "hello" },
						timestamp: 1,
					},
				],
			},
		]

		render(<ReplPanelContent artifactRuns={artifactRuns} />)

		expect(screen.getByTestId("repl-run-list")).toBeTruthy()
		expect(screen.getByText("Cell 1")).toBeTruthy()
		expect(screen.getByText("print('hello')")).toBeTruthy()
		expect(screen.getByText("hello")).toBeTruthy()
	})

	it("focuses and scrolls to the selected REPL cell", async () => {
		const artifactRuns: Array<PrimeAgentArtifactRun> = [
			{
				id: "run-1",
				runId: "run-1",
				artifacts: [
					{
						id: "repl-1",
						runId: "run-1",
						kind: "ipython",
						title: "IPython",
						status: "success",
						input: { code: "print('selected')" },
						output: { stdout: "selected" },
						timestamp: 1,
					},
				],
			},
		]
		const scrollIntoView = vi.fn()
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		})

		render(<ReplPanelContent artifactRuns={artifactRuns} selectedArtifactId="repl-1" />)

		const selectedCell = await waitFor(() => {
			const cell = document.querySelector<HTMLElement>('[data-repl-run-id="repl-1"]')
			expect(document.activeElement).toBe(cell)
			return cell
		})
		expect(selectedCell).not.toBeNull()
		expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" })
	})

	it("preserves the selected cell when opening the REPL panel", () => {
		render(<ChatShellStateProbe />)

		fireEvent.click(screen.getByRole("button", { name: "Open REPL cell" }))

		expect(screen.getByTestId("probe-panel").textContent).toBe("repl")
		expect(screen.getByTestId("probe-selection").textContent).toBe("repl-1")
	})

	it("loads and renders the selected subagent's own transcript", async () => {
		const messages: Array<ChatMessage> = [
			{
				id: "child-user",
				role: "user",
				parts: [{ type: "text", text: "Inspect the worker task" }],
			},
			{
				id: "child-assistant",
				role: "assistant",
				parts: [{ type: "text", text: "Worker transcript loaded" }],
			},
		]
		const response: ChatSessionResponse = {
			session: { sessionId: "child-session" },
			messages,
			planPresentations: [],
			presentation: emptyPresentation,
		}
		const loadSession = vi.fn(async () => response)

		render(
			<SubagentsPanelContent
				agents={[
					{
						id: "child-1",
						label: "Research worker",
						status: "done",
						timestamp: 1,
					},
				]}
				parentSessionId="parent-session"
				loadSession={loadSession}
			/>,
		)

		await waitFor(() => expect(loadSession).toHaveBeenCalledWith("parent-session", "child-1"))
		expect(await screen.findByText("Worker transcript loaded")).toBeTruthy()
		expect(screen.getByRole("region", { name: "Subagent thread: Research worker" })).toBeTruthy()
	})

	it("reloads the selected transcript when a child advances", async () => {
		const loadSession = vi
			.fn<() => Promise<ChatSessionResponse>>()
			.mockResolvedValueOnce({
				session: { sessionId: "child-session" },
				messages: [{ id: "child-assistant-1", role: "assistant", parts: [{ type: "text", text: "Running snapshot" }] }],
				planPresentations: [],
				presentation: emptyPresentation,
			})
			.mockResolvedValueOnce({
				session: { sessionId: "child-session" },
				messages: [{ id: "child-assistant-2", role: "assistant", parts: [{ type: "text", text: "Completed snapshot" }] }],
				planPresentations: [],
				presentation: emptyPresentation,
			});
		const { rerender } = render(
			<SubagentsPanelContent
				agents={[{ id: "child-1", label: "Research worker", status: "running", timestamp: 1 }]}
				parentSessionId="parent-session"
				loadSession={loadSession}
			/>,
		);

		await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(1));
		expect(await screen.findByText("Running snapshot")).toBeTruthy();

		rerender(
			<SubagentsPanelContent
				agents={[{ id: "child-1", label: "Research worker", status: "done", timestamp: 2 }]}
				parentSessionId="parent-session"
				loadSession={loadSession}
			/>,
		);

		await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(2));
		expect(await screen.findByText("Completed snapshot")).toBeTruthy();
	})
})
