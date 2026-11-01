import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Bell, Settings } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabStrip, type TabStripItem } from "@/components/layout/tab-strip";

const tabs: Array<TabStripItem> = [
	{ id: "first", label: "First", icon: Bell },
	{ id: "second", label: "Second", icon: Settings, badge: 3 },
	{ id: "third", label: "Third", dotClassName: "bg-success", statusLabel: "streaming" },
];

function ControlledStrip({ onClose }: { onClose?: (id: string) => void }) {
	const [value, setValue] = useState<string | null>("first");
	return <TabStrip onClose={onClose} onValueChange={setValue} tabs={tabs} value={value} />;
}

describe("TabStrip", () => {
	it("renders one tablist with selected state and badge text", () => {
		render(<ControlledStrip />);

		expect(screen.getAllByRole("tablist")).toHaveLength(1);
		expect(screen.getAllByRole("tab")).toHaveLength(3);
		expect(screen.getByRole("tab", { name: "First" }).getAttribute("aria-selected")).toBe("true");
		expect(screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("false");
		expect(screen.getByRole("tab", { name: "Second" }).textContent).toContain("3");
	});

	it("appends the status label to the accessible name", () => {
		render(<ControlledStrip />);

		expect(screen.getByRole("tab", { name: "Third, streaming" })).toBeTruthy();
	});

	it("prefers an explicit ariaLabel over label and status", () => {
		render(
			<TabStrip
				onValueChange={vi.fn()}
				tabs={[{ id: "repl", label: "REPL", ariaLabel: "REPL runs" }]}
				value="repl"
			/>,
		);

		expect(screen.getByRole("tab", { name: "REPL runs" })).toBeTruthy();
	});

	it("moves selection with arrow keys and Home/End", async () => {
		render(<ControlledStrip />);

		fireEvent.keyDown(screen.getByRole("tab", { name: "First" }), { key: "ArrowRight" });
		await waitFor(() =>
			expect(screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("true"),
		);

		fireEvent.keyDown(screen.getByRole("tab", { name: "Second" }), { key: "End" });
		await waitFor(() =>
			expect(screen.getByRole("tab", { name: "Third, streaming" }).getAttribute("aria-selected")).toBe("true"),
		);

		fireEvent.keyDown(screen.getByRole("tab", { name: "Third, streaming" }), { key: "Home" });
		await waitFor(() =>
			expect(screen.getByRole("tab", { name: "First" }).getAttribute("aria-selected")).toBe("true"),
		);
	});

	it("re-fires selection when the active tab is pressed again", () => {
		const onValueChange = vi.fn();
		render(<TabStrip onValueChange={onValueChange} tabs={tabs} value="first" />);

		fireEvent.click(screen.getByRole("tab", { name: "First" }));

		expect(onValueChange).toHaveBeenCalledWith("first");
	});

	it("selects a different tab on click", () => {
		render(<ControlledStrip />);

		fireEvent.click(screen.getByRole("tab", { name: "Second" }));

		expect(screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected")).toBe("true");
	});

	it("renders a close control per closable tab and never selects on close", () => {
		const onClose = vi.fn();
		const onValueChange = vi.fn();
		render(
			<TabStrip
				onClose={onClose}
				onValueChange={onValueChange}
				tabs={[{ id: "child", label: "Child", closable: true }]}
				value="child"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Close Child tab" }));

		expect(onClose).toHaveBeenCalledWith("child");
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("omits close controls when no onClose is provided", () => {
		render(
			<TabStrip onValueChange={vi.fn()} tabs={[{ id: "child", label: "Child", closable: true }]} value="child" />,
		);

		expect(screen.queryByRole("button", { name: "Close Child tab" })).toBeNull();
	});

	it("renders the new-session control only when asked", () => {
		const onNewSession = vi.fn();
		const { unmount } = render(
			<TabStrip onNewSession={onNewSession} onValueChange={vi.fn()} tabs={tabs} value="first" />,
		);

		fireEvent.click(screen.getByTestId("new-chat-tab"));
		expect(onNewSession).toHaveBeenCalledOnce();
		unmount();

		render(<TabStrip onValueChange={vi.fn()} tabs={tabs} value="first" />);
		expect(screen.queryByTestId("new-chat-tab")).toBeNull();
	});

	it("wires trigger and panel IDs only when idPrefix is set", () => {
		const { unmount } = render(
			<TabStrip idPrefix="strip" onValueChange={vi.fn()} tabs={[{ id: "a b", label: "A" }]} value="a b" />,
		);

		const trigger = screen.getByRole("tab", { name: "A" });
		expect(trigger.id).toBe("strip-a%20b");
		expect(trigger.getAttribute("aria-controls")).toBe("strip-panel-a%20b");
		unmount();

		render(<TabStrip onValueChange={vi.fn()} tabs={[{ id: "a b", label: "A" }]} value="a b" />);
		const bare = screen.getByRole("tab", { name: "A" });
		expect(bare.getAttribute("aria-controls")).toBeNull();
	});

	it("applies fill and fit width modes distinctly", () => {
		const { unmount } = render(
			<TabStrip dataTestid="strip" onValueChange={vi.fn()} tabs={tabs} value="first" width="fill" />,
		);
		const filled = screen.getByTestId("strip").querySelector('[data-tab-id="second"]');
		expect(filled?.className).toContain("flex-1");
		unmount();

		render(<TabStrip dataTestid="strip" onValueChange={vi.fn()} tabs={tabs} value="first" width="fit" />);
		const fitted = screen.getByTestId("strip").querySelector('[data-tab-id="second"]');
		expect(fitted?.className).toContain("shrink-0");
		expect(fitted?.className).not.toContain("flex-1");
	});
});
