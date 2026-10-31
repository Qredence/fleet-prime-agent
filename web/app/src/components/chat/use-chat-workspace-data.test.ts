import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural coverage for `useChatWorkspaceData`.
 *
 * This hook is the chat workspace's composition root: 653 lines that own project
 * scoping, the session lifecycle wiring, and the composer projection. The only
 * other coverage is `chat-workspace-shell.test.tsx`, which replaces the hook
 * with a stub, so none of the logic below was previously exercised.
 *
 * The collaborators are mocked because they own the network, the browser
 * storage, and the rendered chrome. Everything asserted here is either this
 * module's own derived state or the arguments it hands a collaborator — never a
 * collaborator's internals.
 */

type StoredMetadata = { sessionId?: string; projectId?: string | null };

const harness = vi.hoisted(() => {
	const emptyPresentation = {
		revision: 0,
		userBash: [],
		rlmChildren: [],
		refinements: [],
		artifactRuns: [],
	};

	return {
		storedMetadata: {} as StoredMetadata,
		persistSession: vi.fn(),
		openPanelAction: vi.fn(),
		setThinkingLevel: vi.fn(),
		selectProject: vi.fn(async () => true),
		piChatCalls: [] as Array<{ modelSelection: unknown; options: Record<string, unknown> }>,
		projectsData: { projects: [] as Array<Record<string, unknown>> } as
			| { projects: Array<Record<string, unknown>> }
			| undefined,
		composerIntent: {
			onDraftChange: vi.fn(),
			takeCached: vi.fn(() => null),
			command: undefined as { forValue: string; command: string } | undefined,
			dismissCommand: vi.fn(),
		},
		completion: {
			onDraftChange: vi.fn(),
			inlineCompletion: undefined as
				| { forValue: string; text: string; mode: "append" | "replace"; onDismiss?: () => void }
				| undefined,
		},
		historyDismiss: vi.fn(),
		suggestions: [{ id: "suggestion-1", label: "Summarize this project" }],
		emptyPresentation,
		piChat: {
			activityLabel: undefined as string | undefined,
			answerQuestion: vi.fn(),
			appendLocalMessage: vi.fn(),
			deleteQueuedMessage: vi.fn(),
			editQueuedMessage: vi.fn(),
			deleteSession: vi.fn(),
			error: null as Error | null,
			getMessages: vi.fn(() => []),
			getSessionMetadata: vi.fn(() => ({})),
			messages: [] as Array<ChatMessage>,
			planLabel: undefined as string | undefined,
			persistOpenUIArtifact: vi.fn(),
			presentation: emptyPresentation as PrimeAgentSessionPresentation,
			queue: { steering: [] as Array<string>, followUp: [] as Array<string> },
			renameSession: vi.fn(),
			resumeSession: vi.fn(),
			sendMessage: vi.fn(async () => true),
			sessionMetadata: {} as { sessionId?: string; projectId?: string | null },
			sessions: [] as Array<Record<string, unknown>>,
			startNewSession: vi.fn(),
			switchProject: vi.fn(),
			status: "ready" as ChatStatus,
			stop: vi.fn(),
		},
		notifyError: vi.fn(),
	};
});

