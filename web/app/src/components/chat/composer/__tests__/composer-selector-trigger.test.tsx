import { fireEvent, render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ModeSelector } from "@/components/chat/composer/composer-controls";

describe("composer picker button composition", () => {
	it("keeps its label, icon, and popup relationship", () => {
		render(
			<ModeSelector
				modes={[
					{ id: "agent", label: "Agent", icon: Bot },
					{ id: "plan", label: "Plan" },
				]}
				value="agent"
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Select mode, Agent" });
		expect(trigger.textContent).toContain("Agent");
		expect(trigger.querySelector("svg")).toBeTruthy();
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(trigger.hasAttribute("data-popup-open")).toBe(true);
		const popupId = trigger.getAttribute("aria-controls");
		expect(document.getElementById(popupId ?? "")?.getAttribute("role")).toBe("dialog");
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();
	});
	it("makes a single available mode non-interactive without a chevron", () => {
		render(<ModeSelector modes={[{ id: "agent", label: "Agent" }]} value="agent" />);
		const trigger = screen.getByRole("button", { name: "Select mode, Agent" }) as HTMLButtonElement;
		expect(trigger.disabled).toBe(true);
		expect(trigger.getAttribute("tabindex")).toBe("-1");
		expect(trigger.querySelector("svg")).toBeNull();
	});
});
