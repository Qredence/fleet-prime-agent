import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderOAuthTerminalFallback } from "@/components/settings/providers/provider-oauth-terminal-fallback";

describe("ProviderOAuthTerminalFallback", () => {
	it("shows terminal sign-in steps for the selected provider without a restart step", () => {
		render(
			<ProviderOAuthTerminalFallback
				provider={{ id: "openai-codex", name: "OpenAI Codex", isConfigured: false, envVarName: "" }}
			/>,
		);

		expect(screen.getByText(/Sign-in has to run inside Prime Agent/i)).toBeTruthy();
		// The command that actually exists in the interactive TUI.
		expect(screen.getByText(/\/login/)).toBeTruthy();
		expect(screen.getByText(/same account as\s*Fleet/i)).toBeTruthy();
		expect(screen.getByText(/choose OpenAI Codex/)).toBeTruthy();
		// Provider credentials are re-read per request, so no restart is required.
		expect(screen.getByText(/restart is not needed/i)).toBeTruthy();
		expect(screen.queryByText(/restart Fleet so it reloads/i)).toBeNull();
		expect(screen.queryByText(/Launch Prime Agent in a terminal and complete/)).toBeNull();
	});
});
