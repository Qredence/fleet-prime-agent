import { fireEvent, render } from "@testing-library/react";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import type { PrimeAgentArtifactRun, PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it, vi } from "vitest";
import { ArtifactsPanelContent } from "@prime-agent/web-design/components/fleet-pi/pi/artifacts-panel";
import { FleetPiAgentChat } from "@prime-agent/web-design/components/fleet-pi/chat/fleet-pi-agent-chat";

vi.mock("@prime-agent/web-design/components/openui/inline-renderer", () => ({
	GenerativeTextRenderer: ({ onOpenUIAction }: { onOpenUIAction?: (message: string) => void }) => (
		<button type="button" onClick={() => onOpenUIAction?.("continue_conversation")}>Trigger OpenUI action</button>
	),
}));

const inputBar = {
	modelKey: undefined,
	models: [],
	onModelChange: vi.fn(),
};

function settledReasoningMessage(): ChatMessage {
	return {
		id: "assistant-1",
		role: "assistant",
		parts: [
			{
				type: "tool-FleetReasoning",
				state: "output-available",
				input: {
					runId: "run-1",
					phase: "complete",
					steps: [{ title: "Inspecting", body: "Checked the workspace." }],
					visibleSteps: 1,
					streaming: false,
					startedAt: 1,
					restingLabel: "Completed",
				},
			},
			{ type: "text", text: "Done." },
		],
	};
}

function presentation(
	overrides: Partial<PrimeAgentSessionPresentation> = {},
): PrimeAgentSessionPresentation {
	return {
		revision: 1,
		userBash: [],
		rlmChildren: [],
		refinements: [],
		artifactRuns: [],
		...overrides,
	};
}

