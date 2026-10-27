import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Citations } from "@/components/tools/citations";

describe("Citations", () => {
	it("uses a shadcn collapsible for linked sources and reports state changes", () => {
		const onOpenChange = vi.fn();
		render(
			<Citations
				citations={[{ id: "source-1", title: "Reference", domain: "example.com", url: "https://example.com" }]}
				onOpenChange={onOpenChange}
			/>,
		);

		const trigger = screen.getByRole("button", { name: /Sources 1/i });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);

		expect(onOpenChange).toHaveBeenCalledWith(true);
		expect(screen.getByRole("link", { name: /Reference/ }).getAttribute("href")).toBe("https://example.com");
	});

	it("does not link unsafe citation URLs", () => {
		render(
			<Citations citations={[{ id: "unsafe", title: "Unsafe source", url: "javascript:alert(1)" }]} defaultOpen />,
		);

		expect(screen.queryByRole("link", { name: /Unsafe source/ })).toBeNull();
		expect(screen.getByText("Unsafe source")).toBeTruthy();
	});
});
