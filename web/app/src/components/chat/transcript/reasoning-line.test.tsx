import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReasoningLine } from "@/components/chat/transcript/reasoning-line";

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
});
