import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatWelcome } from "./chat-welcome";

describe("ChatWelcome", () => {
	it("uses shared buttons for preset prompts and preserves their selection value", () => {
		const onSelect = vi.fn();
		render(<ChatWelcome disabled={false} onSelect={onSelect} composer={<div data-testid="composer" />} />);

		expect(screen.getByTestId("composer").isConnected).toBe(true);
		const review = screen.getByRole("button", { name: "Review changes" });
		expect(review.getAttribute("data-slot")).toBe("button");
		fireEvent.click(review);

		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "welcome-review-changes",
				value: expect.stringContaining("Review my current changes"),
			}),
		);
	});

	it("disables preset prompts while the conversation is unavailable", () => {
		render(<ChatWelcome disabled onSelect={vi.fn()} composer={null} />);
		expect((screen.getByRole("button", { name: "Explore codebase" }) as HTMLButtonElement).disabled).toBe(true);
	});
});
