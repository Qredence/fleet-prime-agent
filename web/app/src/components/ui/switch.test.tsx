import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "@/components/ui/switch";

afterEach(cleanup);

describe("Switch pointer activation", () => {
	it.each(["mouse", "touch"])("toggles an unlabeled switch after a captured %s click", (pointerType) => {
		const onCheckedChange = vi.fn();
		render(<Switch aria-label="Enable feature" onCheckedChange={onCheckedChange} />);
		const control = screen.getByRole("switch", { name: "Enable feature" });
		fireEvent.pointerDown(control, { pointerType, pointerId: 1, button: 0, clientX: 0 });
		fireEvent.pointerUp(control, { pointerType, pointerId: 1, clientX: 0 });
		fireEvent.click(control);
		expect(control.getAttribute("aria-checked")).toBe("true");
		expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
	});

	it("does not toggle twice when a drag is followed by a captured click", () => {
		const onCheckedChange = vi.fn();
		render(<Switch aria-label="Enable feature" onCheckedChange={onCheckedChange} />);
		const control = screen.getByRole("switch");
		fireEvent.pointerDown(control, { pointerType: "mouse", button: 0, clientX: 0 });
		fireEvent.pointerMove(control, { clientX: 30 });
		fireEvent.pointerUp(control, { clientX: 30 });
		fireEvent.click(control);
		expect(control.getAttribute("aria-checked")).toBe("true");
		expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
	});

	it("ignores captured clicks when disabled", () => {
		const onCheckedChange = vi.fn();
		render(<Switch disabled aria-label="Enable feature" onCheckedChange={onCheckedChange} />);
		fireEvent.click(screen.getByRole("switch"));
		expect(onCheckedChange).not.toHaveBeenCalled();
	});

	it("activates a labeled switch when its visible label is clicked", () => {
		const onCheckedChange = vi.fn();
		render(<Switch label="Enable feature" onCheckedChange={onCheckedChange} />);
		const control = screen.getByRole("switch", { name: "Enable feature" });
		fireEvent.click(screen.getByText("Enable feature"));
		expect(control.getAttribute("aria-checked")).toBe("true");
		expect(onCheckedChange).toHaveBeenCalledExactlyOnceWith(true);
	});
});
