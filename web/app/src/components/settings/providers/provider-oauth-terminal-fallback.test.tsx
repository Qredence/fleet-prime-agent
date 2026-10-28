import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProviderOAuthTerminalFallback } from "@/components/settings/providers/provider-oauth-terminal-fallback";

describe("ProviderOAuthTerminalFallback", () => {
	it("shows generic terminal sign-in and restart steps for the selected provider", () => {
		render(
			<ProviderOAuthTerminalFallback
				provider={{ id: "openai-codex", name: "OpenAI Codex", isConfigured: false, envVarName: "" }}
			/>,
		);

		expect(screen.getByText(/OAuth sign-in from Fleet settings is unavailable/i)).toBeTruthy();
		expect(screen.getByText(/Launch Prime Agent in a terminal/)).toBeTruthy();
		expect(screen.getByText(/same configuration directory as Fleet/)).toBeTruthy();
		expect(screen.getByText(/complete OpenAI Codex sign-in there/)).toBeTruthy();
		expect(screen.getByText(/OpenAI Codex/)).toBeTruthy();
		expect(screen.getByText(/Restart Fleet afterward/)).toBeTruthy();
	});
});
