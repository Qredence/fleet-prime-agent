import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Slider } from "@/components/ui/slider";

describe("Slider", () => {
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
		render(<Slider label="Level" min={0} max={10} value={20} onChange={vi.fn()} disabled />);

		const slider = screen.getByRole("slider", { name: "Level" });
		expect(slider.getAttribute("aria-valuetext")).toBe("10");
		expect(slider.hasAttribute("disabled")).toBe(true);
	});
});
