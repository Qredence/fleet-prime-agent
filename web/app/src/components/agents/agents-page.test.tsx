import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsPage } from "@/components/agents/agents-page";
import { chatClient } from "@/components/chat/chat-client";

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
		listProjects: vi.fn(),
		listSessions: vi.fn(),
	},
}));

const listSessions = vi.mocked(chatClient.listSessions);
const listProjects = vi.mocked(chatClient.listProjects);

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

beforeEach(() => {
	vi.clearAllMocks();
	listSessions.mockResolvedValue([]);
	listProjects.mockResolvedValue({ projects: [], sessions: [] });
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
	});

	it("shows session-list errors", async () => {
		listSessions.mockRejectedValue(new Error("Session listing failed"));
		renderPage(<AgentsPage />);
		expect(await screen.findByText("Session listing failed")).toBeTruthy();
	});
});