vi.mock("@/lib/notify", () => ({
	notify: { error: harness.notifyError, message: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/chat/use-chat-storage", () => ({
	useChatStorage: () => ({
		sessionMetadata: harness.storedMetadata,
		setSessionMetadata: vi.fn(),
	}),
}));

vi.mock("@/components/chat/chat-queries", () => ({
	useChatCommands: () => ({ data: undefined }),
	useChatMcpConnections: () => ({ data: undefined, isLoading: false }),
	useChatModelCatalog: () => ({ data: undefined }),
	useChatModels: () => ({ data: undefined }),
	useChatProjects: () => ({ data: harness.projectsData, refetch: vi.fn() }),
	useChatProviders: () => ({ data: undefined, isLoading: false }),
	useChatResources: () => ({ data: undefined, error: undefined, isLoading: false, refetch: vi.fn() }),
	useChatSettings: () => ({ data: undefined, error: undefined, isLoading: false }),
	useDiscoverChatModels: () => ({ mutateAsync: vi.fn() }),
	useMcpOAuth: () => ({ mutateAsync: vi.fn() }),
	useRemoveChatProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useRemoveMcpConnection: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useUpdateChatProvider: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useUpdateChatSettings: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useUpdateMcpConnection: () => ({ isPending: false, mutateAsync: vi.fn() }),
	useWorkspaceTree: () => ({ data: undefined, error: undefined, isLoading: false, refetch: vi.fn() }),
}));

vi.mock("@/components/chat/use-pi-chat", () => ({
	usePiChat: (modelSelection: unknown, options: Record<string, unknown>) => {
		harness.piChatCalls.push({ modelSelection, options });
		return harness.piChat;
	},
}));

vi.mock("@/components/chat/use-chat-workspace-actions", () => ({
	useChatWorkspaceActions: () => ({
		addWorkspaceAttachment: vi.fn(),
		browseProjectDirectories: vi.fn(),
		clearUploadedAttachments: vi.fn(),
		clearWorkspaceAttachments: vi.fn(),
		createProject: vi.fn(),
		deleteSessionForWorkspace: vi.fn(),
		handleAttach: vi.fn(),
		removeUploadedAttachment: vi.fn(),
		removeWorkspaceAttachment: vi.fn(),
		renameProject: vi.fn(),
		restoreAttachments: vi.fn(),
		resumeSessionForWorkspace: vi.fn(),
		resumeSessionForWorkspaceWithResult: vi.fn(),
		selectProject: harness.selectProject,
		startNewSessionForWorkspace: vi.fn(),
		startNewSessionInProject: vi.fn(),
		unregisterProject: vi.fn(),
	}),
}));

vi.mock("@/components/chat/use-local-slash-actions", () => ({
	useLocalSlashActions: () => ({
		forkFromEntry: vi.fn(),
		handleLocalSlashSubmit: vi.fn(),
		handleSlashCommandSelect: vi.fn(),
	}),
}));

vi.mock("@/components/chat/use-chat-view", () => ({
	useChatSuggestions: () => harness.suggestions,
}));

vi.mock("@/components/chat/question/use-skip-pending-question", () => ({
	useSkipPendingQuestion: vi.fn(),
}));

vi.mock("@/components/chat/composer/composer-inline-completion", () => ({
	useComposerInlineCompletion: () => ({
		inlineCompletion:
			harness.completion.inlineCompletion === undefined
				? undefined
				: { ...harness.completion.inlineCompletion, onDismiss: harness.historyDismiss },
		onDraftChange: harness.completion.onDraftChange,
	}),
}));

vi.mock("@/components/chat/composer/composer-intent", () => ({
	useComposerIntentAvailability: () => ({
		available: true,
		enabled: true,
		keySource: "settings",
		refresh: vi.fn(),
		status: "ready",
	}),
	useComposerIntentRouting: () => harness.composerIntent,
}));

vi.mock("@/components/chat/composer/slash-commands", () => ({
	buildSlashCommands: () => [],
}));

vi.mock("@/components/workspace/workspace-file", () => ({
	loadWorkspaceFile: vi.fn(),
}));

vi.mock("@/components/chat/chat-client", () => ({
	chatClient: { loadSession: vi.fn(), loadSubagentSession: vi.fn() },
}));

vi.mock("@/components/layout/use-chat-shell-state", () => ({
	useChatShellState: (_modelsData: unknown, storage: { sessionMetadata: StoredMetadata }) => ({
		commandPaletteOpen: false,
		handleResourceCanvasResizeStart: vi.fn(),
		handleResourceCanvasWidthChange: vi.fn(),
		handleThemePreferenceChange: vi.fn(),
		initialSessionMetadata: storage.sessionMetadata,
		modelKey: undefined,
		modelSelection: undefined,
		models: [],
		openArtifact: vi.fn(),
		openPanelAction: harness.openPanelAction,
		openWorkspacePath: vi.fn(),
		persistSession: harness.persistSession,
		reopenRightPanel: vi.fn(),
		resourceCanvasWidth: 420,
		rightPanel: null,
		selectedArtifactId: null,
		selectedWorkspacePath: null,
		setCommandPaletteOpen: vi.fn(),
		setModelKey: vi.fn(),
		setRightPanel: vi.fn(),
		setSelectedWorkspacePath: vi.fn(),
		// The real hook returns a `useCallback` whose identity changes when the
		// model list reloads. Returning a fresh wrapper on every render reproduces
		// that, which is what makes the thinking-level dedupe observable.
		setThinkingLevel: (level: Parameters<typeof harness.setThinkingLevel>[0]) => harness.setThinkingLevel(level),
		themePreference: "system",
		thinkingLevel: undefined,
	}),
}));

vi.mock("@/components/layout/use-right-panel-context-value", () => ({
	useRightPanelContextValue: () => ({
		chatPanelData: { marker: "chat-panel" },
		settingsActions: { marker: "settings" },
		workspaceTreeContext: { marker: "workspace-tree" },
	}),
}));

vi.mock("@/components/layout/chat-header", () => ({
	useChatWorkspaceHeader: () => ({ accountMenu: null, center: null, left: null, right: null }),
}));

vi.mock("@/components/layout/chat-workspace-dialogs", () => ({
	useChatWorkspaceDialogs: () => ({
		forkPickerEntries: null,
		setForkPickerEntries: vi.fn(),
		setSettingsDialogOpen: vi.fn(),
		setSettingsInitialTab: vi.fn(),
		settingsDialogOpen: false,
		settingsInitialTab: undefined,
	}),
}));

vi.mock("@/components/sessions/use-agent-tabs", () => ({
	useAgentTabs: () => ({
		activeTabId: "main",
		closeTab: vi.fn(),
		conversation: { marker: "child" },
		openChildTab: vi.fn(),
		selectedChild: undefined,
		selectTab: vi.fn(),
		tabs: [],
	}),
}));

vi.mock("@/components/sessions/use-session-tree", () => ({
	useSessionTree: () => ({
		highlightedTranscriptMessageId: undefined,
		isSessionTreeStreaming: false,
		refreshSessionTree: vi.fn(),
		rewindSessionTree: vi.fn(),
		selectSessionTreeEntry: vi.fn(),
		selectedSessionTreeEntryId: undefined,
		sessionTreeError: undefined,
		sessionTreeLoading: false,
		sessionTreeSnapshot: undefined,
	}),
}));

const { useChatWorkspaceData } = await import("@/components/chat/use-chat-workspace-data");

function assistantMessage(id: string, text: string): ChatMessage {
	return { id, parts: [{ text, type: "text" }], role: "assistant" };
}

function userMessage(id: string, text: string): ChatMessage {
	return { id, parts: [{ text, type: "text" }], role: "user" };
}

function project(projectId: string, name: string) {
	return {
		createdAt: "2026-01-01T00:00:00.000Z",
		name,
		pathLabel: `/work/${name}`,
		projectId,
		sessionCount: 0,
		status: "active",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

function resetHarness() {
	harness.storedMetadata = {};
	harness.projectsData = { projects: [] };
	harness.piChatCalls = [];
	harness.piChat = {
		...harness.piChat,
		activityLabel: undefined,
		messages: [],
		planLabel: undefined,
		presentation: harness.emptyPresentation as PrimeAgentSessionPresentation,
		queue: { steering: [], followUp: [] },
		sessionMetadata: {},
		status: "ready",
	};
	harness.composerIntent.command = undefined;
	harness.completion.inlineCompletion = undefined;
	vi.clearAllMocks();
}

beforeEach(resetHarness);
afterEach(() => {
	vi.clearAllMocks();
});

describe("project scoping", () => {
	it("adopts the project from stored session metadata instead of the first project", () => {
		harness.storedMetadata = { projectId: "project-stored" };
		harness.projectsData = { projects: [project("project-a", "Alpha"), project("project-b", "Beta")] };

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.session.activeProjectId).toBe("project-stored");
		expect(harness.persistSession).not.toHaveBeenCalled();
	});

	it("falls back to the first project and persists that choice when nothing is stored", () => {
		harness.storedMetadata = {};
		harness.projectsData = { projects: [project("project-a", "Alpha"), project("project-b", "Beta")] };

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.session.activeProjectId).toBe("project-a");
		expect(harness.persistSession).toHaveBeenCalledWith({ projectId: "project-a" });
	});

	it("leaves the project unset when there is no stored project and no project list", () => {
		harness.storedMetadata = {};
		harness.projectsData = { projects: [] };

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.session.activeProjectId).toBeUndefined();
		expect(harness.persistSession).not.toHaveBeenCalled();
	});

	it("re-scopes the chat session to the new project when the stored project changes", () => {
		harness.storedMetadata = { projectId: "project-a" };
		harness.projectsData = { projects: [project("project-a", "Alpha"), project("project-b", "Beta")] };

		const { rerender, result } = renderHook(() => useChatWorkspaceData());
		expect(result.current.session.activeProjectId).toBe("project-a");
		expect(harness.piChatCalls.at(-1)?.options.projectId).toBe("project-a");

		harness.storedMetadata = { projectId: "project-b" };
		rerender();

		expect(result.current.session.activeProjectId).toBe("project-b");
		// The chat session is re-scoped, which is what makes a project switch reset
		// the conversation rather than continue the previous project's session.
		expect(harness.piChatCalls.at(-1)?.options.projectId).toBe("project-b");
	});
});

