import type {
	ChatSessionResponse,
	PrimeAgentArtifactRun,
	PrimeAgentRlmChild,
	PrimeAgentSessionPresentation,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtifactsPanelContent } from "@/components/artifacts/artifacts-panel";
import { collectSessionOpenUIBlocks } from "@/components/artifacts/artifacts-utils";
import { SubagentChatPanel } from "@/components/chat/subagents/subagent-chat-panel";
import { SubagentTranscriptView } from "@/components/chat/subagents/subagent-transcript";
import { SubagentsPanelContent } from "@/components/chat/subagents/subagents-panel";
import { RightPanelProvider } from "@/components/layout/right-panel-context";
import { RightPanelLauncher } from "@/components/layout/right-panel-launcher";
import { RightPanelShell } from "@/components/layout/right-panel-shell";
import { useChatShellState } from "@/components/layout/use-chat-shell-state";
import { EMPTY_CHAT_TRANSCRIPT_SUMMARY } from "@/components/sessions/transcript-summary";
import { ReplPanelContent } from "@/components/workspace/repl-panel";

vi.mock("@/components/chat/generative-text-renderer", () => ({
	SessionGenerativeTextRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/components/tools/session-tool-renderer", () => ({
	SessionToolRenderer: () => null,
}));
vi.mock("@/components/openui/openui-renderer", () => ({
	GenerativeTextRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));

const emptyPresentation: PrimeAgentSessionPresentation = {
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
	artifactRuns: [],
};

let notifyResize: (() => void) | undefined;

function ChatShellStateProbe() {
	const { openArtifact, rightPanel, selectedArtifactId } = useChatShellState(undefined, {
		sessionMetadata: {},
		setSessionMetadata: vi.fn(),
	});

	return (
		<div>
			<button type="button" onClick={() => openArtifact("repl-1", "repl")}>
				Open REPL cell
			</button>
			<span data-testid="probe-panel">{rightPanel ?? "closed"}</span>
			<span data-testid="probe-selection">{selectedArtifactId ?? "none"}</span>
		</div>
	);
}

function mockLauncherLayout(availableWidth: number, requiredWidth: number, options?: { clipBoundingRect?: boolean }) {
	const observers = new Set<TestResizeObserver>();

	class TestResizeObserver {
		readonly callback: ResizeObserverCallback;

		constructor(callback: ResizeObserverCallback) {
			this.callback = callback;
			observers.add(this);
		}

		observe() {}

		unobserve() {}

		disconnect() {
			observers.delete(this);
		}
	}

	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	notifyResize = () => {
		for (const observer of observers) observer.callback([], observer);
	};

	return (launcher: HTMLElement) => {
		const measurement = launcher.querySelector<HTMLElement>("[data-panel-launcher-measurement]");
		expect(measurement).not.toBeNull();
		Object.defineProperty(launcher, "clientWidth", {
			configurable: true,
			value: availableWidth,
		});
		if (launcher.parentElement) {
			Object.defineProperty(launcher.parentElement, "clientWidth", {
				configurable: true,
				value: availableWidth,
			});
		}
		if (measurement) {
			const reportedBoxWidth = options?.clipBoundingRect ? availableWidth : requiredWidth;
			Object.defineProperty(measurement, "scrollWidth", {
				configurable: true,
				value: requiredWidth,
			});
			const inner = measurement.firstElementChild;
			if (inner instanceof HTMLElement) {
				Object.defineProperty(inner, "scrollWidth", {
					configurable: true,
					value: requiredWidth,
				});
				vi.spyOn(inner, "getBoundingClientRect").mockReturnValue({
					width: reportedBoxWidth,
				} as DOMRect);
			}
			vi.spyOn(measurement, "getBoundingClientRect").mockReturnValue({
				width: reportedBoxWidth,
			} as DOMRect);
		}
		act(() => notifyResize?.());
	};
}

afterEach(() => {
	notifyResize = undefined;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("right-panel execution tabs", () => {
	function renderPanelShell(matchesDesktop: boolean, rightPanel: "resources" | "workspace" = "resources") {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: matchesDesktop && query === "(min-width: 960px)",
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		);

		return render(
			<RightPanelProvider
				chatPanelData={
					{
						artifactRuns: [],
						chatMode: "agent",
						loadSession: vi.fn(),
						loadSubagentSession: vi.fn(),
						models: [],
						transcriptSummary: EMPTY_CHAT_TRANSCRIPT_SUMMARY,
						presentation: emptyPresentation,
						queue: { steering: [], followUp: [] },
						refreshResources: vi.fn(),
						resources: null,
						resourcesError: null,
						resourcesLoading: false,
						reopenRightPanel: vi.fn(),
						rightPanel,
						selectedArtifactId: null,
						sessionId: "session-1",
						setRightPanel: vi.fn(),
						status: "ready",
					} as never
				}
				onOpenUIAction={vi.fn()}
				settingsActions={{
					onThemePreferenceChange: vi.fn(),
					saveSettings: vi.fn(),
					settings: null,
					settingsError: null,
					settingsLoading: false,
					themePreference: "system",
				}}
				workspaceTree={{
					loadWorkspaceFile: vi.fn(),
					openWorkspacePath: vi.fn(),
					refreshWorkspace: vi.fn(),
					selectedWorkspacePath: null,
					setSelectedWorkspacePath: vi.fn(),
					workspaceError: null,
					workspaceLoading: false,
					workspaceTree: null,
				}}
			>
				<RightPanelShell handleResourceCanvasResizeStart={vi.fn()} onClose={vi.fn()} resourceCanvasWidth={400} />
			</RightPanelProvider>,
		);
	}

	it("mounts only the desktop panel tree on desktop", () => {
		const { getByTestId, queryByTestId } = renderPanelShell(true);

		expect(getByTestId("pi-resources-canvas")).toBeTruthy();
		expect(queryByTestId("pi-resources-mobile-panel")).toBeNull();
	});

	it("mounts only the mobile panel tree below the desktop breakpoint", () => {
		const { getByTestId, queryByTestId } = renderPanelShell(false);

		expect(getByTestId("pi-resources-mobile-panel")).toBeTruthy();
		expect(queryByTestId("pi-resources-canvas")).toBeNull();
	});

	it("exposes the four top-level panel groups and opens their default views", () => {
		const onPanelChange = vi.fn();
		const layout = mockLauncherLayout(500, 400);
		const { getByTestId, rerender } = render(
			<RightPanelLauncher
				activePanel={null}
				onPanelChange={onPanelChange}
				resources={null}
				replRuns={2}
				sessionBlocks={1}
				openUIArtifacts={2}
				workspace={null}
			/>,
		);
		layout(getByTestId("right-panel-inline-launcher"));

		expect(getByTestId("right-panel-inline-launcher").getAttribute("data-panel-launcher-mode")).toBe("tabs");
		expect(screen.getAllByRole("tab")).toHaveLength(4);
		expect(screen.getByRole("tab", { name: "REPL" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Subagents" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Workspace" }).textContent).toContain("3");
		fireEvent.click(screen.getByRole("tab", { name: "Session" }));
		expect(onPanelChange).toHaveBeenCalledWith("session-insights");

		rerender(
			<RightPanelLauncher activePanel="subagents" onPanelChange={onPanelChange} resources={null} workspace={null} />,
		);
		layout(getByTestId("right-panel-inline-launcher"));
		expect(screen.getByRole("tab", { name: "Subagents" })).toBeTruthy();
	});

	it("exposes the four panel groups in the overflow-mode dropdown", async () => {
		const onPanelChange = vi.fn();
		const layout = mockLauncherLayout(120, 400);
		const { getByRole, getByTestId, rerender } = render(
			<RightPanelLauncher activePanel="subagents" onPanelChange={onPanelChange} resources={null} workspace={null} />,
		);
		layout(getByTestId("right-panel-inline-launcher"));
		await waitFor(() =>
			expect(getByTestId("right-panel-inline-launcher").getAttribute("data-panel-launcher-mode")).toBe("dropdown"),
		);

		const select = getByRole("combobox", { name: "Select panel" });
		fireEvent.click(select);
		const options = await screen.findAllByRole("option");
		expect(options).toHaveLength(4);
		expect(options.map((option) => option.textContent?.trim())).toEqual([
			"Workspace",
			"Subagents",
			"Session",
			"REPL",
		]);

		rerender(
			<RightPanelLauncher activePanel="subagents" onPanelChange={onPanelChange} resources={null} workspace={null} />,
		);
		layout(getByTestId("right-panel-inline-launcher"));
		fireEvent.click(getByRole("combobox", { name: "Select panel" }));
		expect(screen.getByRole("option", { name: "Subagents" })).toBeTruthy();
	});

	it("keeps file and artifact views under Workspace and skills, insights, and tree under Session", () => {
		const workspace = renderPanelShell(true, "workspace");
		expect(screen.getByRole("tab", { name: "Files" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Artifacts" })).toBeTruthy();
		workspace.unmount();

		renderPanelShell(true, "resources");
		expect(screen.getByRole("tab", { name: "Skills" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Insights" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Tree" })).toBeTruthy();
	});

	it("switches to a dropdown when a narrow canvas header cannot fit badged tab labels", async () => {
		const onPanelChange = vi.fn();
		const layout = mockLauncherLayout(360, 520, { clipBoundingRect: true });
		const { getByRole, getByTestId } = render(
			<RightPanelLauncher
				activePanel="session-insights"
				onPanelChange={onPanelChange}
				resources={null}
				replRuns={7}
				sessionBlocks={0}
				openUIArtifacts={0}
				workspace={null}
			/>,
		);
		layout(getByTestId("right-panel-inline-launcher"));

		await waitFor(() =>
			expect(getByTestId("right-panel-inline-launcher").getAttribute("data-panel-launcher-mode")).toBe("dropdown"),
		);
		expect(getByRole("combobox", { name: "Select panel" })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: "Session insights" })).toBeNull();
	});

	it("counts and renders OpenUI and technical artifacts with session UI blocks", () => {
		const artifactRuns: Array<PrimeAgentArtifactRun> = [
			{
				id: "run-1",
				runId: "run-1",
				artifacts: [
					{
						id: "openui-1",
						runId: "run-1",
						kind: "openui-html",
						title: "Generated dashboard",
						status: "success",
						output: { title: "Generated dashboard", document: "<div>Dashboard</div>" },
						timestamp: 1,
					},
					{
						id: "ipython-1",
						runId: "run-1",
						kind: "ipython",
						title: "IPython",
						status: "success",
						input: { code: "print('hello')" },
						output: { stdout: "hello" },
						timestamp: 2,
					},
					{
						id: "recap-1",
						runId: "run-1",
						kind: "recap",
						title: "Historical recap",
						status: "success",
						output: "A historical summary",
						timestamp: 0,
					},
					{
						id: "diff-1",
						runId: "run-1",
						kind: "diff",
						title: "Edit",
						status: "error",
						output: { error: "permission denied" },
						timestamp: 3,
					},
				],
			},
		];
		const messages: Array<ChatMessage> = [
			{
				id: "assistant-ui",
				role: "assistant",
				parts: [{ type: "text", text: "```openui\nroot = Card\n```" }],
			},
		];

		render(
			<ArtifactsPanelContent
				artifactRuns={artifactRuns}
				openUIBlocks={collectSessionOpenUIBlocks(messages)}
				status="ready"
			/>,
		);

		expect(screen.getByText("OpenUI artifacts")).toBeTruthy();
		expect(screen.getByText("Generated dashboard")).toBeTruthy();
		expect(screen.getByText("Generative UI")).toBeTruthy();
		expect(screen.getByText("Card")).toBeTruthy();
		expect(screen.getByText("Technical artifacts")).toBeTruthy();
		expect(screen.queryByText("Historical recap")).toBeNull();
		expect(screen.queryByText("A historical summary")).toBeNull();
		expect(screen.queryByText("print('hello')")).toBeNull();
		expect(screen.getByText("permission denied")).toBeTruthy();
	});

	it("renders recorded IPython cells in the REPL panel", () => {
		const artifactRuns: Array<PrimeAgentArtifactRun> = [
			{
				id: "run-1",
				runId: "run-1",
				artifacts: [
					{
						id: "repl-1",
						runId: "run-1",
						kind: "ipython",
						title: "IPython",
						status: "success",
						input: { code: "print('hello')" },
						output: { stdout: "hello" },
						timestamp: 1,
					},
				],
			},
		];

		render(<ReplPanelContent artifactRuns={artifactRuns} />);

		expect(screen.getByTestId("repl-run-list")).toBeTruthy();
		expect(screen.getByText("Cell 1")).toBeTruthy();
		expect(screen.getByText("print('hello')")).toBeTruthy();
		expect(screen.getByText("hello")).toBeTruthy();
	});

	it("shows kernel diagnostics in the REPL panel when present", () => {
		const { rerender } = render(
			<ReplPanelContent artifactRuns={[]} kernelDiagnostics={{ truncated: true, tail: "Traceback: boom" }} />,
		);

		expect(screen.getByText("Kernel diagnostics")).toBeTruthy();
		expect(screen.getByText("Traceback: boom")).toBeTruthy();

		rerender(<ReplPanelContent artifactRuns={[]} />);
		expect(screen.queryByText("Kernel diagnostics")).toBeNull();
	});

	it("sends subagent messages from the pinned composer and stops the turn", async () => {
		const sendMessage = vi.fn(async () => undefined);
		const stop = vi.fn();
		const state = {
			status: "ready" as const,
			loading: false,
			messages: [],
			presentation: emptyPresentation,
			refresh: vi.fn(),
			sendMessage,
			sending: false,
			stop,
		};
		const child: PrimeAgentRlmChild = { id: "child-1", label: "Research worker", status: "done", timestamp: 1 };

		const { rerender } = render(<SubagentChatPanel child={child} parentSessionId="parent-session" state={state} />);

		const input = screen.getByLabelText("Message subagent");
		expect(input).toBeTruthy();
		fireEvent.change(input, { target: { value: "go deeper" } });
		fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
		await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("go deeper"));

		rerender(
			<SubagentChatPanel child={child} parentSessionId="parent-session" state={{ ...state, sending: true }} />,
		);
		fireEvent.click(screen.getByLabelText("Stop generating"));
		expect(stop).toHaveBeenCalledOnce();
	});

	it("focuses and scrolls to the selected REPL cell", async () => {
		const artifactRuns: Array<PrimeAgentArtifactRun> = [
			{
				id: "run-1",
				runId: "run-1",
				artifacts: [
					{
						id: "repl-1",
						runId: "run-1",
						kind: "ipython",
						title: "IPython",
						status: "success",
						input: { code: "print('selected')" },
						output: { stdout: "selected" },
						timestamp: 1,
					},
				],
			},
		];
		const scrollIntoView = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});

		render(<ReplPanelContent artifactRuns={artifactRuns} selectedArtifactId="repl-1" />);

		const selectedCell = await waitFor(() => {
			const cell = document.querySelector<HTMLElement>('[data-repl-run-id="repl-1"]');
			expect(document.activeElement).toBe(cell);
			return cell;
		});
		expect(selectedCell).not.toBeNull();
		expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
	});

	it("preserves the selected cell when opening the REPL panel", () => {
		render(<ChatShellStateProbe />);

		fireEvent.click(screen.getByRole("button", { name: "Open REPL cell" }));

		expect(screen.getByTestId("probe-panel").textContent).toBe("repl");
		expect(screen.getByTestId("probe-selection").textContent).toBe("repl-1");
	});

	it("loads and renders the selected subagent's own transcript", async () => {
		const messages: Array<ChatMessage> = [
			{
				id: "child-user",
				role: "user",
				parts: [{ type: "text", text: "Inspect the worker task" }],
			},
			{
				id: "child-assistant",
				role: "assistant",
				parts: [{ type: "text", text: "Worker transcript loaded" }],
			},
		];
		const response: ChatSessionResponse = {
			session: { sessionId: "child-session" },
			messages,
			planPresentations: [],
			presentation: emptyPresentation,
		};
		const loadSession = vi.fn(async () => response);

		render(
			<SubagentsPanelContent
				agents={[
					{
						id: "child-1",
						label: "Research worker",
						status: "done",
						timestamp: 1,
					},
				]}
				parentSessionId="parent-session"
				loadSession={loadSession}
			/>,
		);

		await waitFor(() => expect(loadSession).toHaveBeenCalledWith("parent-session", "child-1"));
		expect(await screen.findByText("Worker transcript loaded")).toBeTruthy();
		expect(screen.getByRole("region", { name: "Subagent thread: Research worker" })).toBeTruthy();
	});

	it("keeps artifact-only lifecycle entries without duplicating subagent tool rows", () => {
		const { getByRole, getByText } = render(
			<SubagentTranscriptView
				child={{ id: "child-1", label: "Research worker", status: "done", timestamp: 1 }}
				parentSessionId="parent-session"
				status="ready"
				transcript={{
					status: "ready",
					messages: [
						{
							id: "child-assistant",
							role: "assistant",
							parts: [
								{ type: "reasoning", contentIndex: 0, text: "Child reasoning", state: "complete" },
								{ type: "text", text: "Completed the child run." },
								{ type: "tool-Bash", toolCallId: "child-bash", state: "output-available", output: "clean" },
								{ type: "tool-IPython", toolCallId: "child-cancelled", state: "interrupted" },
							],
						},
					],
					presentation: {
						...emptyPresentation,
						artifactRuns: [
							{
								id: "child-run",
								runId: "child-assistant",
								artifacts: [
									{
										id: "child-compaction",
										runId: "child-assistant",
										kind: "compaction",
										title: "Compaction",
										status: "success",
										timestamp: 2,
									},
									{
										id: "child-unmatched-output",
										runId: "child-assistant",
										sourceToolCallId: "missing-tool",
										kind: "bash",
										title: "Unmatched output",
										status: "success",
										timestamp: 3,
									},
								],
							},
						],
					},
				}}
			/>,
		);

		expect(getByRole("button", { name: "Details for Bash (child-bash)" })).toBeTruthy();
		fireEvent.click(getByRole("button", { name: /Thought/ }));
		expect(getByText("Child reasoning")).toBeTruthy();
		expect(
			getByRole("button", { name: "Details for IPython (child-cancelled)" }).closest(
				"[data-testid='assistant-tool-trace']",
			)?.textContent,
		).toContain("cancelled");
		expect(getByText("Compacted Session activity")).toBeTruthy();
		expect(getByText("Completed Bash output")).toBeTruthy();
	});

	it("reloads the selected transcript when a child advances", async () => {
		const loadSession = vi
			.fn<() => Promise<ChatSessionResponse>>()
			.mockResolvedValueOnce({
				session: { sessionId: "child-session" },
				messages: [
					{ id: "child-assistant-1", role: "assistant", parts: [{ type: "text", text: "Running snapshot" }] },
				],
				planPresentations: [],
				presentation: emptyPresentation,
			})
			.mockResolvedValueOnce({
				session: { sessionId: "child-session" },
				messages: [
					{ id: "child-assistant-2", role: "assistant", parts: [{ type: "text", text: "Completed snapshot" }] },
				],
				planPresentations: [],
				presentation: emptyPresentation,
			});
		const { rerender } = render(
			<SubagentsPanelContent
				agents={[{ id: "child-1", label: "Research worker", status: "running", timestamp: 1 }]}
				parentSessionId="parent-session"
				loadSession={loadSession}
			/>,
		);

		await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(1));
		expect(await screen.findByText("Running snapshot")).toBeTruthy();

		rerender(
			<SubagentsPanelContent
				agents={[{ id: "child-1", label: "Research worker", status: "done", timestamp: 2 }]}
				parentSessionId="parent-session"
				loadSession={loadSession}
			/>,
		);

		await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(2));
		expect(await screen.findByText("Completed snapshot")).toBeTruthy();
	});

	it("retains error transcripts and renders a fallback error banner", async () => {
		const child: PrimeAgentRlmChild = {
			id: "child-1",
			label: "Research worker",
			status: "failed",
			timestamp: 1,
		};
		const state = {
			status: "error" as const,
			loading: false,
			messages: [
				{
					id: "child-assistant",
					role: "assistant" as const,
					parts: [{ type: "text" as const, text: "Last known answer" }],
				},
			],
			presentation: emptyPresentation,
			refresh: vi.fn(),
			sendMessage: vi.fn(),
			sending: false,
			stop: vi.fn(),
		};

		render(<SubagentChatPanel child={child} parentSessionId="parent-session" state={state} />);

		expect(await screen.findByText("Last known answer")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("ended with an error");
	});
});
