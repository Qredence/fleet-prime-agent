import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationTurnView } from "@/components/chat/agent-chat";
import { buildAssistantElements } from "@/components/chat/transcript/message-turns";

const renderCounter = vi.hoisted(() => ({ userMessage: 0 }));

vi.mock("@/components/chat/transcript/user-message", () => ({
	UserMessage: ({ message }: { message: ChatMessage }) => {
		renderCounter.userMessage += 1;
		return <div>{message.id}</div>;
	},
}));

describe("conversation turn rendering", () => {
	beforeEach(() => {
		renderCounter.userMessage = 0;
	});

	it("does not rerender a completed turn while the active turn streams", () => {
		const completedMessage = {
			id: "completed-user",
			role: "user",
			parts: [{ type: "text", text: "Completed prompt" }],
		} as ChatMessage;
		const completedTurn = { user: completedMessage, assistants: [] };
		const rendering = { toolRenderers: {} };
		const activity = {};
		const { rerender } = render(
			<>
				<ConversationTurnView
					turn={completedTurn}
					state={{ isLast: false, isStreaming: false }}
					rendering={rendering}
					activity={activity}
				/>
				<div data-stream-update="1">active stream update</div>
			</>,
		);

		expect(renderCounter.userMessage).toBe(1);
		rerender(
			<>
				<ConversationTurnView
					turn={{ user: completedMessage, assistants: [] }}
					state={{ isLast: false, isStreaming: false }}
					rendering={rendering}
					activity={activity}
				/>
				<div data-stream-update="2">active stream update</div>
			</>,
		);

		expect(renderCounter.userMessage).toBe(1);
	});

	it("renders one turn-progress region and no AgentActivity stack", () => {
		const turn = {
			user: {
				id: "user-1",
				role: "user",
				parts: [{ type: "text", text: "Inspect files" }],
			} as ChatMessage,
			assistants: [
				{
					id: "assistant-1",
					role: "assistant",
					parts: [
						{ type: "text", text: "Looking" },
						{ type: "tool-Bash", toolCallId: "bash-1", state: "input-streaming", input: { command: "ls" } },
					],
				} as ChatMessage,
			],
		};
		const { container } = render(
			<ConversationTurnView
				turn={turn}
				state={{ isLast: true, isStreaming: true }}
				rendering={{}}
				activity={{ label: "Queued behind another run" }}
			/>,
		);

		expect(container.querySelectorAll("[data-testid='turn-progress']")).toHaveLength(1);
		expect(container.querySelector("[data-testid='agent-activity']")).toBeNull();
		expect(container.textContent).not.toContain("thoughtContent");
	});

	it("keeps assistant text on either side of tool calls in transcript order", () => {
		const parts = [
			{ type: "text", text: "Before" },
			{ type: "tool-Bash", toolCallId: "call-1" },
			{ type: "text", text: "After" },
		];
		const elements = buildAssistantElements(parts, {
			messageId: "ordered",
			isLast: false,
			isStreaming: false,
			ToolRendererComponent: ({ part }) => <div data-order="tool">{part.type}</div>,
			TextRendererComponent: ({ content }) => <div data-order="text">{content}</div>,
		});
		const { container } = render(<>{elements}</>);

		expect(
			Array.from(container.querySelectorAll("[data-order], [data-testid='assistant-tool-trace']")).map(
				(node) => node.getAttribute("data-order") ?? "tool",
			),
		).toEqual(["text", "tool", "text"]);
		expect(container.textContent).toContain("Before");
		expect(container.textContent).toContain("After");
	});

	it("hides questionnaire tool parts from transcript presentation", () => {
		const elements = buildAssistantElements(
			[{ type: "tool-Question", toolCallId: "question-1", state: "input-available" }],
			{
				messageId: "question",
				isLast: true,
				isStreaming: true,
				ToolRendererComponent: ({ part }) => <div>{part.type}</div>,
				TextRendererComponent: ({ content }) => <div>{content}</div>,
			},
		);

		expect(elements).toHaveLength(0);
	});
});
