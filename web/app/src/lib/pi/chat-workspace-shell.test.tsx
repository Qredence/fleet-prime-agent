import { AgentTabBar } from "@prime-agent/web-design/components/product/fleet-pi/layout/agent-tab-bar";
import { notify } from "@prime-agent/web-design/lib/notify";
import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWorkspaceAction } from "./chat-error-notify";
import { ChatWorkspaceShell } from "./chat-workspace-shell";
import type { useChatWorkspaceData } from "./use-chat-workspace-data";

vi.mock("@prime-agent/web-design/lib/notify", () => ({
	notify: {
		error: vi.fn(),
		message: vi.fn(),
		success: vi.fn(),
	},
}));

vi.mock("./chat-panel", () => ({
	ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("./chat-workspace-dialogs", () => ({
	ChatCommandPaletteOverlay: () => null,
	ChatWorkspaceOverlayDialogs: () => null,
}));

vi.mock("@prime-agent/web-design/components/product/fleet-pi/layout/right-panel-shell", () => ({
	RightPanelShell: () => null,
}));

vi.mock("./panel-keybindings", () => ({
	focusChatComposer: vi.fn(),
	usePanelKeybindings: vi.fn(),
}));

const { useChatWorkspaceDataMock } = vi.hoisted(() => ({
	useChatWorkspaceDataMock: vi.fn(),
}));

vi.mock("./use-chat-workspace-data", () => ({
	useChatWorkspaceData: () => useChatWorkspaceDataMock(),
}));

const emptyPresentation: PrimeAgentSessionPresentation = {
	revision: 0,
	userBash: [],
	rlmChildren: [],
	refinements: [],
	artifactRuns: [],
};

type WorkspaceData = ReturnType<typeof useChatWorkspaceData>;

function createWorkspaceData(startNewSession: () => Promise<unknown>): WorkspaceData {
	const composer = {
		answerQuestion: vi.fn(),
		chatMode: "agent" as const,
		clearUploadedAttachments: vi.fn(),
		clearWorkspaceAttachments: vi.fn(),
		effortPickerOpen: false,
		handleAttach: vi.fn(),
		handleLocalSlashSubmit: vi.fn(),
		handleQuestionAnswer: vi.fn(),
		handleSlashCommandSelect: vi.fn(),
		infoDescription: undefined,
		inputSuggestionItems: [],
		workspaceReferenceSuggestions: [],
		modelKey: undefined,
		modelPickerOpen: false,
		models: [],
		pendingQuestionBar: undefined,
		removeUploadedAttachment: vi.fn(),
		removeWorkspaceAttachment: vi.fn(),
		addWorkspaceAttachment: vi.fn(),
		restoreAttachments: vi.fn(),
		setChatMode: vi.fn(),
		setEffortPickerOpen: vi.fn(),
		setModelKey: vi.fn(),
		setModelPickerOpen: vi.fn(),
		setThinkingLevel: vi.fn(),
		slashCommands: [],
		thinkingLevel: "off",
		uploadedAttachments: [],
		workspaceAttachments: [],
	} satisfies WorkspaceData["composer"];

	return {
		session: {
			activeSessionId: "session-1",
			activeProjectId: undefined,
			openPanelAction: vi.fn(),
			projects: [],
			projectSessions: [],
			sessions: [],
			browseProjectDirectories: vi.fn(),
			createProject: vi.fn(),
			deleteSession: vi.fn(),
			forkSessionIntoProject: vi.fn(),
			renameProject: vi.fn(),
			renameSession: vi.fn(),
			resumeSession: vi.fn(),
			selectProject: vi.fn(),
			startNewSession,
			startNewSessionInProject: vi.fn(),
			unregisterProject: vi.fn(),
		},
		conversation: {
			activityLabel: undefined,
			artifactRuns: [],
			deleteQueuedMessage: vi.fn(),
			editQueuedMessage: vi.fn(),
			error: null,
			messages: [],
			openArtifact: vi.fn(),
			openPanelAction: vi.fn(),
			persistOpenUIArtifact: vi.fn(),
			presentation: emptyPresentation,
			queue: { steering: [], followUp: [] },
			sendMessage: vi.fn(),
			status: "ready",
			stop: vi.fn(),
		},
		agentTabs: {
			activeTabId: "main",
			closeTab: vi.fn(),
			conversation: {
				status: "ready",
				loading: false,
				messages: [],
				presentation: emptyPresentation,
				refresh: vi.fn(),
				sendMessage: vi.fn(),
				sending: false,
				stop: vi.fn(),
			},
			openChildTab: vi.fn(),
			selectedChild: undefined,
			selectTab: vi.fn(),
			tabs: [{ id: "main", label: "Main agent", kind: "main" }],
		},
		composer,
		panels: {
			chatPanelData: {
				artifactRuns: [],
				chatMode: "agent",
				loadSession: vi.fn(),
				loadSubagentSession: vi.fn(),
				messages: [],
				models: [],
				presentation: emptyPresentation,
				queue: { steering: [], followUp: [] },
				refreshResources: vi.fn(),
				resources: null,
				resourcesError: null,
				resourcesLoading: false,
				reopenRightPanel: vi.fn(),
				rightPanel: null,
				selectedArtifactId: null,
				sessionId: "session-1",
				setRightPanel: vi.fn(),
				status: "ready",
			},
			handleResourceCanvasResizeStart: vi.fn(),
			resourceCanvasWidth: 360,
			rightPanel: null,
			setRightPanel: vi.fn(),
			settingsActions: {
				onThemePreferenceChange: vi.fn(),
				saveSettings: vi.fn(),
				settings: null,
				settingsError: null,
				settingsLoading: false,
				themePreference: "system",
			},
			workspaceTreeContext: {
				loadWorkspaceFile: vi.fn(),
				openWorkspacePath: vi.fn(),
				refreshWorkspace: vi.fn(),
				selectedWorkspacePath: null,
				setSelectedWorkspacePath: vi.fn(),
				workspaceError: null,
				workspaceLoading: false,
				workspaceTree: null,
			},
		},
		dialogs: {
			commandPaletteOpen: false,
			forkFromEntry: null,
			forkPickerEntries: null,
			setCommandPaletteOpen: vi.fn(),
			setForkPickerEntries: vi.fn(),
			setSettingsDialogOpen: vi.fn(),
			setSettingsInitialTab: vi.fn(),
			settingsDialogOpen: false,
			settingsInitialTab: undefined,
		},
		chrome: {
			handleThemePreferenceChange: vi.fn(),
			header: {
				left: <div />,
				accountMenu: <div />,
				center: (
					<AgentTabBar
						tabs={[{ id: "main", label: "Main agent", kind: "main" }]}
						value="main"
						onValueChange={vi.fn()}
						onNewSession={() => runWorkspaceAction(() => startNewSession())}
					/>
				),
				right: <div />,
			},
			themePreference: "system",
		},
	} as unknown as WorkspaceData;
}

describe("ChatWorkspaceShell new session chrome", () => {
	beforeEach(() => {
		vi.mocked(notify.error).mockClear();
		window.localStorage.clear();
	});

	it("starts a session from the header control and the sidebar New chat action", async () => {
		const startNewSession = vi.fn().mockResolvedValue({ sessionId: "session-2" });
		useChatWorkspaceDataMock.mockReturnValue(createWorkspaceData(startNewSession));

		render(<ChatWorkspaceShell />);

		const newChatButtons = screen.getAllByRole("button", { name: "New chat" });
		const headerNewChat = newChatButtons.find((button) => button.getAttribute("data-testid") === "new-chat-tab");
		const sidebarNewChat = newChatButtons.find((button) => button.getAttribute("data-testid") !== "new-chat-tab");
		expect(headerNewChat).toBeTruthy();
		expect(sidebarNewChat).toBeTruthy();

		fireEvent.click(headerNewChat!);
		await waitFor(() => expect(startNewSession).toHaveBeenCalledTimes(1));

		fireEvent.click(sidebarNewChat!);
		await waitFor(() => expect(startNewSession).toHaveBeenCalledTimes(2));
	});

	it("surfaces create failures from the header New chat control", async () => {
		const startNewSession = vi.fn().mockRejectedValue(new Error("Unable to create session"));
		useChatWorkspaceDataMock.mockReturnValue(createWorkspaceData(startNewSession));

		render(<ChatWorkspaceShell />);
		fireEvent.click(screen.getByTestId("new-chat-tab"));

		await waitFor(() => expect(notify.error).toHaveBeenCalledWith("Unable to create session"));
	});
});
