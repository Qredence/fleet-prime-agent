import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPage } from "@/components/agents/agents-page";
import { chatClient } from "@/components/chat/chat-client";
import { ConnectorsPage } from "@/components/connectors/connectors-page";

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({ to, children, ...props }: React.ComponentProps<"a"> & { to: string }) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
	};
});

vi.mock("@/components/chat/chat-client", () => ({
	chatClient: {
		getMcpConnections: vi.fn(),
		listProjects: vi.fn(),
		listSessions: vi.fn(),
		mcpOAuth: vi.fn(),
		removeMcpConnection: vi.fn(),
		upsertMcpConnection: vi.fn(),
	},
}));

const listSessions = vi.mocked(chatClient.listSessions);
const listProjects = vi.mocked(chatClient.listProjects);
const getMcpConnections = vi.mocked(chatClient.getMcpConnections);
const upsertMcpConnection = vi.mocked(chatClient.upsertMcpConnection);
const removeMcpConnection = vi.mocked(chatClient.removeMcpConnection);
const mcpOAuth = vi.mocked(chatClient.mcpOAuth);

function renderPage(page: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{page}</QueryClientProvider>);
}

function session(sessionId: string, updatedAt: string): ChatSessionInfo {
	return {
		createdAt: updatedAt,
		firstMessage: `First message for ${sessionId}`,
		messageCount: 2,
		projectId: "project-1",
		sessionId,
		status: "idle",
		title: `Session ${sessionId}`,
		updatedAt,
	};
}

const userConnection = {
	name: "docs-server",
	label: "Docs server",
	source: "user" as const,
	transport: "http" as const,
	url: "https://mcp.example.test",
	usesOAuth: false,
	enabled: true,
	status: "anonymous" as const,
};

beforeEach(() => {
	vi.clearAllMocks();
	listSessions.mockResolvedValue([]);
	listProjects.mockResolvedValue({ projects: [], sessions: [] });
	getMcpConnections.mockResolvedValue({ connections: [] });
	upsertMcpConnection.mockResolvedValue({ connections: [userConnection] });
	removeMcpConnection.mockResolvedValue({ connections: [] });
	mcpOAuth.mockResolvedValue({ status: "success", connections: [] });
});

describe("Agents page", () => {
	it("shows loading, recent sessions, schedule availability, and a route back to sessions", async () => {
		let resolveSessions!: (value: Array<ChatSessionInfo>) => void;
		listSessions.mockReturnValue(new Promise((resolve) => (resolveSessions = resolve)));
		listProjects.mockResolvedValue({
			projects: [
				{
					createdAt: "2026-10-01T00:00:00.000Z",
					name: "Docs project",
					pathLabel: "~/docs",
					projectId: "project-1",
					sessionCount: 1,
					status: "active",
					updatedAt: "2026-10-01T00:00:00.000Z",
				},
			],
			sessions: [],
		});

		renderPage(<AgentsPage />);

		expect(screen.getByText("Loading saved sessions…")).toBeTruthy();
		expect(screen.getByText("Not supported in Fleet.")).toBeTruthy();
		expect(screen.getAllByText("Unavailable")).toHaveLength(2);
		expect(screen.getByRole("link", { name: "Agents" }).getAttribute("aria-current")).toBe("page");
		expect(screen.getByRole("link", { name: "Open sessions" }).getAttribute("href")).toBe("/");
		expect(screen.getByRole("link", { name: "Connectors" }).getAttribute("href")).toBe("/connectors");

		resolveSessions([session("s-1", "2026-10-27T10:00:00.000Z")]);

		expect(await screen.findByText("Session s-1")).toBeTruthy();
		expect(screen.getByText(/Docs project/)).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Session s-1" })).toBeNull();
	});

	it("limits the initial session list to twenty non-interactive cards", async () => {
		listSessions.mockResolvedValue(
			Array.from({ length: 25 }, (_, index) =>
				session(`s-${index}`, `2026-10-27T10:${String(index).padStart(2, "0")}:00.000Z`),
			),
		);
		renderPage(<AgentsPage />);
		expect(await screen.findAllByText("idle")).toHaveLength(20);
		expect(screen.getByRole("button", { name: "Show more sessions" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Show more sessions" }));
		expect(screen.getAllByText("idle")).toHaveLength(25);
		expect(screen.queryByRole("link", { name: "Session s-0" })).toBeNull();
	});

	it("shows session-list errors", async () => {
		listSessions.mockRejectedValue(new Error("Session listing failed"));
		renderPage(<AgentsPage />);
		expect(await screen.findByText("Could not load saved sessions")).toBeTruthy();
		expect(screen.getByText("Session listing failed")).toBeTruthy();
	});
});

describe("Connectors page", () => {
	it("shows loading while connectors are requested", async () => {
		let resolveConnections!: (value: { connections: Array<typeof userConnection> }) => void;
		getMcpConnections.mockReturnValue(new Promise((resolve) => (resolveConnections = resolve)));
		renderPage(<ConnectorsPage />);
		expect(screen.getByText("Loading MCP connections…")).toBeTruthy();
		resolveConnections({ connections: [] });
		expect(await screen.findByText("No MCP connections yet.")).toBeTruthy();
	});

	it("shows connector-list errors", async () => {
		getMcpConnections.mockRejectedValue(new Error("Connector listing failed"));
		renderPage(<ConnectorsPage />);
		expect(await screen.findByText("Could not load connectors")).toBeTruthy();
		expect(screen.getByText("Connector listing failed")).toBeTruthy();
	});

	it("adds a bearer-configured server through the existing MCP action", async () => {
		renderPage(<ConnectorsPage />);
		expect(screen.getByRole("heading", { level: 1, name: "Connectors" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Connectors" }).getAttribute("aria-current")).toBe("page");
		fireEvent.click(await screen.findByRole("button", { name: "Add server" }));
		fireEvent.change(screen.getByLabelText("MCP server name"), { target: { value: "docs" } });
		fireEvent.change(screen.getByLabelText("MCP server URL"), { target: { value: "https://docs.example.test/mcp" } });
		fireEvent.click(screen.getByRole("switch", { name: "Use OAuth" }));
		fireEvent.change(screen.getByLabelText("Bearer token environment variable"), {
			target: { value: "DOCS_TOKEN" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() =>
			expect(upsertMcpConnection).toHaveBeenCalledWith({
				name: "docs",
				transport: "http",
				url: "https://docs.example.test/mcp",
				bearerTokenEnvVar: "DOCS_TOKEN",
				force: true,
			}),
		);
	});

	it("removes a server using the existing remove action", async () => {
		getMcpConnections.mockResolvedValue({ connections: [userConnection] });
		renderPage(<ConnectorsPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Remove docs-server" }));
		fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
		await waitFor(() => expect(removeMcpConnection).toHaveBeenCalledWith({ name: "docs-server" }));
	});

	it("signs out of OAuth using the existing sign-out action", async () => {
		const oauthConnection = {
			...userConnection,
			name: "oauth-server",
			label: "OAuth server",
			usesOAuth: true,
			status: "connected" as const,
		};
		getMcpConnections.mockResolvedValue({ connections: [oauthConnection] });
		renderPage(<ConnectorsPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
		await waitFor(() => expect(mcpOAuth).toHaveBeenCalledWith({ name: "oauth-server", action: "logout" }));
	});
});
