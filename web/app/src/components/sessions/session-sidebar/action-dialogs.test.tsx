import type { ChatSessionInfo } from "@prime-agent/web-protocol/chat-protocol";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionSidebarActionDialogs } from "@/components/sessions/session-sidebar/action-dialogs";
import { sessionLabel, UNTITLED_SESSION_LABEL } from "@/components/sessions/session-sidebar/types";

const session = { sessionId: "abcdef1234567890", title: "Old title" } as ChatSessionInfo;

describe("session sidebar action dialogs", () => {
	it("submits the rename dialog on Enter", () => {
		const onRenameSession = vi.fn();
		const onClose = vi.fn();
		render(
			<SessionSidebarActionDialogs
				activeDialog={{ kind: "rename-session", session }}
				onClose={onClose}
				onRenameSession={onRenameSession}
				onDeleteSession={vi.fn()}
			/>,
		);
		const input = screen.getByLabelText("Session title");
		fireEvent.change(input, { target: { value: "  New title  " } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onRenameSession).toHaveBeenCalledWith(session.sessionId, "New title");
		expect(onClose).toHaveBeenCalled();
	});

	it("ignores Enter on an empty title", () => {
		const onRenameSession = vi.fn();
		render(
			<SessionSidebarActionDialogs
				activeDialog={{ kind: "rename-session", session }}
				onClose={vi.fn()}
				onRenameSession={onRenameSession}
				onDeleteSession={vi.fn()}
			/>,
		);
		const input = screen.getByLabelText("Session title");
		fireEvent.change(input, { target: { value: "   " } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onRenameSession).not.toHaveBeenCalled();
	});
});

describe("sessionLabel", () => {
	it("shows a placeholder instead of the raw session-id prefix", () => {
		expect(sessionLabel({ sessionId: "abcdef1234567890", title: "", firstMessage: "" })).toBe(UNTITLED_SESSION_LABEL);
		expect(sessionLabel({ sessionId: "abcdef1234567890", title: "abcdef12", firstMessage: "" })).toBe(
			UNTITLED_SESSION_LABEL,
		);
		expect(sessionLabel({ sessionId: "abcdef1234567890", title: "Real title", firstMessage: "" })).toBe("Real title");
	});
});
