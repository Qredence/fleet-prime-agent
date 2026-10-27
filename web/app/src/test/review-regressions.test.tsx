import type { PrimeAgentArtifactRun, PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactsPanelContent } from "@/components/artifacts/artifacts-panel";
import { collectSessionOpenUIBlocks } from "@/components/artifacts/artifacts-utils";
import { AgentChat } from "@/components/chat/agent-chat";
import { Markdown } from "@/components/chat/markdown/markdown";
import { PayloadPart } from "@/components/chat/transcript/payload-part";
import { MessageQueue } from "@/components/tools/message-queue";
import { SubagentList } from "@/components/tools/subagent-list";
import { ToolTimeline } from "@/components/tools/tool-timeline";
import { notify } from "@/lib/notify";

vi.mock("@/components/openui/openui-renderer", () => ({
	GenerativeTextRenderer: ({ onOpenUIAction }: { onOpenUIAction?: (message: string) => void }) => (
		<button type="button" onClick={() => onOpenUIAction?.("continue_conversation")}>
			Trigger OpenUI action
		</button>
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

function presentation(overrides: Partial<PrimeAgentSessionPresentation> = {}): PrimeAgentSessionPresentation {
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
	it.each([
		{ text: "Child report", payload: undefined },
		{ text: "Child report", payload: { result: "done" } },
		{ text: undefined, payload: { result: "done" } },
		{ text: undefined, payload: undefined },
	])("renders agent message text and payload independently: %j", ({ text, payload }) => {
		const { container, queryByText } = render(
			<PayloadPart part={{ type: "payload", kind: "agent_message", title: "Details", text, payload }} />,
		);
		expect(Boolean(queryByText("Child report"))).toBe(Boolean(text));
		expect(Boolean(container.querySelector("details"))).toBe(Boolean(payload));
		if (payload) expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
		if (!text && !payload) expect(container.innerHTML).toBe("");
	});

	it("shows standalone artifact rows without an empty details button", () => {
		const { getByRole, queryByRole, getByText } = render(
			<ToolTimeline
				messages={[]}
				artifacts={[
					{
						id: "recap-1",
						runId: "run-1",
						title: "Session recap",
						kind: "recap",
						status: "success",
						timestamp: 1,
					},
				]}
				streaming={false}
				onOpenArtifact={vi.fn()}
			/>,
		);
		expect(getByText("Recapped Session recap").closest("button")).toBeNull();
		expect(queryByRole("button", { name: /Details for/ })).toBeNull();
		expect(getByRole("button", { name: "Open Session recap in artifacts" })).toBeTruthy();
	});

	it.each(["Inspecting files", ""])("falls through empty subagent error and answer fields (%s)", (progressNote) => {
		const { getByText } = render(
			<SubagentList>
				{[
					{
						id: "child-fallback",
						label: "Worker",
						status: "running",
						timestamp: 1,
						error: "",
						answerPreview: "",
						progressNote,
						activity: { kind: "executing", toolName: "Read" },
					},
				]}
			</SubagentList>,
		);
		expect(getByText(progressNote || "Read")).toBeTruthy();
	});
	it("preserves paragraph styling around an inline image in mixed content", () => {
		const { container, getByRole } = render(
			<Markdown content="Before ![status](https://example.com/status.png) after" />,
		);
		const paragraph = container.querySelector(".typeset p");

		expect(paragraph).not.toBeNull();
		expect(paragraph?.textContent).toContain("Before");
		expect(paragraph?.textContent).toContain("after");
		expect(getByRole("img", { name: "status" }).closest("p")).toBe(paragraph);
	});

	it("keeps the completed tool timeline expanded by default", () => {
		const { getByRole } = render(
			<ToolTimeline
				messages={[
					{
						id: "assistant-tools",
						role: "assistant",
						parts: [{ type: "tool-Bash", toolCallId: "bash-1", input: { command: "pwd" }, output: "ok" }],
					},
				]}
				streaming={false}
			/>,
		);

		expect(getByRole("button", { name: "1 tool action" }).getAttribute("aria-expanded")).toBe("true");
	});

	it("shows bounded tool context and normalized duration in Activity Trace rows", () => {
		const { getByText, getByTestId } = render(
			<ToolTimeline
				messages={[
					{
						id: "assistant-safe-summary",
						role: "assistant",
						parts: [
							{
								type: "tool-Bash",
								toolCallId: "bash-safe-summary",
								state: "output-available",
								input: { command: "git status --token=super-secret" },
								output: { stdout: "clean", durationMs: 2_300 },
							},
						],
					},
				]}
				streaming={false}
			/>,
		);

		const trace = getByTestId("tool-trace");
		expect(getByText("git status --token=[redacted]", { exact: true })).toBeTruthy();
		expect(getByText("2.3 s", { exact: true })).toBeTruthy();
		expect(trace.textContent).not.toContain("super-secret");
	});

	it("keeps independent colon tool ids and groups only real Task children", () => {
		const { getByRole, queryByRole } = render(
			<ToolTimeline
				messages={[
					{
						id: "assistant-colon-tools",
						role: "assistant",
						parts: [
							{
								type: "tool-Bash",
								toolCallId: "namespace:run",
								state: "output-available",
								output: "independent",
							},
							{ type: "tool-Task", toolCallId: "task-1", state: "output-available", output: "done" },
							{ type: "tool-Bash", toolCallId: "task-1:child", state: "output-available", output: "nested" },
						],
					},
				]}
				streaming={false}
			/>,
		);

		expect(getByRole("button", { name: "Details for Bash (namespace:run)" })).toBeTruthy();
		expect(getByRole("button", { name: "Details for Task (task-1)" })).toBeTruthy();
		expect(queryByRole("button", { name: "Details for Bash (task-1:child)" })).toBeNull();
	});

	it("surfaces reported tool errors while retaining success transport state", async () => {
		const activity = render(
			<ToolTimeline
				messages={[
					{
						id: "assistant-reported-error",
						role: "assistant",
						parts: [
							{
								type: "tool-WebSearch",
								toolCallId: "reported-error-search",
								state: "output-available",
								output: { evalue: "remote request failed" },
							},
						],
					},
				]}
				streaming={false}
			/>,
		);
		expect(activity.getByText("reported error", { exact: true })).toBeTruthy();
		activity.unmount();

		const { findByRole } = render(
			<AgentChat
				inputBar={inputBar}
				messages={[
					{
						id: "assistant-reported-error-inline",
						role: "assistant",
						parts: [
							{
								type: "tool-WebSearch",
								toolCallId: "reported-error-inline-search",
								state: "output-available",
								output: { evalue: "remote request failed" },
							},
						],
					},
				]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);
		const details = await findByRole("button", { name: "Details for WebSearch (reported-error-inline-search)" });
		expect(details.closest("[data-testid='assistant-tool-trace']")?.textContent).toContain("reported error");
	});

	it("limits the active tool timeline to artifacts from the current turn", async () => {
		const messages: Array<ChatMessage> = [
			{ id: "user-1", role: "user", parts: [{ type: "text", text: "First turn" }] },
			{
				id: "assistant-1",
				role: "assistant",
				parts: [{ type: "tool-Bash", toolCallId: "old-tool", input: { command: "old command" }, output: "done" }],
			},
			{ id: "user-2", role: "user", parts: [{ type: "text", text: "Second turn" }] },
			{
				id: "assistant-2",
				role: "assistant",
				parts: [
					{ type: "tool-Bash", toolCallId: "current-tool", input: { command: "current command" }, output: "done" },
				],
			},
		];
		const artifactRuns: Array<PrimeAgentArtifactRun> = [
			{
				id: "old-run",
				runId: "old-run",
				artifacts: [
					{
						id: "old-artifact",
						runId: "old-run",
						sourceMessageId: "assistant-1",
						sourceToolCallId: "old-tool",
						kind: "bash",
						title: "old command",
						status: "success",
						timestamp: 1,
					},
				],
			},
			{
				id: "current-run",
				runId: "current-run",
				artifacts: [
					{
						id: "current-artifact",
						runId: "current-run",
						sourceMessageId: "assistant-2",
						sourceToolCallId: "current-tool",
						kind: "bash",
						title: "current command",
						status: "success",
						timestamp: 2,
					},
				],
			},
		];

		const { queryByRole } = render(
			<AgentChat
				artifactRuns={artifactRuns}
				inputBar={inputBar}
				messages={messages}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);

		// Timeline and activity panels load lazily; wait for them first so the
		// absence assertion below is meaningful instead of pre-load.
		await waitFor(() => expect(document.querySelectorAll("[data-testid='assistant-tool-trace']")).toHaveLength(2));
		expect(queryByRole("button", { name: "Details for Bash (old-tool)" })).toBeTruthy();
	});

	it("renders nested subagents in tree order regardless of completion order", () => {
		const { getByRole, getByText } = render(
			<SubagentList
				tree={{
					rootSessionId: "session-1",
					rootChildrenIds: ["parent"],
					nodes: {
						parent: {
							id: "parent",
							label: "Parent worker",
							status: "error",
							timestamp: 1,
							depth: 0,
							childrenIds: ["child"],
						},
						child: {
							id: "child",
							parentId: "parent",
							label: "Child worker",
							status: "done",
							timestamp: 2,
							depth: 1,
							childrenIds: [],
						},
					},
				}}
			>
				{[
					{ id: "child", parentId: "parent", label: "Child worker", status: "done", timestamp: 2 },
					{ id: "parent", label: "Parent worker", status: "error", timestamp: 1 },
				]}
			</SubagentList>,
		);

		fireEvent.click(getByRole("button", { name: /Subagents completed/ }));
		expect(getByText("Parent worker")).toBeTruthy();
		expect(getByText("Child worker")).toBeTruthy();
	});

	it("edits a queued item in place", async () => {
		const onEdit = vi.fn().mockResolvedValue(true);
		const { getByLabelText, getByRole } = render(
			<MessageQueue queue={{ steering: ["Run tests"], followUp: [] }} onEdit={onEdit} />,
		);

		fireEvent.click(getByRole("button", { name: "Edit queued message: Run tests" }));
		fireEvent.change(getByLabelText("Edit queued message: Run tests"), { target: { value: "Run lint" } });
		fireEvent.click(getByRole("button", { name: "Save" }));

		await waitFor(() => expect(onEdit).toHaveBeenCalledWith("steering", 0, "Run tests", "Run lint"));
	});

	it("removes a queued item using its lane and expected text", () => {
		const onDelete = vi.fn();
		const { getByRole } = render(
			<MessageQueue queue={{ steering: ["Run tests"], followUp: ["Summarize"] }} onDelete={onDelete} />,
		);

		fireEvent.click(getByRole("button", { name: "Remove queued message: Run tests" }));
		expect(onDelete).toHaveBeenCalledWith("steering", 0, "Run tests");
	});

	it("reports queued item removal failures", async () => {
		const onDelete = vi.fn().mockRejectedValue(new Error("queue unavailable"));
		const notifyError = vi.spyOn(notify, "error").mockImplementation(() => "");
		render(<MessageQueue queue={{ steering: ["Run tests"], followUp: [] }} onDelete={onDelete} />);

		fireEvent.click(screen.getByRole("button", { name: "Remove queued message: Run tests" }));

		await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Unable to remove queued message"));
	});

	it("reports queued item removals rejected by the server", async () => {
		const onDelete = vi.fn().mockResolvedValue(false);
		const notifyError = vi.spyOn(notify, "error").mockImplementation(() => "");
		render(<MessageQueue queue={{ steering: ["Run tests"], followUp: [] }} onDelete={onDelete} />);

		fireEvent.click(screen.getByRole("button", { name: "Remove queued message: Run tests" }));

		await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Unable to remove queued message"));
	});

	it("keeps completed reasoning presentation visible", async () => {
		const { findByLabelText } = render(
			<AgentChat
				inputBar={inputBar}
				messages={[settledReasoningMessage()]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);

		expect(await findByLabelText("Safe reasoning progress")).toBeTruthy();
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
			<AgentChat inputBar={inputBar} messages={messages} onSend={vi.fn()} onStop={vi.fn()} status="streaming" />,
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
			<AgentChat inputBar={inputBar} messages={messages} onSend={onSend} onStop={onStop} status="streaming" />,
		);
		const prompt = getByRole("textbox", { name: "Prompt" });

		fireEvent.click(getByRole("button", { name: "Stop generating" }));
		expect(onStop).toHaveBeenCalledOnce();
		fireEvent.change(prompt, { target: { value: "Adjust the current approach" } });
		expect(getByRole("button", { name: "Send follow-up" })).toBeTruthy();
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
			<AgentChat inputBar={inputBar} messages={messages} onSend={onSend} onStop={onStop} status="submitted" />,
		);
		fireEvent.change(prompt, { target: { value: "Queue during admission" } });
		fireEvent.keyDown(prompt, { key: "Enter" });
		expect(onSend).toHaveBeenLastCalledWith({
			role: "user",
			content: "Queue during admission",
			altKey: false,
		});
	});

	it("renders specialized tool details inline at the original message position", async () => {
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
						output: { stdout: "done", durationMs: 3_200 },
					},
				],
			},
		];
		const { findByRole, findByText } = render(
			<AgentChat inputBar={inputBar} messages={messages} onSend={vi.fn()} onStop={vi.fn()} status="ready" />,
		);
		const answer = await findByText("Final architecture summary");
		const details = await findByRole("button", { name: "Details for IPython (footer-tool)" });
		const progress = details.closest("[data-testid='assistant-tool-trace']");

		expect(progress).not.toBeNull();
		if (!progress) return;
		expect(details.getAttribute("aria-expanded")).toBe("false");
		expect(progress.textContent).toContain("print('done')");
		expect(progress.textContent).toContain("3.2 s");
		fireEvent.click(details);
		expect(answer.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
		expect(await findByText("done", { exact: true })).toBeTruthy();
		expect(document.querySelector("[data-testid='agent-activity']")).toBeNull();
	});

	it("labels interrupted main-session tools as cancelled", async () => {
		const { findByRole } = render(
			<AgentChat
				inputBar={inputBar}
				messages={[
					{
						id: "assistant-interrupted",
						role: "assistant",
						parts: [{ type: "tool-Bash", toolCallId: "interrupted-bash", state: "interrupted" }],
					},
				]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);
		const details = await findByRole("button", { name: "Details for Bash (interrupted-bash)" });
		expect(details.closest("[data-testid='assistant-tool-trace']")?.textContent).toContain("cancelled");
	});

	it("distinguishes pending tools from failed tools with structured errors", async () => {
		const { findByRole } = render(
			<AgentChat
				inputBar={inputBar}
				messages={[
					{
						id: "assistant-statuses",
						role: "assistant",
						parts: [
							{ type: "tool-Bash", toolCallId: "pending-bash", state: "input-available" },
							{
								type: "tool-Bash",
								toolCallId: "failed-bash",
								state: "output-error",
								output: { error: "failed" },
							},
						],
					},
				]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);
		const pending = await findByRole("button", { name: "Details for Bash (pending-bash)" });
		const failed = await findByRole("button", { name: "Details for Bash (failed-bash)" });
		expect(pending.closest("[data-testid='assistant-tool-trace']")?.textContent).toContain("waiting");
		expect(failed.closest("[data-testid='assistant-tool-trace']")?.textContent).toContain("failed");
	});

	it("deduplicates repeated child reports and keeps their raw payload collapsed", async () => {
		const report = {
			type: "payload" as const,
			id: "child-report-1",
			kind: "agent_message" as const,
			title: "Research worker report",
			text: "Found two useful references.",
			payload: { internal: "raw child payload" },
		};
		const { container, findByText, queryAllByText } = render(
			<AgentChat
				inputBar={inputBar}
				messages={[
					{
						id: "assistant-parent",
						role: "assistant",
						parts: [{ type: "text", text: "Found two useful references." }, report],
					},
					{ id: "assistant-child-copy", role: "assistant", parts: [report] },
				]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);

		await findByText("Found two useful references.");
		expect(queryAllByText("Found two useful references.", { exact: true })).toHaveLength(1);
		expect(container.querySelectorAll('[data-payload-kind="agent_message"]')).toHaveLength(1);
		expect(container.querySelector("details[data-payload-kind='agent_message']")?.hasAttribute("open")).toBe(false);
		expect(container.querySelector("[data-payload-kind='agent_message'] summary")?.textContent).toBe("Details");
		expect(container.textContent).not.toContain("[agent_message]");
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
			<AgentChat
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

	it("renders active session activity and routes technical artifacts to Artifacts", async () => {
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
							sourceMessageId: "assistant-live",
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
		const messages: Array<ChatMessage> = [
			{
				id: "assistant-live",
				role: "assistant",
				parts: [
					{
						type: "tool-Bash",
						toolCallId: "bash-active-run",
						state: "input-streaming",
						input: { command: "git status" },
					},
				],
			},
		];
		const { findByRole, queryByText } = render(
			<AgentChat
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

		expect(await findByRole("button", { name: "Details for Bash (bash-active-run)" })).toBeTruthy();
		expect(document.querySelector("[data-testid='assistant-tool-trace'] button")?.getAttribute("aria-expanded")).toBe(
			"false",
		);
		expect(queryByText("RLM · Repository scan", { exact: true })).toBeNull();
		expect(queryByText(/Coordinating/)).toBeNull();
		expect(document.querySelector("[data-testid='agent-activity']")).toBeNull();
		const openButton = await findByRole("button", { name: "Open git status in artifacts" });
		fireEvent.click(openButton);
		expect(onOpenArtifact).toHaveBeenCalledWith("bash-artifact", "artifacts");
	});

	it("opens IPython activity in REPL", async () => {
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
		const { findByRole } = render(
			<AgentChat
				inputBar={inputBar}
				messages={messages}
				onOpenArtifact={onOpenArtifact}
				onSend={vi.fn()}
				onStop={vi.fn()}
				artifactRuns={artifactRuns}
				status="streaming"
			/>,
		);

		expect(await findByRole("button", { name: "Details for IPython (ipython-1)" })).toBeTruthy();
		const openButton = await findByRole("button", { name: "Open IPython in REPL" });
		fireEvent.click(openButton);
		expect(onOpenArtifact).toHaveBeenCalledWith("ipython-artifact", "repl");
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
				onOpenUIAction={onOpenUIAction}
				openUIBlocks={collectSessionOpenUIBlocks(messages)}
				status="ready"
			/>,
		);

		fireEvent.click(getByRole("button", { name: /Card/ }));
		fireEvent.click(getByRole("button", { name: "Trigger OpenUI action" }));
		expect(onOpenUIAction).toHaveBeenCalledWith("continue_conversation");
	});

	it("renders technical diff output in the Artifacts pane", () => {
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

		const { getByLabelText, getByText } = render(
			<ArtifactsPanelContent status="ready" artifactRuns={artifactRuns} />,
		);

		expect(getByLabelText("Changes failed")).toBeTruthy();
		expect(getByText("permission denied")).toBeTruthy();
	});

	it("renders a safe project-persistence error without an absolute path", () => {
		const safeMessage = "Could not save the session's project assignment. Please try again.";
		const { getByRole } = render(
			<AgentChat
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
