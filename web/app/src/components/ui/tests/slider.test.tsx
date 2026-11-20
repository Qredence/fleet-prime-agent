import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "@/components/ui/slider";

describe("Slider", () => {
	it.each(["compact", "default"] as const)("handles mouse and touch input at %s density", (size) => {
		const onChange = vi.fn();
		const { container } = render(<Slider size={size} label="Level" min={0} max={10} value={0} onChange={onChange} />);
		const track = container.querySelector<HTMLElement>('[data-slot="slider-track"], [data-slider-track]')!;
		Object.defineProperty(track, "offsetWidth", { value: 120 });
		vi.spyOn(track, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 120, 36));
		fireEvent.pointerDown(track, { pointerType: "mouse", button: 0, clientX: 60 });
		expect(onChange).toHaveBeenLastCalledWith(5);
		fireEvent.pointerMove(track, { pointerType: "mouse", clientX: 120 });
		expect(onChange).toHaveBeenLastCalledWith(10);
		fireEvent.pointerUp(track, { pointerType: "mouse" });
		fireEvent.pointerDown(track, { pointerType: "touch", clientX: 0 });
		expect(onChange).toHaveBeenLastCalledWith(0);
		fireEvent.pointerCancel(track, { pointerType: "touch" });
	});

	it.each([0, -1, 1e-10])("renders fine/non-positive step %s without allocating decorative pips", (step) => {
		const onChange = vi.fn();
		const { container } = render(<Slider label="Fine" min={0} max={100} value={0} step={step} onChange={onChange} />);
		const slider = screen.getByRole("slider", { name: "Fine" });
		const safeStep = Math.max(Number.EPSILON, step);
		expect(slider.getAttribute("step")).toBe(String(safeStep));
		expect(container.querySelectorAll("span.size-\\[5px\\]")).toHaveLength(0);
		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith(safeStep);
	});
	it("exposes an accessible controlled range and handles keyboard boundaries", () => {
		const onChange = vi.fn();
		render(
			<Slider
				aria-label="Temperature"
				label="Temperature"
				min={10}
				max={50}
				step={5}
				value={25}
				onChange={onChange}
			/>,
		);

		const slider = screen.getByRole("slider", { name: "Temperature" });
		expect(slider.getAttribute("min")).toBe("10");
		expect(slider.getAttribute("max")).toBe("50");
		expect(slider.getAttribute("aria-valuetext")).toBe("25");

		fireEvent.keyDown(slider, { key: "ArrowRight" });
		expect(onChange).toHaveBeenCalledWith(30);
		fireEvent.keyDown(slider, { key: "Home" });
		expect(onChange).toHaveBeenCalledWith(10);
		fireEvent.keyDown(slider, { key: "End" });
		expect(onChange).toHaveBeenCalledWith(50);
	});

	it("clamps out-of-range controlled values and disables the native range", () => {
		render(<Slider size="compact" label="Level" min={0} max={10} value={20} onChange={vi.fn()} disabled />);

		const slider = screen.getByRole("slider", { name: "Level" });
		expect(slider.getAttribute("aria-valuetext")).toBe("10");
		expect(slider.hasAttribute("disabled")).toBe(true);
		const value = screen.getByRole("button", { name: /Level: 10/ });
		expect(value.hasAttribute("disabled")).toBe(true);
	});

	it("includes the visible value in the value editor's accessible name", () => {
		render(<Slider size="compact" label="Level" min={0} max={10} value={7} onChange={vi.fn()} />);

		const value = screen.getByRole("button", { name: /Level: 7/ });
		fireEvent.click(value);
		expect(screen.getByRole("spinbutton", { name: "Edit slider value" })).toBeTruthy();
	});
});
