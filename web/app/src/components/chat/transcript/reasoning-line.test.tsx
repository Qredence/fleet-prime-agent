import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reasoningRunPresentation } from "@/components/chat/transcript/message-turns";
import { ReasoningLine } from "@/components/chat/transcript/reasoning-line";

describe("reasoningRunPresentation", () => {
	it("joins adjacent episodes with a blank line and sums their durations", () => {
		expect(
			reasoningRunPresentation(
				[
					{ type: "reasoning", contentIndex: 0, text: "Orient.", state: "complete", durationMs: 1200 },
					{ type: "reasoning", contentIndex: 1, text: "Plan the work.", state: "complete", durationMs: 800 },
					{ type: "reasoning", contentIndex: 2, text: "Act.", state: "streaming" },
				],
				true,
			),
		).toEqual({
			text: "Orient.\n\nPlan the work.\n\nAct.",
			streaming: true,
			durationMs: 2000,
		});
	});

	it("omits the duration when no episode recorded one", () => {
		expect(
			reasoningRunPresentation([{ type: "reasoning", contentIndex: 0, text: "Orient.", state: "complete" }], false)
				.durationMs,
		).toBeUndefined();
	});
});

describe("ReasoningLine", () => {
	it("opens during streaming, closes on completion, and respects manual choice", () => {
		const { rerender } = render(<ReasoningLine text="First step" streaming />);
		const trigger = screen.getByRole("button", { name: /Thinking/ });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		rerender(<ReasoningLine text="First step" streaming={false} durationMs={2200} />);
		expect(screen.getByRole("button", { name: /Thought/ }).getAttribute("aria-expanded")).toBe("false");
		expect(screen.getByRole("button", { name: /Thought/ }).textContent).toContain("2s");
		fireEvent.click(screen.getByRole("button", { name: /Thought/ }));
		rerender(<ReasoningLine text="Next step" streaming />);
		expect(screen.getByRole("button", { name: /Thinking/ }).getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: /Thinking/ }));
		rerender(<ReasoningLine text="Next step and more" streaming />);
		expect(screen.getByRole("button", { name: /Thinking/ }).getAttribute("aria-expanded")).toBe("false");
	});

	it("keeps a multi-paragraph chain in one collapsible", () => {
		render(<ReasoningLine text={"Orient.\n\nPlan the work."} streaming durationMs={1600} />);
		const triggers = screen.getAllByRole("button", { name: /Thinking|Thought/ });
		expect(triggers).toHaveLength(1);
		expect(triggers[0]?.getAttribute("aria-expanded")).toBe("true");
		expect(triggers[0]?.textContent).toContain("2s");
		expect(screen.getByText(/Orient\./)).toBeTruthy();
		expect(screen.getByText(/Plan the work\./)).toBeTruthy();
	});
});
