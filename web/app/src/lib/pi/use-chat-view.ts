import type { SuggestionItem } from "@prime-agent/web-design/components/agent-elements/input/suggestions";
import { normalizeSessionLabel } from "@prime-agent/web-design/lib/pi/chat-helpers";
import type {
	ChatResourcesResponse,
	ChatSessionInfo,
	WorkspaceTreeResponse,
} from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage, ChatToolPart } from "@prime-agent/web-protocol/chat-types";
import { useMemo } from "react";

export function useActiveSessionLabel({
	activeSessionId,
	messages,
	sessions,
}: {
	activeSessionId: string | undefined;
	messages: Array<ChatMessage>;
	sessions: Array<ChatSessionInfo>;
}) {
	return useMemo(
		() => getActiveSessionLabel(activeSessionId, sessions, messages),
		[activeSessionId, messages, sessions],
	);
}

export function useChatSuggestions({
	messages,
	resources,
	workspaceTree,
}: {
	messages: Array<ChatMessage>;
	resources: ChatResourcesResponse | null;
	workspaceTree: WorkspaceTreeResponse | null;
}) {
	return useMemo(
		() =>
			buildContextSuggestions({
				messages,
				resources,
				workspaceTree,
			}),
		[messages, resources, workspaceTree],
	);
}

function buildContextSuggestions({
	messages,
	resources,
	workspaceTree,
}: {
	messages: Array<ChatMessage>;
	resources: ChatResourcesResponse | null;
	workspaceTree: WorkspaceTreeResponse | null;
}): Array<SuggestionItem> {
	const hasAgentsFile = Boolean(resources?.agentsFiles.some((file) => file.name === "AGENTS.md"));
	const mentionsFrontend = (text: string) => text.toLowerCase().includes("frontend");
	const hasFrontendSkill = Boolean(
		resources?.skills.some((skill) => mentionsFrontend(`${skill.name} ${skill.description ?? ""}`)) ||
			workspaceTree?.nodes.some((node) => mentionsFrontend(JSON.stringify(node))),
	);

	// No messages — empty state (only used for centered empty suggestions)
	if (messages.length === 0) {
		return [
			suggestionItem("overview", "Summarize this project"),
			suggestionItem("frontend", hasFrontendSkill ? 'Find a skill "frontend"' : "Explore available skills"),
			suggestionItem("docs", hasAgentsFile ? "Read AGENTS.md" : "Tell me about this project"),
		];
	}

	// Derive context from the last assistant message
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	const lastUserText = extractMessageText(lastUser).toLowerCase();
	const lastAssistantText = extractMessageText(lastAssistant).toLowerCase();

	const toolTypes = new Set<string>();
	const toolFilePaths: Array<string> = [];
	if (lastAssistant) {
		for (const part of lastAssistant.parts) {
			if (part.type.startsWith("tool-")) {
				toolTypes.add(part.type);
				const input = (part as ChatToolPart).input as Record<string, unknown> | undefined;
				const filePath =
					typeof input?.file_path === "string"
						? input.file_path
						: typeof input?.path === "string"
							? input.path
							: undefined;
				if (filePath) toolFilePaths.push(filePath);
			}
		}
	}

	// Suggestions based on what tools the assistant just used
	if (toolTypes.has("tool-Write") || toolTypes.has("tool-Edit")) {
		const editedFile = toolFilePaths[toolFilePaths.length - 1] ?? "the changed file";
		const shortName = editedFile.split("/").pop() ?? editedFile;
		return [
			suggestionItem("review-changes", `Review the changes to ${shortName}`),
			suggestionItem("run-tests", "Run the tests"),
			suggestionItem("explain-changes", "Explain what was changed and why"),
		];
	}

	if (toolTypes.has("tool-Read") && !toolTypes.has("tool-Write")) {
		const readFile = toolFilePaths[toolFilePaths.length - 1] ?? "the file";
		const shortName = readFile.split("/").pop() ?? readFile;
		return [
			suggestionItem("summarize-file", `Summarize ${shortName}`),
			suggestionItem("suggest-improvements", "Suggest improvements"),
			suggestionItem("find-related", "Find related files"),
		];
	}

	if (toolTypes.has("tool-Bash")) {
		return [
			suggestionItem("explain-output", "Explain the output"),
			suggestionItem("fix-issues", "Fix any issues found"),
			suggestionItem("run-again", "Run it again with different options"),
		];
	}

	if (toolTypes.has("tool-PlanWrite")) {
		return [
			suggestionItem("execute-plan", "Execute this plan"),
			suggestionItem("refine-plan", "Refine the plan"),
			suggestionItem("explain-plan", "Explain the plan in detail"),
		];
	}

	if (toolTypes.has("tool-resource_install")) {
		return [
			suggestionItem("use-resource", "Use the installed resource"),
			suggestionItem("list-resources", "List all available resources"),
			suggestionItem("workspace", "Show workspace files"),
		];
	}

	// Suggestions based on user/assistant text content
	if (
		lastAssistantText.includes("error") ||
		lastAssistantText.includes("failed") ||
		lastAssistantText.includes("issue")
	) {
		return [
			suggestionItem("fix-error", "Fix the error"),
			suggestionItem("explain-error", "Explain what went wrong"),
			suggestionItem("suggest-alternative", "Suggest an alternative approach"),
		];
	}

	if (lastUserText.includes("what can you do") || lastUserText.includes("help")) {
		return [
			suggestionItem("frontend", 'Find a skill "frontend"'),
			suggestionItem("agents", hasAgentsFile ? "Read AGENTS.md" : "Read the repo docs"),
			suggestionItem("workspace", "Show workspace files"),
		];
	}

	if (lastUserText.includes("skill")) {
		return [
			suggestionItem("frontend-skill", 'Find a skill "frontend"'),
			suggestionItem("memory-skill", 'Find a skill "memory"'),
			suggestionItem("skill-docs", hasAgentsFile ? "Read AGENTS.md" : "Show workspace files"),
		];
	}

	// Generic follow-up based on the assistant's last response text
	if (lastAssistantText) {
		return [
			suggestionItem("go-deeper", "Go deeper on this"),
			suggestionItem("next-steps", "What should I do next?"),
			suggestionItem("workspace", "Show workspace files"),
		];
	}

	return [
		suggestionItem("overview", "Summarize this project"),
		suggestionItem("workspace", "Show workspace files"),
		suggestionItem("docs", hasAgentsFile ? "Read AGENTS.md" : "Tell me about this project"),
	];
}

function suggestionItem(id: string, label: string): SuggestionItem {
	return { id, label, value: label };
}

function extractMessageText(message: ChatMessage | undefined) {
	if (!message) return "";

	return message.parts
		.filter(
			(part): part is Extract<(typeof message.parts)[number], { type: "text" }> =>
				part.type === "text" && typeof part.text === "string",
		)
		.map((part) => part.text)
		.join(" ");
}

function getActiveSessionLabel(
	activeSessionId: string | undefined,
	sessions: Array<ChatSessionInfo>,
	messages: Array<ChatMessage>,
) {
	const activeSession = sessions.find((session) => session.id === activeSessionId);
	if (activeSession) {
		return normalizeSessionLabel(activeSession.name || activeSession.firstMessage || activeSession.id.slice(0, 8));
	}

	const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
	const label = extractMessageText(lastUserMessage).trim();
	return normalizeSessionLabel(label) || "Session";
}