describe("session lifecycle", () => {
	it("passes the stored session metadata and persistence callback into the chat session", () => {
		harness.storedMetadata = { projectId: "project-a", sessionId: "session-a" };

		renderHook(() => useChatWorkspaceData());

		const options = harness.piChatCalls.at(-1)?.options;
		expect(options?.initialSessionMetadata).toEqual({ projectId: "project-a", sessionId: "session-a" });
		expect(options?.persistSession).toBe(harness.persistSession);
	});

	it("applies the presentation thinking level to the shell", () => {
		harness.piChat.sessionMetadata = { sessionId: "session-a" };
		harness.piChat.presentation = {
			...harness.emptyPresentation,
			thinkingLevel: "high",
		} as PrimeAgentSessionPresentation;

		renderHook(() => useChatWorkspaceData());

		expect(harness.setThinkingLevel).toHaveBeenCalledWith("high");
	});

	it("does not re-apply the same thinking level for the same session", () => {
		harness.piChat.sessionMetadata = { sessionId: "session-a" };
		harness.piChat.presentation = {
			...harness.emptyPresentation,
			thinkingLevel: "high",
		} as PrimeAgentSessionPresentation;

		const { rerender } = renderHook(() => useChatWorkspaceData());
		harness.setThinkingLevel.mockClear();
		rerender();
		rerender();

		expect(harness.setThinkingLevel).not.toHaveBeenCalled();
	});

	it("applies a changed thinking level", () => {
		harness.piChat.sessionMetadata = { sessionId: "session-a" };
		harness.piChat.presentation = {
			...harness.emptyPresentation,
			thinkingLevel: "high",
		} as PrimeAgentSessionPresentation;

		const { rerender } = renderHook(() => useChatWorkspaceData());
		harness.piChat.presentation = {
			...harness.emptyPresentation,
			thinkingLevel: "low",
		} as PrimeAgentSessionPresentation;
		rerender();

		expect(harness.setThinkingLevel).toHaveBeenLastCalledWith("low");
	});

	it("re-applies the same thinking level when the session changes", () => {
		harness.piChat.sessionMetadata = { sessionId: "session-a" };
		harness.piChat.presentation = {
			...harness.emptyPresentation,
			thinkingLevel: "high",
		} as PrimeAgentSessionPresentation;

		const { rerender } = renderHook(() => useChatWorkspaceData());
		harness.piChat.sessionMetadata = { sessionId: "session-b" };
		harness.setThinkingLevel.mockClear();
		rerender();

		expect(harness.setThinkingLevel).toHaveBeenCalledWith("high");
	});
});

