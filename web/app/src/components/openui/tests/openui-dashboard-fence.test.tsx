import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenerativeTextRenderer } from "@/components/openui/openui-renderer";

function fence(body: Record<string, unknown>): string {
	return `\`\`\`openui-dashboard\n${JSON.stringify(body)}\n\`\`\``;
}

describe("dashboard fences in the transcript", () => {
	it("does not show a fence-only dashboard as a code block", () => {
		render(<GenerativeTextRenderer content={fence({ title: "Midterms", prompt: "PROMPT_SHOULD_STAY_HIDDEN" })} />);
		expect(screen.getByText("Building the dashboard…")).toBeTruthy();
		expect(screen.queryByText(/PROMPT_SHOULD_STAY_HIDDEN/)).toBeNull();
	});

	it("keeps prose around a dashboard fence", () => {
		render(
			<GenerativeTextRenderer content={`Here is the board.\n${fence({ prompt: "PROMPT_SHOULD_STAY_HIDDEN" })}`} />,
		);
		expect(screen.getByText("Here is the board.")).toBeTruthy();
		expect(screen.queryByText(/PROMPT_SHOULD_STAY_HIDDEN/)).toBeNull();
	});
});
