import { render, screen } from "@testing-library/react";
import { Bot } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ComposerSelectorTrigger } from "./composer-selector-trigger";

describe("ComposerSelectorTrigger", () => {
	it("renders label, optional icon, and chevron", () => {
		render(
			<ComposerSelectorTrigger
				ariaLabel="Select mode"
				label="Agent"
				leadingIcon={<Bot data-testid="mode-icon" />}
			/>,
		);

		expect(screen.getByRole("button", { name: "Select mode" })).toBeTruthy();
		expect(screen.getByText("Agent")).toBeTruthy();
		expect(screen.getByTestId("mode-icon")).toBeTruthy();
	});

	it("renders combobox semantics when requested", () => {
		render(
			<ComposerSelectorTrigger
				ariaLabel="Select model and reasoning effort"
				label="Model"
				combobox
				open
				popupId="model-popup"
			/>,
		);

		const trigger = screen.getByRole("combobox", { name: "Select model and reasoning effort" });
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(trigger.getAttribute("aria-controls")).toBe("model-popup");
		expect(trigger.getAttribute("data-state")).toBe("open");
	});

	it("hides chevron when showChevron is false", () => {
		const { container } = render(
			<ComposerSelectorTrigger ariaLabel="Select mode" label="Agent" showChevron={false} />,
		);

		expect(container.querySelector("svg")).toBeNull();
	});
});
