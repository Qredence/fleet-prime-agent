import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionAgentPlan } from "@/components/tools/session-agent-plan";

describe("SessionAgentPlan", () => {
	it("renders the documented Trace plan with nested step traces", () => {
		const { container } = render(
			<SessionAgentPlan presentation={{ steps: ["Inspect", "Implement"], activeIndex: 1 }} />,
		);

		expect(screen.getByRole("button", { name: "Plan progress: 1 of 2 steps completed" })).toBeTruthy();
		expect(screen.getByText("1 of 2 done")).toBeTruthy();
		expect(container.querySelector('[data-testid="plan-trace"] [data-slot="trace-collapsible"]')).toBeTruthy();
		expect(container.querySelectorAll("[data-plan-step]")).toHaveLength(2);
	});
});