describe("composer projection", () => {
	it("describes the queue ahead of the activity label", () => {
		harness.piChat.activityLabel = "Working";
		harness.piChat.queue = { followUp: [], steering: ["one steering message"] };

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.composer.infoDescription).toBe("1 steering message queued");
	});

	it("falls back to the activity label, then the plan label", () => {
		harness.piChat.activityLabel = "Working";
		const { result, rerender } = renderHook(() => useChatWorkspaceData());
		expect(result.current.composer.infoDescription).toBe("Working");

		harness.piChat.activityLabel = undefined;
		harness.piChat.planLabel = "Reviewing the plan";
		rerender();
		expect(result.current.composer.infoDescription).toBe("Reviewing the plan");
	});

	it("offers no input suggestions for an empty conversation", () => {
		harness.piChat.messages = [];

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.composer.inputSuggestionItems).toEqual([]);
	});

	it("withholds input suggestions while a turn is live", () => {
		harness.piChat.messages = [userMessage("m1", "hello"), assistantMessage("m2", "hi")];
		harness.piChat.status = "streaming";

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.composer.inputSuggestionItems).toEqual([]);
	});

	it("offers input suggestions once an assistant message has settled", () => {
		harness.piChat.messages = [userMessage("m1", "hello"), assistantMessage("m2", "hi")];
		harness.piChat.status = "ready";

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.composer.inputSuggestionItems).toEqual(harness.suggestions);
	});

	it("withholds input suggestions when the last message is from the user", () => {
		harness.piChat.messages = [assistantMessage("m1", "hi"), userMessage("m2", "again")];
		harness.piChat.status = "ready";

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.composer.inputSuggestionItems).toEqual([]);
	});

	it("prefers a recognised command over the history completion", () => {
		harness.composerIntent.command = { command: "compact", forValue: "make this shorter" };
		harness.completion.inlineCompletion = { forValue: "make this", mode: "append", text: " shorter" };

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.composer.inlineCompletion).toMatchObject({
			forValue: "make this shorter",
			mode: "replace",
			text: "/compact",
		});
	});

	it("falls back to the history completion when no command was recognised", () => {
		harness.composerIntent.command = undefined;
		harness.completion.inlineCompletion = { forValue: "ship", mode: "append", text: " it" };

		const { result } = renderHook(() => useChatWorkspaceData());

		expect(result.current.composer.inlineCompletion).toMatchObject({
			forValue: "ship",
			mode: "append",
			text: " it",
		});
	});

	it("dismisses both the command and the history completion it was coalesced over", () => {
		harness.composerIntent.command = { command: "compact", forValue: "make this shorter" };
		harness.completion.inlineCompletion = { forValue: "make this", mode: "append", text: " shorter" };

		const { result } = renderHook(() => useChatWorkspaceData());
		act(() => {
			result.current.composer.inlineCompletion?.onDismiss?.();
		});

		expect(harness.composerIntent.dismissCommand).toHaveBeenCalled();
		expect(harness.historyDismiss).toHaveBeenCalled();
	});

	it("dismisses only the command when no history completion was coalesced", () => {
		harness.composerIntent.command = { command: "compact", forValue: "make this shorter" };
		harness.completion.inlineCompletion = undefined;

		const { result } = renderHook(() => useChatWorkspaceData());
		act(() => {
			result.current.composer.inlineCompletion?.onDismiss?.();
		});

		expect(harness.composerIntent.dismissCommand).toHaveBeenCalled();
		expect(harness.historyDismiss).not.toHaveBeenCalled();
	});

	it("publishes a draft change to both the intent router and the completion provider", () => {
		const { result } = renderHook(() => useChatWorkspaceData());

		act(() => {
			result.current.composer.onComposerDraftChange("refactor the parser");
		});

		expect(harness.composerIntent.onDraftChange).toHaveBeenCalledWith("refactor the parser");
		expect(harness.completion.onDraftChange).toHaveBeenCalledWith("refactor the parser");
	});
});

