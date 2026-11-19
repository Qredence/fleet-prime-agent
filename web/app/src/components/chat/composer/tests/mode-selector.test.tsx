import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModeSelector } from "@/components/chat/composer/composer-controls";

const MODES = [
	{ id: "agent", label: "Agent", description: "Full tools" },
	{ id: "ask", label: "Ask", description: "Read only" },
	{ id: "plan", label: "Plan", description: "Plan first" },
];

describe("ModeSelector", () => {
	it("exposes a dialog popup holding a labelled radio group", () => {
		render(<ModeSelector modes={MODES} value="agent" onChange={vi.fn()} />);

		const trigger = screen.getByRole("button", { name: "Select mode, Agent" });
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(trigger);

		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();
		expect(screen.getByRole("radio", { name: /Agent/ }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("radio", { name: /Ask/ }).getAttribute("aria-checked")).toBe("false");
	});

	it("closes when a mode option is clicked", async () => {
		const onChange = vi.fn();
		render(<ModeSelector modes={MODES} value="agent" onChange={onChange} />);

		fireEvent.click(screen.getByRole("button", { name: "Select mode, Agent" }));
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();

		fireEvent.click(screen.getByRole("radio", { name: /Ask/ }));
		expect(onChange).toHaveBeenCalledWith("ask");
		// Base UI unmounts the popup after its exit animation.
		await waitFor(() => expect(screen.queryByRole("radiogroup")).toBeNull());
	});

	it("moves the checked option with arrow keys and keeps the group open", async () => {
		function Harness() {
			const [mode, setMode] = useState("agent");
			return <ModeSelector modes={MODES} value={mode} onChange={setMode} />;
		}

		render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: "Select mode, Agent" }));
		const agent = screen.getByRole("radio", { name: /Agent/ });
		agent.focus();

		fireEvent.keyDown(agent, { key: "ArrowDown" });

		await waitFor(() => expect(screen.getByRole("radio", { name: /Ask/ }).getAttribute("aria-checked")).toBe("true"));
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();

		fireEvent.keyDown(screen.getByRole("radio", { name: /Ask/ }), { key: "ArrowUp" });

		await waitFor(() =>
			expect(screen.getByRole("radio", { name: /Agent/ }).getAttribute("aria-checked")).toBe("true"),
		);
	});

	it("leaves Home and End to the browser", async () => {
		function Harness() {
			const [mode, setMode] = useState("ask");
			return <ModeSelector modes={MODES} value={mode} onChange={setMode} />;
		}

		render(<Harness />);

		fireEvent.click(screen.getByRole("button", { name: "Select mode, Ask" }));
		const ask = screen.getByRole("radio", { name: /Ask/ });
		ask.focus();

		fireEvent.keyDown(ask, { key: "Home" });
		fireEvent.keyDown(ask, { key: "End" });

		await act(async () => {
			await Promise.resolve();
		});

		expect(screen.getByRole("radio", { name: /Ask/ }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();
	});
});
