import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsRow } from "@/components/settings/settings-row";
import { Switch } from "@/components/ui/switch";

describe("SettingsRow", () => {
	it("uses its visible label to name a settings switch", () => {
		render(
			<SettingsRow label="Auto-retry" description="Retry failed provider requests.">
				<Switch />
			</SettingsRow>,
		);

		const label = screen.getByText("Auto-retry") as HTMLLabelElement;
		const control = screen.getByRole("switch", { name: "Auto-retry" });
		const description = screen.getByText("Retry failed provider requests.");

		expect(label.id).not.toBe("");
		expect(label.htmlFor).toBe("");
		expect(control.getAttribute("aria-labelledby")).toContain(label.id);
		expect(control.getAttribute("aria-describedby")).toContain(description.id);
	});
});
