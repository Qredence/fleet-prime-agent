import type { ChatModelsResponse } from "@prime-agent/web-protocol/chat-protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChatShellState } from "./use-chat-shell-state";

const models: ChatModelsResponse = {
	models: [
		{ key: "one/a", provider: "one", id: "a", name: "A", reasoning: false, input: ["text"], available: true },
		{ key: "two/b", provider: "two", id: "b", name: "B", reasoning: false, input: ["text"], available: true },
	],
	selectedModelKey: "one/a",
	diagnostics: [],
};

describe("chat model selection", () => {
	afterEach(() => window.sessionStorage.clear());

	it("restores the selected model on reload when it is still available", async () => {
		const storage = { sessionMetadata: {}, setSessionMetadata: vi.fn() };
		const first = renderHook(() => useChatShellState(models, storage));
		await waitFor(() => expect(first.result.current.modelKey).toBe("one/a"));
		act(() => first.result.current.setModelKey("two/b"));
		await waitFor(() => expect(window.sessionStorage.getItem("fleet:chat:model-selection")).toBe("two/b"));
		first.unmount();

		const restored = renderHook(() => useChatShellState(models, storage));
		await waitFor(() => expect(restored.result.current.modelKey).toBe("two/b"));
	});

	it("falls back to the configured default when the stored model is unavailable", async () => {
		window.sessionStorage.setItem("fleet:chat:model-selection", "missing/model");
		const restored = renderHook(() =>
			useChatShellState(models, { sessionMetadata: {}, setSessionMetadata: vi.fn() }),
		);
		await waitFor(() => expect(restored.result.current.modelKey).toBe("one/a"));
	});
});
