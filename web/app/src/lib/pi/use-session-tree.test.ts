import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatClient } from "./chat-client";
import { useSessionTree } from "./use-session-tree";

vi.mock("./chat-client", () => ({
	chatClient: {
		getSessionTree: vi.fn(),
		navigateSessionTree: vi.fn(),
	},
}));

const getSessionTree = vi.mocked(chatClient.getSessionTree);
const navigateSessionTree = vi.mocked(chatClient.navigateSessionTree);

const sessionMetadata = { sessionId: "session-1", projectId: "project-1" };

const navigatedSnapshot = {
	sessionId: "session-1",
	leafId: "user-1",
	nodes: [],
};

const afterResumeSnapshot = {
	sessionId: "session-1",
	leafId: "user-1-parent",
	nodes: [],
};

afterEach(() => {
	vi.clearAllMocks();
});

describe("useSessionTree.rewindSessionTree", () => {
	it("sends the confirm-time expectedLeafId and commits snapshot only after resume refresh", async () => {
		navigateSessionTree.mockResolvedValue(navigatedSnapshot);
		getSessionTree.mockResolvedValue(afterResumeSnapshot);
		const resumeSession = vi.fn().mockResolvedValue(true);

		const { result } = renderHook(() =>
			useSessionTree({
				sessionMetadata,
				status: "ready",
				resumeSession,
				rightPanel: null,
			}),
		);

		await act(async () => {
			await result.current.rewindSessionTree("user-1", "assistant-1");
		});

		expect(navigateSessionTree).toHaveBeenCalledWith({
			sessionId: "session-1",
			targetEntryId: "user-1",
			expectedLeafId: "assistant-1",
		});
		expect(resumeSession).toHaveBeenCalledWith(sessionMetadata);
		expect(getSessionTree).toHaveBeenCalledWith("session-1");
		expect(result.current.sessionTreeSnapshot).toEqual(afterResumeSnapshot);
		expect(result.current.selectedSessionTreeEntryId).toBe("user-1-parent");
		expect(result.current.sessionTreeError).toBeNull();
		expect(result.current.sessionTreeLoading).toBe(false);
	});

	it("reconciles the tree after a post-navigate failure without setting a banner error", async () => {
		navigateSessionTree.mockResolvedValue(navigatedSnapshot);
		const resumeSession = vi.fn().mockRejectedValue(new Error("resume failed"));
		getSessionTree.mockResolvedValue(afterResumeSnapshot);

		const { result } = renderHook(() =>
			useSessionTree({
				sessionMetadata,
				status: "ready",
				resumeSession,
				rightPanel: null,
			}),
		);

		await act(async () => {
			await expect(result.current.rewindSessionTree("user-1", "assistant-1")).rejects.toThrow("resume failed");
		});

		expect(getSessionTree).toHaveBeenCalledWith("session-1");
		expect(result.current.sessionTreeSnapshot).toEqual(afterResumeSnapshot);
		expect(result.current.selectedSessionTreeEntryId).toBe("user-1-parent");
		expect(result.current.sessionTreeError).toBeNull();
		expect(result.current.sessionTreeLoading).toBe(false);
	});

	it("treats soft resume failure as rewind failure and reconciles without committing success", async () => {
		navigateSessionTree.mockResolvedValue(navigatedSnapshot);
		const resumeSession = vi.fn().mockResolvedValue(false);
		getSessionTree.mockResolvedValue(afterResumeSnapshot);

		const { result } = renderHook(() =>
			useSessionTree({
				sessionMetadata,
				status: "ready",
				resumeSession,
				rightPanel: null,
			}),
		);

		await act(async () => {
			await expect(result.current.rewindSessionTree("user-1", "assistant-1")).rejects.toThrow(
				/failed to resume session/i,
			);
		});

		expect(getSessionTree).toHaveBeenCalledWith("session-1");
		expect(result.current.sessionTreeSnapshot).toEqual(afterResumeSnapshot);
		expect(result.current.selectedSessionTreeEntryId).toBe("user-1-parent");
		expect(result.current.sessionTreeError).toBeNull();
		expect(result.current.sessionTreeLoading).toBe(false);
	});

	it("rejects rewind when there is no active session", async () => {
		const resumeSession = vi.fn();
		const { result } = renderHook(() =>
			useSessionTree({
				sessionMetadata: { sessionId: "", projectId: "project-1" },
				status: "ready",
				resumeSession,
				rightPanel: null,
			}),
		);

		await act(async () => {
			await expect(result.current.rewindSessionTree("user-1", "assistant-1")).rejects.toThrow(/no active session/i);
		});

		expect(navigateSessionTree).not.toHaveBeenCalled();
		expect(resumeSession).not.toHaveBeenCalled();
	});

	it("does not commit snapshot from a stale rewind after the session changes and clears loading", async () => {
		let resolveNavigate: (value: typeof navigatedSnapshot) => void = () => undefined;
		navigateSessionTree.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveNavigate = resolve;
				}),
		);
		getSessionTree.mockResolvedValue(afterResumeSnapshot);
		const resumeSession = vi.fn().mockResolvedValue(true);

		const { result, rerender } = renderHook(
			({ metadata }) =>
				useSessionTree({
					sessionMetadata: metadata,
					status: "ready",
					resumeSession,
					rightPanel: null,
				}),
			{ initialProps: { metadata: sessionMetadata } },
		);

		let rewindPromise: Promise<void> = Promise.resolve();
		act(() => {
			rewindPromise = result.current.rewindSessionTree("user-1", "assistant-1");
		});

		expect(result.current.sessionTreeLoading).toBe(true);

		rerender({ metadata: { sessionId: "session-2", projectId: "project-1" } });

		expect(result.current.sessionTreeLoading).toBe(false);

		await act(async () => {
			resolveNavigate(navigatedSnapshot);
			await expect(rewindPromise).rejects.toThrow(/session changed/i);
		});

		expect(resumeSession).not.toHaveBeenCalled();
		expect(result.current.sessionTreeSnapshot).toBeNull();
		expect(result.current.selectedSessionTreeEntryId).toBeNull();
		expect(result.current.sessionTreeLoading).toBe(false);
	});
});

describe("useSessionTree.refreshSessionTree", () => {
	it("does not paint a stale refresh after the session changes", async () => {
		let resolveRefresh: (value: typeof afterResumeSnapshot) => void = () => undefined;
		getSessionTree.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveRefresh = resolve;
				}),
		);
		const resumeSession = vi.fn().mockResolvedValue(true);

		const { result, rerender } = renderHook(
			({ metadata }) =>
				useSessionTree({
					sessionMetadata: metadata,
					status: "ready",
					resumeSession,
					rightPanel: null,
				}),
			{ initialProps: { metadata: sessionMetadata } },
		);

		let refreshPromise: Promise<void> = Promise.resolve();
		act(() => {
			refreshPromise = result.current.refreshSessionTree();
		});

		rerender({ metadata: { sessionId: "session-2", projectId: "project-1" } });

		await act(async () => {
			resolveRefresh(afterResumeSnapshot);
			await refreshPromise;
		});

		expect(result.current.sessionTreeSnapshot).toBeNull();
		expect(result.current.sessionTreeLoading).toBe(false);
	});
});
