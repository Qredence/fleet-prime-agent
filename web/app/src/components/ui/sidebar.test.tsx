import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	Sidebar,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	useSidebar,
} from "@/components/ui/sidebar";

function ToggleState() {
	const { open, setOpen } = useSidebar();
	return (
		<button type="button" aria-label="Set sidebar state" onClick={() => setOpen(!open)}>
			{open ? "open" : "closed"}
		</button>
	);
}

function OpenMobileSheet() {
	const { setOpenMobile } = useSidebar();
	return (
		<button type="button" onClick={() => setOpenMobile(true)}>
			Open mobile sheet
		</button>
	);
}

describe("Sidebar", () => {
	it("updates uncontrolled state while notifying a change listener", () => {
		const onOpenChange = vi.fn();
		render(
			<SidebarProvider defaultOpen={true} onOpenChange={onOpenChange} persist={false}>
				<ToggleState />
			</SidebarProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Set sidebar state" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(screen.getByRole("button", { name: "Set sidebar state" }).textContent).toBe("closed");
	});

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

	it("skips disabled controls during arrow-key navigation", () => {
		render(
			<SidebarMenu>
				<SidebarMenuItem>
					<SidebarMenuButton>First</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton disabled>Disabled</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton aria-disabled="true">Unavailable</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton>Last</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>,
		);

		const first = screen.getByRole("button", { name: "First" });
		const last = screen.getByRole("button", { name: "Last" });
		first.focus();
		fireEvent.keyDown(first, { key: "ArrowDown" });
		expect(document.activeElement).toBe(last);
		fireEvent.keyDown(last, { key: "ArrowDown" });
		expect(document.activeElement).toBe(first);
	});

	it("finishes a dialog-driven mobile close after one exit", () => {
		vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
		try {
			render(
				<SidebarProvider persist={false}>
					<OpenMobileSheet />
					<Sidebar>
						<div>Navigation</div>
					</Sidebar>
				</SidebarProvider>,
			);
			fireEvent.click(screen.getByRole("button", { name: "Open mobile sheet" }));
			const sheet = screen.getByRole("dialog", { name: "Sidebar" });
			vi.useFakeTimers();
			fireEvent.keyDown(sheet, { key: "Escape" });
			expect(sheet.className).toContain("pointer-events-none");
			act(() => vi.advanceTimersByTime(220));
			expect(sheet.hasAttribute("data-closed")).toBe(true);
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});
});
