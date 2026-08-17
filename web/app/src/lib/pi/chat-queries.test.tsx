import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatClient } from "./chat-client";
import { chatQueryKeys, useUpdateChatSettings } from "./chat-queries";

vi.mock("./chat-client", () => ({
	chatClient: {
		updateSettings: vi.fn(),
	},
}));

const updateSettings = vi.mocked(chatClient.updateSettings);

function createWrapper(queryClient: QueryClient) {
	return function QueryWrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
	};
}

afterEach(() => {
	updateSettings.mockReset();
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
