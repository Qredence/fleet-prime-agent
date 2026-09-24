import { fireEvent, render, screen } from "@testing-library/react";
import { Folder } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { getResourceCanvasMaxWidth } from "@/components/layout/canvas-utils";
import { ResizableCanvas } from "@/components/layout/resizable-canvas";

describe("ResizableCanvas", () => {
	it("renders an accessible WAI-ARIA separator with keyboard navigation", () => {
		const onWidthChange = vi.fn();
		const onResizeStart = vi.fn();
		const onClose = vi.fn();

		render(
			<ResizableCanvas
				open={true}
				title="Workspace"
				titleIcon={Folder}
				width={350}
				loading={false}
				onClose={onClose}
				onResizeStart={onResizeStart}
				onWidthChange={onWidthChange}
			>
				<div>Panel content</div>
			</ResizableCanvas>,
		);

		const separator = screen.getByRole("separator", { name: "Resize Workspace panel" });
		expect(separator).not.toBeNull();
		expect(separator.getAttribute("aria-orientation")).toBe("vertical");
		expect(separator.getAttribute("aria-valuenow")).toBe("350");
		expect(separator.getAttribute("aria-valuemin")).toBe("320");
		expect(separator.getAttribute("aria-valuemax")).toBe(String(getResourceCanvasMaxWidth()));

		// ArrowLeft: expands width by 16px (350 + 16 = 366)
		fireEvent.keyDown(separator, { key: "ArrowLeft" });
		expect(onWidthChange).toHaveBeenCalledWith(366);

		// ArrowRight: shrinks width by 16px (350 - 16 = 334)
		fireEvent.keyDown(separator, { key: "ArrowRight" });
		expect(onWidthChange).toHaveBeenCalledWith(334);

		// Home: collapses to minimum
		fireEvent.keyDown(separator, { key: "Home" });
		expect(onWidthChange).toHaveBeenCalledWith(320);

		// End: expands to the clamped maximum
		fireEvent.keyDown(separator, { key: "End" });
		expect(onWidthChange).toHaveBeenCalledWith(getResourceCanvasMaxWidth());
	});
});
