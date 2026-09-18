import { fireEvent, render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComposerSelectorTrigger } from "../input/composer-selector-trigger";
import { Popover } from "../input/input-popover";

describe("ComposerSelectorTrigger", () => {
	it("renders label, optional icon, and chevron", () => {
		render(
			<ComposerSelectorTrigger
				ariaLabel="Select mode, Agent"
				label="Agent"
				leadingIcon={<Bot data-testid="mode-icon" />}
			/>,
		);

		expect(screen.getByRole("button", { name: "Select mode, Agent" })).toBeTruthy();
		expect(screen.getByText("Agent")).toBeTruthy();
		expect(screen.getByTestId("mode-icon")).toBeTruthy();
	});

	it("renders combobox semantics when requested", () => {
		render(
			<ComposerSelectorTrigger
				ariaLabel="Select model and reasoning effort, Model"
				label="Model"
				combobox
				open
				popupId="model-popup"
			/>,
		);

		const trigger = screen.getByRole("combobox", { name: "Select model and reasoning effort, Model" });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(trigger.getAttribute("aria-controls")).toBe("model-popup");
		expect(trigger.getAttribute("data-state")).toBe("open");
	});

	it("hides chevron when showChevron is false", () => {
		const { container } = render(
			<ComposerSelectorTrigger ariaLabel="Select mode, Agent" label="Agent" showChevron={false} />,
		);

		expect(container.querySelector("svg")).toBeNull();
	});

	it("forwards native button props such as onClick", () => {
		const onClick = vi.fn();
		render(<ComposerSelectorTrigger ariaLabel="Select mode, Agent" label="Agent" onClick={onClick} />);

		fireEvent.click(screen.getByRole("button", { name: "Select mode, Agent" }));

		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("opens a Popover menu when the trigger is clicked", () => {
		function Harness() {
			const [open, setOpen] = useState(false);
			return (
				<Popover
					open={open}
					onOpenChange={setOpen}
					trigger={
						<ComposerSelectorTrigger
							ariaLabel="Select mode, Agent"
							label="Agent"
							open={open}
							aria-haspopup="dialog"
							aria-expanded={open}
						/>
					}
				>
					<div role="radiogroup" aria-label="Select mode">
						Mode options
					</div>
				</Popover>
			);
		}

		render(<Harness />);

		expect(screen.queryByRole("radiogroup")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Select mode, Agent" }));
		expect(screen.getByRole("radiogroup", { name: "Select mode" })).toBeTruthy();
	});

	it("exposes expanded state for non-combobox popover triggers", () => {
		render(
			<ComposerSelectorTrigger
				ariaLabel="Select mode, Agent"
				label="Agent"
				open
				aria-haspopup="dialog"
				aria-expanded
				aria-controls="mode-popup"
			/>,
		);

		const trigger = screen.getByRole("button", { name: "Select mode, Agent" });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.getAttribute("aria-controls")).toBe("mode-popup");
	});
});