describe("panel actions", () => {
	it("refuses a panel action that targets another project", () => {
		harness.storedMetadata = { projectId: "project-a" };
		harness.projectsData = { projects: [project("project-a", "Alpha"), project("project-b", "Beta")] };
		const { result } = renderHook(() => useChatWorkspaceData());

		act(() => {
			result.current.conversation.openPanelAction({ panel: "workspace", projectId: "project-b" });
		});

		expect(harness.openPanelAction).not.toHaveBeenCalled();
		expect(harness.notifyError).toHaveBeenCalledWith("This panel action targets a different project.");
	});

	it("applies a panel action for the active project without switching", () => {
		harness.storedMetadata = { projectId: "project-a" };
		const { result } = renderHook(() => useChatWorkspaceData());

		act(() => {
			result.current.conversation.openPanelAction({ panel: "workspace" });
		});

		expect(harness.openPanelAction).toHaveBeenCalledWith({ panel: "workspace" });
		expect(harness.selectProject).not.toHaveBeenCalled();
	});

	it("switches project before applying a sidebar panel action from another project", async () => {
		harness.storedMetadata = { projectId: "project-a" };
		harness.projectsData = { projects: [project("project-a", "Alpha"), project("project-b", "Beta")] };
		const { result } = renderHook(() => useChatWorkspaceData());

		await act(async () => {
			result.current.session.openPanelAction({ panel: "workspace", projectId: "project-b" });
			await Promise.resolve();
		});

		expect(harness.selectProject).toHaveBeenCalledWith("project-b");
		expect(harness.openPanelAction).toHaveBeenCalledWith({ panel: "workspace", projectId: "project-b" });
	});
});
