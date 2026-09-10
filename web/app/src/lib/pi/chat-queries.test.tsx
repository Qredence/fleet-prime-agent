import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatClient } from "./chat-client";
import {
	chatQueryKeys,
	useChatCommands,
	useChatModelCatalog,
	useChatModels,
	useChatResources,
	useChatSettings,
	useUpdateChatSettings,
	useWorkspaceTree,
} from "./chat-queries";

vi.mock("./chat-client", () => ({
	chatClient: {
		getCommands: vi.fn(),
		getModels: vi.fn(),
		getResources: vi.fn(),
		getSettings: vi.fn(),
		updateSettings: vi.fn(),
		getWorkspaceTree: vi.fn(),
	},
}));

const updateSettings = vi.mocked(chatClient.updateSettings);
const getCommands = vi.mocked(chatClient.getCommands);
const getModels = vi.mocked(chatClient.getModels);
const getResources = vi.mocked(chatClient.getResources);
const getSettings = vi.mocked(chatClient.getSettings);
const getWorkspaceTree = vi.mocked(chatClient.getWorkspaceTree);

function createWrapper(queryClient: QueryClient) {
	return function QueryWrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

afterEach(() => {
	vi.clearAllMocks();
});

describe("project-scoped query gating", () => {
	it("does not request project data before project initialization", async () => {
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		renderHook(
			() => {
				useChatModels();
				useChatModelCatalog({ enabled: true });
				useChatResources();
				useChatCommands();
				useChatSettings();
				useWorkspaceTree(undefined, { enabled: true });
			},
			{ wrapper: createWrapper(queryClient) },
		);

		await act(async () => {
			await Promise.resolve();
		});

		expect(getModels).not.toHaveBeenCalled();
		expect(getResources).not.toHaveBeenCalled();
		expect(getCommands).not.toHaveBeenCalled();
		expect(getSettings).not.toHaveBeenCalled();
		expect(getWorkspaceTree).not.toHaveBeenCalled();
	});
});

describe("useUpdateChatSettings", () => {
	it("updates the project-scoped cache without overwriting the default cache", async () => {
		const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
		const defaultSettings = { marker: "default" };
		const projectSettings = { marker: "project" };
		queryClient.setQueryData(chatQueryKeys.settings(), defaultSettings);
		queryClient.setQueryData(chatQueryKeys.settings("project-1"), { marker: "old-project" });
		updateSettings.mockResolvedValue(projectSettings as never);

		const { result } = renderHook(() => useUpdateChatSettings(), {
			wrapper: createWrapper(queryClient),
		});

		await act(async () => {
			await result.current.mutateAsync({ request: { settings: {} }, projectId: "project-1" });
		});

		expect(queryClient.getQueryData(chatQueryKeys.settings("project-1"))).toEqual(projectSettings);
		expect(queryClient.getQueryData(chatQueryKeys.settings())).toEqual(defaultSettings);
	});
});
