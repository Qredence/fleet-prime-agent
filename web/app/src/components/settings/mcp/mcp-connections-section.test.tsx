import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { McpConnectionsSection } from "@/components/settings/mcp/mcp-connections-section";

describe("McpConnectionsSection OAuth fallback", () => {
	it("shows terminal sign-in guidance without offering the browser OAuth flow", () => {
		const onOAuth = vi.fn();
		render(
			<McpConnectionsSection
				connections={[
					{
						name: "linear",
						label: "Linear",
						source: "builtin",
						transport: "http",
						url: "https://mcp.linear.app/mcp",
						usesOAuth: true,
						enabled: true,
						status: "needs_auth",
					},
				]}
				isLoading={false}
				isPending={false}
				onOAuth={onOAuth}
			/>,
		);

		expect(screen.getByText(/Sign-in has to run inside Prime Agent/)).toBeTruthy();
		// The guidance must name the command that actually exists: the CLI has no
		// `mcp login` subcommand, and only the interactive TUI dispatches this.
		expect(screen.getByText(/\/mcp login linear/)).toBeTruthy();
		// Restarting Fleet cannot reload a detached daemon that re-reads auth.json
		// per call, so the copy must not tell the user to restart.
		expect(screen.queryByText(/restart Fleet/i)).toBeNull();
		expect(screen.queryByText(/Launch Prime Agent in a terminal and complete sign-in/)).toBeNull();
		// The env var only applies when the directory is non-default; it must be
		// presented as conditional rather than as the primary instruction.
		expect(screen.getByText(/non-default account directory/)).toBeTruthy();
		expect(screen.queryByRole("button", { name: /sign in with linear/i })).toBeNull();
		expect(onOAuth).not.toHaveBeenCalled();
	});

	it("does not submit a bearer token alongside OAuth after re-enabling the toggle", async () => {
		const onUpsert = vi.fn().mockResolvedValue(undefined);
		render(<McpConnectionsSection connections={[]} isLoading={false} isPending={false} onUpsert={onUpsert} />);

		fireEvent.click(screen.getByRole("button", { name: /add server/i }));
		fireEvent.change(screen.getByLabelText("MCP server name"), { target: { value: "docs" } });
		fireEvent.change(screen.getByLabelText("MCP server URL"), { target: { value: "https://mcp.example.com/mcp" } });

		// Enter a token with OAuth off, then turn OAuth back on. The token field
		// disappears; submitting must not resurrect it, because the server rejects
		// OAuth combined with a bearer-token variable.
		fireEvent.click(screen.getByLabelText("Use OAuth"));
		fireEvent.change(screen.getByLabelText("Bearer token environment variable"), {
			target: { value: "DOCS_TOKEN" },
		});
		fireEvent.click(screen.getByLabelText("Use OAuth"));
		expect(screen.queryByLabelText("Bearer token environment variable")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

		await vi.waitFor(() => expect(onUpsert).toHaveBeenCalledTimes(1));
		expect(onUpsert).toHaveBeenCalledWith({
			name: "docs",
			transport: "http",
			url: "https://mcp.example.com/mcp",
			oauth: true,
			force: true,
		});
	});
});
