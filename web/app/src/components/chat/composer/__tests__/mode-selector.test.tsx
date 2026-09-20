import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModeSelector } from "@/components/chat/composer/input/mode-selector";

const MODES = [
	{ id: "agent", label: "Agent", description: "Full tools" },
	{ id: "ask", label: "Ask", description: "Read only" },
	{ id: "plan", label: "Plan", description: "Plan first" },
];

describe("ModeSelector", () => {
	it("exposes radiogroup semantics with expanded trigger state", () => {
		render(<ModeSelector modes={MODES} value="agent" onChange={vi.fn()} />);

		const trigger = screen.getByRole("button", { name: "Select mode, Agent" });
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(trigger);

		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: /Agent/ }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("radio", { name: /Ask/ }).getAttribute("aria-checked")).toBe("false");
	});

	it("closes when a mode option is clicked", () => {
		const onChange = vi.fn();
		render(<ModeSelector modes={MODES} value="agent" onChange={onChange} />);

		fireEvent.click(screen.getByRole("button", { name: "Select mode, Agent" }));
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();

		fireEvent.click(screen.getByRole("radio", { name: /Ask/ }));
		expect(onChange).toHaveBeenCalledWith("ask");
		expect(screen.queryByRole("radiogroup")).toBeNull();
	});

	it("moves selection with arrow keys while open", () => {
		function Harness() {
			const [mode, setMode] = useState("agent");
			return <ModeSelector modes={MODES} value={mode} onChange={setMode} />;
		}

		render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: "Select mode, Agent" }));
		const agent = screen.getByRole("radio", { name: /Agent/ });
		agent.focus();

		fireEvent.keyDown(agent, { key: "ArrowDown" });
		expect(screen.getByRole("radio", { name: /Ask/ }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();
	});
});
