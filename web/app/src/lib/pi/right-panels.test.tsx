import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type {
	ChatSessionResponse,
	PrimeAgentArtifactRun,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol"
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types"
import { describe, expect, it, vi } from "vitest"
import { RightPanelLauncher } from "@prime-agent/web-design/components/product/fleet-pi/pi/right-panel-launcher"
import { ReplPanelContent } from "@prime-agent/web-design/components/product/fleet-pi/pi/repl-panel"
import { SubagentsPanelContent } from "@prime-agent/web-design/components/product/fleet-pi/pi/subagents-panel"

vi.mock("@prime-agent/web-design/components/product/fleet-pi/chat/generative-text-renderer", () => ({
	FleetGenerativeTextRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}))
vi.mock("@prime-agent/web-design/components/product/fleet-pi/chat/fleet-pi-tool-renderer", () => ({
	FleetPiToolRenderer: () => null,
}))

const emptyPresentation: PrimeAgentSessionPresentation = {
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
	artifactRuns: [],
}

describe("right-panel execution tabs", () => {
	it("exposes REPL and Subagents tabs with live badges", () => {
		const onPanelChange = vi.fn()
		render(
			<RightPanelLauncher
				activePanel={null}
				onPanelChange={onPanelChange}
				resources={null}
				replRuns={2}
				subagents={1}
				technicalArtifacts={0}
				workspace={null}
			/>,
		)

		const repl = screen.getByRole("tab", { name: "REPL runs" })
		const subagents = screen.getByRole("tab", { name: "Subagents" })
		expect(repl).toBeTruthy()
		expect(subagents).toBeTruthy()
		expect(repl.textContent).toContain("2")
		expect(subagents.textContent).toContain("1")

		fireEvent.click(repl)
		expect(onPanelChange).toHaveBeenCalledWith("repl")
		fireEvent.click(subagents)
		expect(onPanelChange).toHaveBeenCalledWith("subagents")
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
})
