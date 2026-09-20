import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatWelcome } from "@/components/qredence-ui/chat/chat-welcome";

describe("ChatWelcome", () => {
	it("uses shared buttons for preset prompts and preserves their selection value", () => {
		const onSelect = vi.fn();
		render(<ChatWelcome disabled={false} onSelect={onSelect} />);

		expect(screen.queryByTestId("composer")).toBeNull();
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
		render(<ChatWelcome disabled onSelect={vi.fn()} />);
		expect((screen.getByRole("button", { name: "Explore codebase" }) as HTMLButtonElement).disabled).toBe(true);
	});
});
