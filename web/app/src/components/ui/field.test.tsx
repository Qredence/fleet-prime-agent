import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

describe("Field", () => {
	it("associates a single control with its visible label and description", () => {
		render(
			<Field>
				<FieldLabel>Retry delay</FieldLabel>
				<Input type="number" />
				<FieldDescription>Delay before retrying.</FieldDescription>
			</Field>,
		);

		const control = screen.getByRole("spinbutton", { name: "Retry delay" });
		const label = screen.getByText("Retry delay") as HTMLLabelElement;
		const description = screen.getByText("Delay before retrying.");

		expect(label.htmlFor).toBe(control.id);
		expect(label.control).toBe(control);
		expect(control.getAttribute("aria-describedby")).toContain(description.id);
	});

	it("associates labels and descriptions with Base UI switches", () => {
		render(
			<Field>
				<FieldLabel htmlFor="oauth-switch">Use OAuth</FieldLabel>
				<FieldDescription>Sign in through Prime Agent.</FieldDescription>
				<Switch id="oauth-switch" />
			</Field>,
		);

		const control = screen.getByRole("switch", { name: "Use OAuth" });
		const label = screen.getByText("Use OAuth") as HTMLLabelElement;
		const description = screen.getByText("Sign in through Prime Agent.");
		expect(label.htmlFor).toBe("");
		expect(control.getAttribute("aria-labelledby")).toContain(label.id);
		expect(control.getAttribute("aria-describedby")).toContain(description.id);
		fireEvent.click(control);
		expect(control.getAttribute("aria-checked")).toBe("true");
	});

	it("labels a field group when it contains multiple controls", () => {
		render(
			<Field>
				<FieldLabel>Arguments</FieldLabel>
				<Input aria-label="Argument one" />
				<Input aria-label="Argument two" />
				<FieldDescription>Each row is one exact argument.</FieldDescription>
			</Field>,
		);

		const group = screen.getByRole("group", { name: "Arguments" });
		const description = screen.getByText("Each row is one exact argument.");
		expect(group.getAttribute("aria-describedby")).toContain(description.id);
	});
});
