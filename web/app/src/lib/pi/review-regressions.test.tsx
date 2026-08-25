import { fireEvent, render } from "@testing-library/react";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import type { PrimeAgentArtifactRun } from "@prime-agent/web-protocol/chat-protocol";
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

describe("review regressions", () => {
	it("keeps a completed reasoning presentation visible", () => {
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
});
