import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReasoningLine, splitReasoningSegments } from "@/components/chat/transcript/reasoning-line";

describe("splitReasoningSegments", () => {
	it("keeps a single paragraph as one streaming segment", () => {
		expect(splitReasoningSegments("First step", true)).toEqual([{ text: "First step", streaming: true }]);
	});

	it("promotes completed paragraphs to Thought while the last stays Thinking", () => {
		expect(splitReasoningSegments("First paragraph.\n\nSecond paragraph.", true)).toEqual([
			{ text: "First paragraph.", streaming: false },
			{ text: "Second paragraph.", streaming: true },
		]);
	});
});

describe("ReasoningLine", () => {
	it("opens during streaming, closes on completion, and respects manual choice", () => {
		const { rerender } = render(<ReasoningLine text="First step" streaming />);
		const trigger = screen.getByRole("button", { name: /Thinking/ });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		rerender(<ReasoningLine text="First step" streaming={false} durationMs={2200} />);
		expect(screen.getByRole("button", { name: /Thought/ }).getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(screen.getByRole("button", { name: /Thought/ }));
		rerender(<ReasoningLine text="Next step" streaming />);
		expect(screen.getByRole("button", { name: /Thinking/ }).getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: /Thinking/ }));
		rerender(<ReasoningLine text="Next step and more" streaming />);
		expect(screen.getByRole("button", { name: /Thinking/ }).getAttribute("aria-expanded")).toBe("false");
	});

	it("renders discrete Thought rows as blank-line paragraphs complete", () => {
		render(<ReasoningLine text={"Orient.\n\nPlan the work."} streaming />);
		const thought = screen.getByRole("button", { name: /Thought/ });
		const thinking = screen.getByRole("button", { name: /Thinking/ });
		expect(thought.getAttribute("aria-expanded")).toBe("false");
		expect(thinking.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(thought);
		expect(screen.getByText("Orient.")).toBeTruthy();
		expect(screen.getByText("Plan the work.")).toBeTruthy();
	});
});
