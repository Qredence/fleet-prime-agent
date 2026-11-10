import { BuiltinActionType } from "@openuidev/react-lang";
import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	panel: null as {
		artifactRuns: Array<{ id: string; runId: string; artifacts: PrimeAgentArtifact[] }>;
		sessionId: string;
		openArtifact?: (artifactId: string, target?: string) => void;
		setRightPanel?: (panel: string) => void;
	} | null,
	rendererProps: null as {
		onAction?: (event: { type: string; params: { message?: string }; humanFriendlyMessage: string }) => void;
	} | null,
	cloudProps: null as { preview?: boolean; interpreter?: { url: string } } | null,
}));

vi.mock("@/components/layout/right-panel-context", () => ({
	useChatPanelDataContext: () => mocks.panel,
	useOptionalChatPanelDataContext: () => mocks.panel,
}));

vi.mock("@/components/openui/openui-session-context", () => ({
	useOpenUISession: () => ({ sessionId: "session-1", projectId: "project-1" }),
}));

vi.mock("@openuidev/dashboard-library", () => ({
	library: {},
	ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@openuidev/react-lang", () => ({
	BuiltinActionType: { ContinueConversation: "continue_conversation", OpenUrl: "open_url" },
	Renderer: (props: {
		response?: string;
		onAction?: (event: { type: string; params: { message?: string }; humanFriendlyMessage: string }) => void;
	}) => {
		mocks.rendererProps = props;
		return <div data-testid="local-dashboard">{props.response}</div>;
	},
}));

vi.mock("@openuidev/react-ui/cloud", () => ({
	OpenUICloudProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	LiveArtifactRenderer: (props: { response?: string; preview?: boolean; interpreter?: { url: string } }) => {
		mocks.cloudProps = props;
		return <div data-testid="cloud-dashboard">{props.response}</div>;
	},
}));

import { DashboardRequestCard } from "@/components/dashboards/dashboard-view";
import { DashboardsPanel } from "@/components/dashboards/dashboards-panel";

function dashboardArtifact(output: PrimeAgentArtifact["output"], sourceMessageId?: string): PrimeAgentArtifact {
	return {
		id: "dashboard-1",
		runId: "dashboard-run",
		sourceMessageId,
		kind: "openui-dashboard",
		title: "Revenue",
		status: "success",
		output,
		timestamp: 1,
	};
}

function installPanel(artifacts: PrimeAgentArtifact[] = []) {
	mocks.panel = {
		artifactRuns: [{ id: "run", runId: "run", artifacts }],
		sessionId: "session-1",
	};
}

function fence(body: Record<string, unknown>): string {
	return `\`\`\`openui-dashboard\n${JSON.stringify(body)}\n\`\`\``;
}

describe("DashboardRequestCard", () => {
	beforeEach(() => {
		installPanel();
	});

	it("shows a program fence as an attachment and does not draw the board in the message", () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		render(<DashboardRequestCard content={fence({ title: "Revenue", program: "root = Dashboard([])" })} />);
		expect(screen.getByText("Revenue")).toBeTruthy();
		expect(screen.getByText("Dashboard")).toBeTruthy();
		expect(screen.queryByTestId("local-dashboard")).toBeNull();
		expect(screen.queryByTestId("cloud-dashboard")).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
	});

	it("shows a stored cloud board as an attachment and opens it in the Dashboards tab", () => {
		const openArtifact = vi.fn();
		installPanel([
			dashboardArtifact(
				{ mode: "cloud", response: "opaque-response", dashboardId: "art_1", fenceKey: "abc" },
				"message-1",
			),
		]);
		mocks.panel = { ...mocks.panel!, openArtifact };
		render(<DashboardRequestCard content={fence({ prompt: "revenue by day" })} messageId="message-1" />);
		expect(screen.getByText("OpenUI Cloud")).toBeTruthy();
		expect(screen.queryByTestId("cloud-dashboard")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Open Revenue" }));
		expect(openArtifact).toHaveBeenCalledWith("dashboard-1", "dashboards");
	});

	it("says the dashboard is building until the response is stored", () => {
		render(<DashboardRequestCard content={fence({ prompt: "revenue by day" })} messageId="message-1" />);
		expect(screen.getByText("Building the dashboard…")).toBeTruthy();
	});

	it("shows a cloud error without drawing another board", () => {
		installPanel([dashboardArtifact({ mode: "cloud", fenceKey: "abc", error: "billing suspended" }, "message-1")]);
		render(<DashboardRequestCard content={fence({ prompt: "revenue by day" })} messageId="message-1" />);
		expect(screen.getByText("billing suspended")).toBeTruthy();
		expect(screen.queryByTestId("cloud-dashboard")).toBeNull();
		expect(screen.queryByTestId("local-dashboard")).toBeNull();
	});

	it("keeps an edit error on the attachment and leaves the board out of the message", () => {
		installPanel([
			dashboardArtifact({
				mode: "cloud",
				response: "kept-response",
				dashboardId: "art_1",
				fenceKey: "abc",
				error: "edit failed",
			}),
		]);
		render(<DashboardRequestCard content={fence({ id: "art_1", prompt: "add a filter" })} messageId="message-2" />);
		expect(screen.getByText("edit failed")).toBeTruthy();
		expect(screen.queryByTestId("cloud-dashboard")).toBeNull();
	});

	it("shows an unreadable saved board as an older version", () => {
		installPanel([
			dashboardArtifact(
				{ mode: "self-hosted", program: "root = Dashboard([])", fallbackReason: "old" },
				"message-1",
			),
		]);
		render(<DashboardRequestCard content={fence({ prompt: "revenue by day" })} messageId="message-1" />);
		expect(screen.getByText("Saved by an older version.")).toBeTruthy();
		expect(screen.queryByTestId("cloud-dashboard")).toBeNull();
	});
});

describe("DashboardsPanel", () => {
	it("draws the selected cloud board open and a local program with its button action", () => {
		const onOpenUIAction = vi.fn();
		const cloud = dashboardArtifact(
			{ mode: "cloud", response: "opaque-response", dashboardId: "art_1", fenceKey: "abc" },
			"message-1",
		);
		const local = {
			...dashboardArtifact({ mode: "local", program: "root = Dashboard([])", fenceKey: "local" }, "message-2"),
			id: "dashboard-2",
			title: "Local",
		};
		const { rerender } = render(
			<DashboardsPanel artifacts={[cloud, local]} selectedArtifactId={cloud.id} sessionId="session-1" />,
		);
		expect(screen.getByTestId("cloud-dashboard").textContent).toBe("opaque-response");
		expect(mocks.cloudProps?.preview).toBe(false);
		expect(mocks.cloudProps?.interpreter?.url).toContain("dashboardId=dashboard-1");
		expect(screen.queryByTestId("local-dashboard")).toBeNull();

		rerender(
			<DashboardsPanel
				artifacts={[cloud, local]}
				selectedArtifactId={local.id}
				sessionId="session-1"
				onOpenUIAction={onOpenUIAction}
			/>,
		);
		expect(screen.getByTestId("local-dashboard").textContent).toBe("root = Dashboard([])");
		mocks.rendererProps?.onAction?.({
			type: BuiltinActionType.ContinueConversation,
			params: {},
			humanFriendlyMessage: "Show the Senate",
		});
		expect(onOpenUIAction).toHaveBeenCalledWith("Show the Senate");
	});
});
