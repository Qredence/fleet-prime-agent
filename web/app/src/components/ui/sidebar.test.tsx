import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar, SidebarProvider, useSidebar } from "@/components/ui/sidebar";

function ToggleState() {
	const { open, setOpen } = useSidebar();
	return (
		<button type="button" aria-label="Set sidebar state" onClick={() => setOpen(!open)}>
			{open ? "open" : "closed"}
		</button>
	);
}

describe("Sidebar", () => {
	it("keeps the controlled provider state owned by its caller", () => {
		const onOpenChange = vi.fn();
		const { rerender } = render(
			<SidebarProvider open={true} onOpenChange={onOpenChange} persist={false}>
				<ToggleState />
				<Sidebar>
					<div>Navigation</div>
				</Sidebar>
			</SidebarProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Set sidebar state" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(screen.getByRole("button", { name: "Set sidebar state" }).textContent).toBe("open");

		rerender(
			<SidebarProvider open={false} onOpenChange={onOpenChange} persist={false}>
				<ToggleState />
				<Sidebar>
					<div>Navigation</div>
				</Sidebar>
			</SidebarProvider>,
		);
		expect(screen.getByRole("button", { name: "Set sidebar state" }).textContent).toBe("closed");
	});
});
