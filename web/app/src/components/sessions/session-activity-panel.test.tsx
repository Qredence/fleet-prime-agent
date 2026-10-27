import type { PrimeAgentRlmChild } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionActivityPanel } from "@/components/sessions/session-activity-panel";

const messages: Array<ChatMessage> = [
	{ id: "user-1", role: "user", parts: [{ type: "text", text: "Find the answer" }] },
	{ id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "I found it." }] },
];

const child: PrimeAgentRlmChild = {
	id: "child-1",
	label: "Research worker",
	sessionName: "Research notes",
	status: "done",
	model: "test-model",
	timestamp: 1,
};

describe("SessionActivityPanel", () => {
	it("shows conversation and dismissed child metadata and opens the child tab", () => {
		const openChildTab = vi.fn();
		render(
			<SessionActivityPanel
				artifactRuns={[]}
				childAgents={[child]}
				messages={messages}
				onOpenArtifact={vi.fn()}
				onSelectChild={openChildTab}
				streaming={false}
			/>,
		);

		expect(screen.getByText("Find the answer")).toBeTruthy();
		expect(screen.getByText("I found it.")).toBeTruthy();
		expect(screen.getByText("done · test-model")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open Research notes agent tab" }));
		expect(openChildTab).toHaveBeenCalledWith("child-1");
	});

	it("keeps full assistant text accessible while clamping the preview and showing the turn trace first", () => {
		const report = "A detailed report that continues beyond the two-line visual preview. ".repeat(12).trim();
		render(
			<SessionActivityPanel
				artifactRuns={[]}
				childAgents={[]}
				messages={[
					{ id: "user-1", role: "user", parts: [{ type: "text", text: "Inspect the workspace" }] },
					{
						id: "assistant-1",
						role: "assistant",
						parts: [
							{ type: "reasoning", contentIndex: 0, text: "Inspecting the workspace", state: "complete" },
							{ type: "tool-Bash", toolCallId: "bash-1", state: "output-available" },
							{ type: "text", text: report },
						],
					},
				]}
				onOpenArtifact={vi.fn()}
				onSelectChild={vi.fn()}
				streaming={false}
			/>,
		);

		const preview = screen.getByText(/A detailed report that continues beyond the two-line visual preview/);
		expect(preview.textContent).toBe(report);
		expect(preview.className).toContain("line-clamp-2");
		const activity = screen.getByTestId("session-activity");
		fireEvent.click(screen.getByRole("button", { name: /Thought/ }));
		expect(screen.getByText("Inspecting the workspace")).toBeTruthy();
		const trace = screen.getByTestId("tool-trace");
		expect(activity.querySelectorAll("[data-testid='tool-trace']").length).toBe(1);
		expect(trace.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
