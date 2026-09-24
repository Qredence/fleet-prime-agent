import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

describe("Tooltip", () => {
	it("renders its label when forced open", () => {
		render(
			<Tooltip content="Save document" forceOpen>
				<Button aria-label="Save">Save</Button>
			</Tooltip>,
		);

		expect(screen.getByText("Save document")).toBeTruthy();
	});
});
