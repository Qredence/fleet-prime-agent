import type { ChatReasoningPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionReasoningPanel } from "@/components/chat/transcript/session-reasoning-panel";

describe("SessionReasoningPanel", () => {
	it("deduplicates repeated visible progress without exposing later hidden steps", () => {
		const presentation: ChatReasoningPresentation = {
			runId: "run-1",
			phase: "complete",
			steps: [
				{ id: "step-1", title: "Inspect", body: "Checked the workspace." },
				{ id: "step-2", title: "Inspect", body: "Checked the workspace." },
				{ id: "step-3", title: "Write", body: "Updated the requested file." },
			],
			visibleSteps: 3,
			streaming: false,
			startedAt: 1,
			restingLabel: "Completed",
		};
		const { container } = render(<SessionReasoningPanel presentation={presentation} />);

		expect(container.textContent).not.toContain("Checked the workspace.");
		fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
		expect(container.textContent).toContain("Checked the workspace.");
		expect(container.textContent).toContain("Updated the requested file.");
		expect(container.querySelectorAll("ol li")).toHaveLength(2);
	});
});
