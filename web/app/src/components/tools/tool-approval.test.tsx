import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolApproval } from "@/components/tools/tool-approval";

describe("ToolApproval", () => {
	it("uses the Confirmation Item pattern and preserves its approval controls", () => {
		const onApprove = vi.fn();
		const onAlwaysAllow = vi.fn();
		const onDeny = vi.fn();
		const { container } = render(
			<ToolApproval
				tool="Bash"
				title="Allow this command?"
				description="The command runs in this project."
				parameters={[{ id: "command", label: "Command", value: "pnpm test" }]}
				onApprove={onApprove}
				onAlwaysAllow={onAlwaysAllow}
				onDeny={onDeny}
			/>,
		);

		expect(container.querySelector('[data-slot="item"]')).toBeTruthy();
		expect(container.querySelector('[data-slot="item-media"]')).toBeTruthy();
		expect(container.querySelector('[data-slot="item-actions"]')).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "View details" }));
		expect(screen.getByText("pnpm test")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
		fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
		fireEvent.click(screen.getByRole("button", { name: "Deny" }));
		expect(onApprove).toHaveBeenCalledOnce();
		expect(onAlwaysAllow).toHaveBeenCalledOnce();
		expect(onDeny).toHaveBeenCalledOnce();
	});

	it.each([
		["pending", "Approval required", false],
		["approving", "Approving", true],
		["approved", "Approved", false],
		["denied", "Denied", false],
		["running", "Running", true],
		["complete", "Completed", false],
		["error", "Failed", false],
	] as const)("preserves the %s status presentation", (status, label, busy) => {
		const { container } = render(<ToolApproval tool="Bash" status={status} />);
		expect(screen.getByText(label)).toBeTruthy();
		expect(container.querySelector('[data-slot="item"]')?.getAttribute("aria-busy")).toBe(String(busy));
	});
});
