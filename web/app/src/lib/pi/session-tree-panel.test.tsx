import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionTreePanel } from "@/components/qredence-ui/panels/session/session-tree-panel";

const snapshot = {
	sessionId: "session-1",
	leafId: "assistant-1",
	nodes: [
		{
			id: "user-1",
			kind: "message" as const,
			role: "user" as const,
			label: "message",
			preview: "user: hello",
			isLeaf: false,
			isOnActiveBranch: true,
			messageIndex: 0,
			children: [
				{
					id: "assistant-1",
					kind: "message" as const,
					role: "assistant" as const,
					label: "message",
					preview: "assistant: hi",
					isLeaf: true,
					isOnActiveBranch: true,
					messageIndex: 1,
					children: [],
				},
			],
		},
	],
};

describe("SessionTreePanel", () => {
	it("renders branch nodes and highlights transcript selections", () => {
		const onSelectEntry = vi.fn();
		render(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={snapshot}
				loading={false}
				isStreaming={false}
				onSelectEntry={onSelectEntry}
				onRefresh={vi.fn()}
				onRewind={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByTestId("session-tree-node-user-1"));
		expect(onSelectEntry).toHaveBeenCalledWith("user-1", "session-1-m0");
		expect(screen.getByTestId("session-tree-list")).toBeTruthy();
	});

	it("disables rewind while streaming", () => {
		render(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={snapshot}
				loading={false}
				isStreaming={true}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Rewind here" }).hasAttribute("disabled")).toBe(true);
	});

	it("keeps the confirm dialog open and shows the error when rewind fails", async () => {
		const onRewind = vi
			.fn()
			.mockRejectedValue(new Error("The session tree changed while you were selecting a rewind target."));
		render(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={snapshot}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rewind here" }));
		expect(screen.getByText("Rewind session?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
		expect(await screen.findByText(/session tree changed/i)).toBeTruthy();
		expect(screen.getByText("Rewind session?")).toBeTruthy();
		expect(onRewind).toHaveBeenCalledWith("user-1", "assistant-1");
	});

	it("locks expectedLeafId at dialog open even if the snapshot leaf changes before confirm", async () => {
		const onRewind = vi.fn().mockResolvedValue(undefined);
		const { rerender } = render(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={snapshot}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rewind here" }));
		rerender(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={{ ...snapshot, leafId: "assistant-2" }}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
		expect(onRewind).toHaveBeenCalledWith("user-1", "assistant-1");
	});

	it("re-arms expectedLeafId after a failed rewind when the snapshot leaf reconciles", async () => {
		const onRewind = vi.fn().mockRejectedValueOnce(new Error("resume failed")).mockResolvedValueOnce(undefined);
		const { rerender } = render(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={snapshot}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rewind here" }));
		fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
		expect(await screen.findByText(/resume failed/i)).toBeTruthy();
		expect(onRewind).toHaveBeenCalledWith("user-1", "assistant-1");

		rerender(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={{ ...snapshot, leafId: "assistant-2" }}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		expect(screen.getByText("Rewind session?")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
		await vi.waitFor(() => {
			expect(onRewind).toHaveBeenLastCalledWith("user-1", "assistant-2");
		});
	});

	it("closes the confirm dialog when the sessionId changes", async () => {
		const onRewind = vi.fn().mockResolvedValue(undefined);
		const { rerender } = render(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={snapshot}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rewind here" }));
		expect(screen.getByText("Rewind session?")).toBeTruthy();

		rerender(
			<SessionTreePanel
				sessionId="session-2"
				snapshot={{ ...snapshot, sessionId: "session-2" }}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		await waitFor(() => {
			expect(screen.queryByText("Rewind session?")).toBeNull();
		});
	});

	it("ignores stale rewind completion after the session changes", async () => {
		let rejectFirst!: (error: Error) => void;
		let resolveSecond!: () => void;
		const firstRewind = new Promise<void>((_resolve, reject) => {
			rejectFirst = reject;
		});
		const secondRewind = new Promise<void>((resolve) => {
			resolveSecond = resolve;
		});
		const onRewind = vi.fn().mockReturnValueOnce(firstRewind).mockReturnValueOnce(secondRewind);
		const { rerender } = render(
			<SessionTreePanel
				sessionId="session-1"
				snapshot={snapshot}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rewind here" }));
		fireEvent.click(screen.getByRole("button", { name: "Rewind" }));

		rerender(
			<SessionTreePanel
				sessionId="session-2"
				snapshot={{ ...snapshot, sessionId: "session-2" }}
				loading={false}
				isStreaming={false}
				selectedEntryId="user-1"
				onSelectEntry={vi.fn()}
				onRefresh={vi.fn()}
				onRewind={onRewind}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Rewind here" }));
		fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
		expect(onRewind).toHaveBeenCalledTimes(2);
		expect(screen.getByRole("button", { name: "Rewinding…" })).toBeTruthy();

		await act(async () => {
			rejectFirst(new Error("stale rewind error"));
			await Promise.resolve();
		});

		expect(screen.queryByText("stale rewind error")).toBeNull();
		expect(screen.getByRole("button", { name: "Rewinding…" })).toBeTruthy();

		await act(async () => {
			resolveSecond();
			await Promise.resolve();
		});

		expect(screen.queryByText("Rewind session?")).toBeNull();
	});
});
