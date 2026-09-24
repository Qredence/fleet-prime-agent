import { fireEvent, render, screen } from "@testing-library/react";
import { Plus } from "lucide-react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { SizeProvider } from "@/lib/size-context";

describe("Button", () => {
	it("uses the canonical compact size and resolves the legacy small alias", () => {
		const { rerender } = render(<Button size="compact">Compact</Button>);
		expect(screen.getByRole("button", { name: "Compact" }).className).toContain("h-7");

		rerender(<Button size="sm">Legacy compact</Button>);
		expect(screen.getByRole("button", { name: "Legacy compact" }).className).toContain("h-7");
	});

	it("inherits compact size from SizeProvider when size is omitted", () => {
		render(
			<SizeProvider size="compact">
				<Button>In context</Button>
			</SizeProvider>,
		);

		expect(screen.getByRole("button", { name: "In context" }).className).toContain("h-7");
	});

	it("disables interaction while loading and keeps its label available", () => {
		render(<Button loading>Save changes</Button>);

		const button = screen.getByRole("button", { name: "Save changes" });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.querySelector("svg")).not.toBeNull();
	});

	it("renders leading and trailing icons with the label", () => {
		render(
			<Button leadingIcon={Plus} trailingIcon={Plus}>
				Add item
			</Button>,
		);

		const button = screen.getByRole("button", { name: "Add item" });
		expect(button.querySelectorAll("svg").length).toBe(2);
	});

	it("sizes unsized label icons by control size and keeps them in the label layout", () => {
		const { rerender } = render(
			<Button>
				<Plus aria-hidden="true" /> Add item
			</Button>,
		);
		const button = screen.getByRole("button", { name: "Add item" });
		const label = button.querySelector("span:has(> svg)");
		expect(button.className).toContain("[&_svg:not([class*='size-'])]:size-4");
		expect(label?.className).toContain("inline-flex items-center gap-[inherit]");
		expect(label?.className).toContain("[&_svg]:shrink-0");

		rerender(
			<Button size="compact">
				<Plus aria-hidden="true" /> Add item
			</Button>,
		);
		expect(button.className).toContain("[&_svg:not([class*='size-'])]:size-3.5");
	});

	it("merges slot classes, styles, click behavior, and the forwarded ref", () => {
		const childClick = vi.fn();
		const buttonClick = vi.fn();
		const ref = createRef<HTMLButtonElement>();
		const { container } = render(
			<Button asChild ref={ref} className="button-class" style={{ color: "red" }} onClick={buttonClick}>
				<a href="/docs" className="child-class" style={{ backgroundColor: "black" }} onClick={childClick}>
					Read docs
				</a>
			</Button>,
		);

		const link = screen.getByRole("link", { name: "Read docs" });
		fireEvent.click(link);

		expect(link.className).toContain("button-class");
		expect(link.className).toContain("child-class");
		expect((link as HTMLElement).style.color).toBe("red");
		expect((link as HTMLElement).style.backgroundColor).toBe("black");
		expect(childClick).toHaveBeenCalledTimes(1);
		expect(buttonClick).toHaveBeenCalledTimes(1);
		expect(ref.current).toBe(container.querySelector("a"));
	});
});
