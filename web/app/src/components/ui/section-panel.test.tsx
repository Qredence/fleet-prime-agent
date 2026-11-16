import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { SectionPanel } from "@/components/ui/section-panel";

describe("SectionPanel", () => {
	it("renders its heading, description, actions, and body", () => {
		render(
			<SectionPanel title="Providers" description="Manage configured providers." actions={<Button>Refresh</Button>}>
				<p>Provider list</p>
			</SectionPanel>,
		);

		expect(screen.getByRole("heading", { level: 3, name: "Providers" })).toBeTruthy();
		expect(screen.getByText("Manage configured providers.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
		expect(screen.getByText("Provider list")).toBeTruthy();
	});
});
