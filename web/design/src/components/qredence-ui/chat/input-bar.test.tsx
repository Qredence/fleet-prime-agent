import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentChat } from "./agent-chat";
import { InputBar } from "./input-bar";

describe("InputBar slash menu control", () => {
	it("renders the open-slash control on the welcome composer path", () => {
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				placeholder="Ask Prime to build, investigate, or change something…"
				slashCommands={[{ id: "settings", label: "/settings", value: "/settings" }]}
			/>,
		);

		expect(screen.getByRole("button", { name: "Open slash commands" })).toBeTruthy();
		expect(document.querySelector('[data-slot="composer-add"]')).toBeTruthy();
	});

	it("shows the open-slash control left of Agent on the empty ChatWelcome composer", () => {
		render(
			<AgentChat
				inputBar={{
					modelKey: undefined,
					models: [],
					onModelChange: vi.fn(),
					slashCommands: [{ id: "settings", label: "/settings", value: "/settings" }],
				}}
				messages={[]}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
			/>,
		);

		const slashButton = screen.getByRole("button", { name: "Open slash commands" });
		const modeButton = screen.getByRole("button", { name: "Select mode" });

		expect(slashButton).toBeTruthy();
		expect(slashButton.compareDocumentPosition(modeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});
