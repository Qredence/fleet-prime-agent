import { SessionTreePanel } from "@prime-agent/web-design/components/qredence-ui/panels/session-tree-panel";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
});