describe("review regressions", () => {
	it("keeps completed reasoning presentation visible", () => {
		const { getByLabelText } = render(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={[settledReasoningMessage()]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);

		expect(getByLabelText("Safe reasoning progress")).toBeTruthy();
	});

	it("does not render legacy raw thinking parts", () => {
		const messages: Array<ChatMessage> = [
			{
				id: "assistant-live",
				role: "assistant",
				parts: [
					{
						type: "tool-Thinking",
						state: "output-available",
						input: { thought: "raw provider token" },
						output: "raw provider token",
					},
				],
			},
		];
		const { queryByText } = render(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={messages}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="streaming"
			/>,
		);
		expect(queryByText("raw provider token", { exact: true })).toBeNull();
	});

	it("submits Prime-compatible steering and follow-up messages while streaming", () => {
		const onSend = vi.fn();
		const onStop = vi.fn();
		const messages: Array<ChatMessage> = [
			{ id: "user-active", role: "user", parts: [{ type: "text", text: "Initial request" }] },
			{ id: "assistant-active", role: "assistant", parts: [{ type: "text", text: "Working" }] },
		];
		const { getByRole, rerender } = render(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={messages}
				onSend={onSend}
				onStop={onStop}
				status="streaming"
			/>,
		);
		const prompt = getByRole("textbox", { name: "Prompt" });

		fireEvent.click(getByRole("button", { name: "Stop generating" }));
		expect(onStop).toHaveBeenCalledOnce();
		fireEvent.change(prompt, { target: { value: "Adjust the current approach" } });
		expect(getByRole("button", { name: "Steer current run" })).toBeTruthy();
		fireEvent.keyDown(prompt, { key: "Enter" });
		expect(onSend).toHaveBeenLastCalledWith({
			role: "user",
			content: "Adjust the current approach",
			altKey: false,
		});

		fireEvent.change(prompt, { target: { value: "Then summarize the result" } });
		fireEvent.keyDown(prompt, { key: "Enter", altKey: true });
		expect(onSend).toHaveBeenLastCalledWith({
			role: "user",
			content: "Then summarize the result",
			altKey: true,
		});

		fireEvent.change(prompt, { target: { value: "Keep this line" } });
		fireEvent.keyDown(prompt, { key: "Enter", shiftKey: true });
		expect(onSend).toHaveBeenCalledTimes(2);

		rerender(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={messages}
				onSend={onSend}
				onStop={onStop}
				status="submitted"
			/>,
		);
		fireEvent.change(prompt, { target: { value: "Queue during admission" } });
		fireEvent.keyDown(prompt, { key: "Enter" });
		expect(onSend).toHaveBeenLastCalledWith({
			role: "user",
			content: "Queue during admission",
			altKey: false,
		});
	});

	it("renders activity after the assistant response and specialized tool content", () => {
		const messages: Array<ChatMessage> = [
			{
				id: "assistant-footer",
				role: "assistant",
				parts: [
					{ type: "text", text: "Final architecture summary" },
					{
						type: "tool-IPython",
						toolCallId: "footer-tool",
						state: "output-available",
						input: { code: "print('done')" },
						output: { stdout: "done" },
					},
				],
			},
		];
		const { getByRole, getByText } = render(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={messages}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);
		const answer = getByRole("button", { name: "Trigger OpenUI action" });
		const activity = getByRole("button", { name: "Completed 1 tracked action" });

		expect(answer.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
		expect(activity.getAttribute("aria-expanded")).toBe("false");
		expect(getByText("done", { exact: true })).toBeTruthy();
	});

	it("does not repeat completed session presentation records in later turns", () => {
		const messages: Array<ChatMessage> = [
			{ id: "user-1", role: "user", parts: [{ type: "text", text: "First turn" }] },
			{ id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "First answer" }] },
			{ id: "user-2", role: "user", parts: [{ type: "text", text: "Second turn" }] },
			{ id: "assistant-2", role: "assistant", parts: [{ type: "text", text: "Second answer" }] },
		];
		const completed = presentation({
			sessionName: "Renamed session",
			thinkingLevel: "high",
			serviceTier: "flex",
			recap: "Historical recap",
			userBash: [
				{
					id: "bash-complete",
					runId: "bash-complete-run",
					command: "old command",
					output: "done",
					status: "success",
					cancelled: false,
					truncated: false,
					excludeFromContext: false,
					startedAt: 1,
					endedAt: 2,
				},
			],
			rlmChildren: [
				{
					id: "child-complete",
					label: "Historical child",
					status: "done",
					timestamp: 2,
				},
			],
			refinements: [
				{
					id: "refinement-complete",
					summary: "Historical refinement",
					rationale: "",
					expectedOutcome: "",
					edits: [],
					status: "success",
					timestamp: 2,
				},
			],
		});

		const { queryByText } = render(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={messages}
				onSend={vi.fn()}
				onStop={vi.fn()}
				presentation={completed}
				status="ready"
			/>,
		);

		expect(queryByText("old command", { exact: true })).toBeNull();
		expect(queryByText("Historical child", { exact: true })).toBeNull();
		expect(queryByText("Historical refinement", { exact: true })).toBeNull();
		expect(queryByText(/tracked actions/)).toBeNull();
	});

	it("renders active session activity and opens its artifact from the action column", () => {
		const onOpenArtifact = vi.fn();
		const active = presentation({
			userBash: [
				{
					id: "bash-active",
					runId: "bash-active-run",
					command: "git status",
					output: "",
					status: "running",
					cancelled: false,
					truncated: false,
					excludeFromContext: false,
					startedAt: 1,
				},
			],
			rlmChildren: [
				{
					id: "child-active",
					label: "Repository scan",
					status: "running",
					timestamp: 1,
				},
			],
			artifactRuns: [
				{
					id: "artifact-run",
					runId: "bash-active-run",
					artifacts: [
						{
							id: "bash-artifact",
							runId: "bash-active-run",
							sourceToolCallId: "bash-active-run",
							kind: "bash",
							title: "git status",
							status: "running",
							input: { command: "git status" },
							timestamp: 1,
						},
					],
				},
			],
		});
		const messages: Array<ChatMessage> = [{ id: "assistant-live", role: "assistant", parts: [] }];
		const { getByRole, getByText } = render(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={messages}
				onOpenArtifact={onOpenArtifact}
				onSend={vi.fn()}
				onStop={vi.fn()}
				presentation={active}
				artifactRuns={active.artifactRuns}
				status="streaming"
			/>,
		);

		expect(getByText("git status", { exact: true })).toBeTruthy();
		expect(getByText("RLM · Repository scan", { exact: true })).toBeTruthy();
		const openButton = getByRole("button", { name: "Open git status artifact 1" });
		expect(getByRole("status").textContent).toContain("Coordinating 2 active actions");
		expect(getByRole("region", { name: /Coordinating 2 active actions/ }).getAttribute("aria-hidden")).toBe("false");
		expect(openButton.parentElement?.className).toContain("grid-cols-[1rem_auto_minmax(0,1fr)_auto]");
		fireEvent.click(openButton);
		expect(onOpenArtifact).toHaveBeenCalledWith("bash-artifact");
	});

	it("opens canonical tool activity in Artifacts", () => {
		const onOpenArtifact = vi.fn();
		const messages: Array<ChatMessage> = [
			{
				id: "assistant-tool",
				role: "assistant",
				parts: [
					{
						type: "tool-IPython",
						toolCallId: "ipython-1",
						state: "output-available",
						input: { code: "1 + 1" },
						output: { result: "2" },
					},
				],
			},
		];
		const artifactRuns = [
			{
				id: "tool-run",
				runId: "assistant-tool",
				artifacts: [
					{
						id: "ipython-artifact",
						runId: "assistant-tool",
						sourceMessageId: "assistant-tool",
						sourceToolCallId: "ipython-1",
						kind: "ipython" as const,
						title: "IPython",
						status: "success" as const,
						input: { code: "1 + 1" },
						output: { result: "2" },
						timestamp: 1,
					},
				],
			},
		];
		const { getByRole } = render(
			<FleetPiAgentChat
				inputBar={inputBar}
				messages={messages}
				onOpenArtifact={onOpenArtifact}
				onSend={vi.fn()}
				onStop={vi.fn()}
				artifactRuns={artifactRuns}
				status="streaming"
			/>,
		);

		const openButton = getByRole("button", { name: "Open IPython artifact 1" });
		expect(openButton.parentElement?.parentElement?.className).toContain(
			"grid-cols-[1rem_auto_minmax(0,1fr)_auto]",
		);
		fireEvent.click(openButton);
		expect(onOpenArtifact).toHaveBeenCalledWith("ipython-artifact");
	});

	it("forwards actions from reopened artifact OpenUI blocks", () => {
		const onOpenUIAction = vi.fn();
		const messages: Array<ChatMessage> = [
			{
				id: "assistant-1",
				role: "assistant",
				parts: [{ type: "text", text: "```openui\nroot = Card\n```" }],
			},
		];

		const { getByRole } = render(
			<ArtifactsPanelContent
				error={null}
				loadWorkspaceFile={vi.fn()}
				loading={false}
				messages={messages}
				onOpenUIAction={onOpenUIAction}
				onSelectedPathChange={vi.fn()}
				selectedPath={null}
				status="ready"
				workspace={null}
			/>,
		);

		fireEvent.click(getByRole("button", { name: /Card/ }));
		fireEvent.click(getByRole("button", { name: "Trigger OpenUI action" }));
		 expect(onOpenUIAction).toHaveBeenCalledWith("continue_conversation");
	});

	it("preserves failed diff status and output in artifacts", () => {
		const artifactRuns: Array<PrimeAgentArtifactRun> = [
			{
				id: "run-1",
				runId: "run-1",
				artifacts: [
					{
						id: "artifact-1",
						runId: "run-1",
						kind: "diff",
						title: "Edit",
						status: "error",
						input: {
							path: "src/example.ts",
							edits: [{ oldText: "before", newText: "after" }],
						},
						output: { error: "permission denied" },
						timestamp: 1,
					},
				],
				startedAt: 1,
			},
		];

		const { getByLabelText, getByText, queryByLabelText } = render(
			<ArtifactsPanelContent
				error={null}
				loadWorkspaceFile={vi.fn()}
				loading={false}
				messages={[]}
				onSelectedPathChange={vi.fn()}
				selectedPath={null}
				status="ready"
				artifactRuns={artifactRuns}
				workspace={null}
			/>,
		);

		expect(getByLabelText("Changes failed")).toBeTruthy();
		expect(queryByLabelText("Changes applied")).toBeNull();
		expect(getByText("permission denied")).toBeTruthy();
	});

	it("renders a safe project-persistence error without an absolute path", () => {
		const safeMessage = "Could not save the session's project assignment. Please try again.";
		const { getByRole } = render(
			<FleetPiAgentChat
				error={new Error(safeMessage)}
				inputBar={inputBar}
				messages={[]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="error"
			/>,
		);

		const alert = getByRole("alert");
		expect(alert.textContent).toContain(safeMessage);
		expect(alert.textContent).not.toContain("/Users/zocho/.prime/agent/");
	});
});
