import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "@/components/ui/select";

const options = [
	{ label: "Alpha", value: "alpha" },
	{ label: "Beta", value: "beta" },
	{ label: "Unavailable", value: "unavailable", disabled: true },
];

describe("Select", () => {
	it("renders the controlled selection and publishes a selected option", async () => {
		const onValueChange = vi.fn();
		render(<Select aria-label="Project" options={options} value="alpha" onValueChange={onValueChange} />);

		const trigger = screen.getByRole("combobox", { name: "Project" });
		expect(trigger.textContent).toContain("Alpha");
		fireEvent.click(trigger);

		const beta = await screen.findByRole("option", { name: "Beta" });
		fireEvent.keyDown(beta, { key: "Enter" });
		expect(onValueChange).toHaveBeenCalledWith("beta");
	});

	it("shows a placeholder for a null value and disables unavailable options", async () => {
		render(
			<Select
				aria-label="Project"
				options={options}
				value={null}
				placeholder="Choose a project"
				onValueChange={vi.fn()}
			/>,
		);

		const trigger = screen.getByRole("combobox", { name: "Project" });
		expect(trigger.textContent).toContain("Choose a project");
		fireEvent.click(trigger);

		const unavailable = await screen.findByRole("option", { name: "Unavailable" });
		expect(unavailable.getAttribute("aria-disabled")).toBe("true");
		fireEvent.click(unavailable);
		await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
	});
});
