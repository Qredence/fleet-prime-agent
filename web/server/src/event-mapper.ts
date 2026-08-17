import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent, UserMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ChatMessage, ChatStreamEvent, ChatToolPart } from "@prime-agent/web-protocol";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert "ipython" | "bash" | "edit_file" | "read_file" — special-cases IPython + short acronyms. */
function toPascalCase(name: string): string {
	return name
		.split(/[_\-\s]+/g)
		.filter(Boolean)
		.map((w) => {
			if (w.toLowerCase() === "ipython") return "IPython";
			if (w.length <= 3 && /^[a-z]+$/.test(w)) return w.toUpperCase();
			return w.charAt(0).toUpperCase() + w.slice(1);
		})
		.join("");
}

function makeToolType(toolName: string): string {
	if (toolName === "thinking") return "tool-Thinking";
	return `tool-${toPascalCase(toolName)}`;
}

function isAssistantMessage(msg: AgentMessage): msg is AssistantMessage {
	return (msg as { role?: unknown }).role === "assistant";
}

function isUserMessage(msg: AgentMessage): msg is UserMessage {
	return (msg as { role?: unknown }).role === "user";
}

function getTimestamp(msg: AgentMessage): number | undefined {
	const t = (msg as { timestamp?: unknown }).timestamp;
	return typeof t === "number" ? t : undefined;
}

function toChatMessageFromAssistant(msg: AssistantMessage, id: string): ChatMessage {
	const parts: ChatMessage["parts"] = [];
	for (const block of msg.content) {
		if (block.type === "text") {
			parts.push({ type: "text", text: block.text });
		} else if (block.type === "thinking") {
			parts.push({
				type: "tool-Thinking",
				state: "output-available",
				input: { thought: block.thinking },
				output: block.thinking,
			} satisfies ChatToolPart);
		} else if (block.type === "toolCall") {
			parts.push({
				type: makeToolType(block.name),
				toolCallId: block.id,
				state: "output-available",
				input: block.arguments,
			} satisfies ChatToolPart);
		}
	}
	return promoteThinkingToAssistantText({
		id,
		role: "assistant",
		parts,
		createdAt: getTimestamp(msg),
	});
}

function toChatMessageFromUser(msg: UserMessage, id: string): ChatMessage {
	const parts: ChatMessage["parts"] = [];
	const content = msg.content;
	if (typeof content === "string") {
		parts.push({ type: "text", text: content });
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (typeof block === "string") {
				parts.push({ type: "text", text: block });
			} else if (block && typeof block === "object" && "type" in block) {
				const b = block as { type: string; text?: string };
				if (b.type === "text" && typeof b.text === "string") {
					parts.push({ type: "text", text: b.text });
				}
			}
		}
	}
	return { id, role: "user", parts, createdAt: getTimestamp(msg) };
}

// Re-export so server code can use it when hydrating from a transcript.
export { toChatMessageFromAssistant, toChatMessageFromUser };

// ---------------------------------------------------------------------------
// Per-session mapper state
// ---------------------------------------------------------------------------

export interface EventMapperState {
	runId: string;
	sessionId: string;
	messageSeq: number;
	currentMessageId: string | undefined;
	currentText: string;
	currentThinking: string;
	currentToolParts: ChatToolPart[];
	userMessages: ChatMessage[];
	inRun: boolean;
}

export function createEventMapperState(init?: { sessionId?: string }): EventMapperState {
	return {
		runId: "",
		sessionId: init?.sessionId ?? "",
		messageSeq: 0,
		currentMessageId: undefined,
		currentText: "",
		currentThinking: "",
		currentToolParts: [],
		userMessages: [],
		inRun: false,
	};
}

function resetRun(state: EventMapperState): void {
	state.runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	state.messageSeq = 0;
	state.currentMessageId = undefined;
	state.currentText = "";
	state.currentThinking = "";
	state.currentToolParts = [];
	state.userMessages = [];
	state.inRun = true;
}

function upsertCurrentToolPart(state: EventMapperState, nextPart: ChatToolPart): ChatToolPart {
	const toolCallId = nextPart.toolCallId;
	if (typeof toolCallId !== "string" || toolCallId.length === 0) {
		state.currentToolParts.push(nextPart);
		return nextPart;
	}

	const existingIndex = state.currentToolParts.findIndex((part) => part.toolCallId === toolCallId);
	if (existingIndex < 0) {
		state.currentToolParts.push(nextPart);
		return nextPart;
	}

	const existing = state.currentToolParts[existingIndex]!;
	const merged: ChatToolPart = {
		...existing,
		...nextPart,
		...(existing.input !== undefined ? { input: existing.input } : {}),
	};
	state.currentToolParts[existingIndex] = merged;
	return merged;
}

// ---------------------------------------------------------------------------
// Core agent-loop events
// ---------------------------------------------------------------------------

function mapCoreAgentEvent(state: EventMapperState, event: AgentEvent): ChatStreamEvent[] | undefined {
	switch (event.type) {
		case "agent_start": {
			resetRun(state);
			return [{ type: "state", state: { name: "agent_start" } }];
		}
		case "agent_end": {
			const finalMessage = finalizeAssistantMessage(state);
			state.inRun = false;
			return [
				{ type: "state", state: { name: "agent_settled" } },
				{
					type: "done",
					runId: state.runId,
					message: finalMessage,
					sessionId: state.sessionId,
				},
			];
		}
		case "turn_start":
			return [{ type: "state", state: { name: "turn_start" } }];
		case "turn_end":
			return [{ type: "state", state: { name: "turn_end" } }];
		case "message_start": {
			if (isUserMessage(event.message)) {
				const id = `${state.runId}-u${state.userMessages.length}`;
				state.userMessages.push(toChatMessageFromUser(event.message, id));
			}
			return [];
		}
		case "message_update": {
			if (!isAssistantMessage(event.message)) return [];
			return mapAssistantStreamEvent(state, event.assistantMessageEvent);
		}
		case "message_end":
			return [];
		case "tool_execution_start": {
			const part = upsertCurrentToolPart(state, {
				type: makeToolType(event.toolName),
				toolCallId: event.toolCallId,
				state: "input-streaming",
				input: event.args,
			});
			return [{ type: "tool", part, messageId: state.currentMessageId }];
		}
		case "tool_execution_update": {
			const part = upsertCurrentToolPart(state, {
				type: makeToolType(event.toolName),
				toolCallId: event.toolCallId,
				state: "input-streaming",
				input: event.args,
				result: event.partialResult,
			});
			return [{ type: "tool", part, messageId: state.currentMessageId }];
		}
		case "tool_execution_end": {
			const part = upsertCurrentToolPart(state, {
				type: makeToolType(event.toolName),
				toolCallId: event.toolCallId,
				state: event.isError ? "output-error" : "output-available",
				output: event.result,
				result: event.result,
			});
			return [{ type: "tool", part, messageId: state.currentMessageId }];
		}
		default:
			return undefined;
	}
}

function mapAssistantStreamEvent(state: EventMapperState, event: AssistantMessageEvent): ChatStreamEvent[] {
	switch (event.type) {
		case "start": {
			if (!state.currentMessageId) {
				state.currentMessageId = `${state.runId}-a${state.messageSeq++}`;
			}
			return [];
		}
		case "text_delta": {
			if (!state.currentMessageId) {
				state.currentMessageId = `${state.runId}-a${state.messageSeq++}`;
			}
			state.currentText += event.delta;
			return [
				{
					type: "delta",
					text: event.delta,
					messageId: state.currentMessageId,
				},
			];
		}
		case "thinking_delta": {
			if (!state.currentMessageId) {
				state.currentMessageId = `${state.runId}-a${state.messageSeq++}`;
			}
			state.currentThinking += event.delta;
			return [
				{
					type: "thinking",
					text: event.delta,
					messageId: state.currentMessageId,
				},
			];
		}
		case "text_start":
		case "text_end":
		case "thinking_start":
		case "thinking_end":
		case "toolcall_start":
		case "toolcall_delta":
		case "toolcall_end":
		case "done":
		case "error":
			return [];
		default:
			return [];
	}
}

// ---------------------------------------------------------------------------
// Session-specific events (AgentSessionEvent extends AgentEvent)
// ---------------------------------------------------------------------------

/** Events we know about but map to nothing (RLM children, bash streams, etc.). */
const KNOWN_IGNORED = new Set([
	"rlm_child_update",
	"recap_update",
	"goal_update",
	"bash_start",
	"bash_output",
	"bash_end",
	"refine_complete",
	"refine_failed",
	"session_info_changed",
	"thinking_level_changed",
	"service_tier_changed",
]);

function mapSessionSpecificEvent(_state: EventMapperState, event: AgentSessionEvent): ChatStreamEvent[] {
	switch (event.type) {
		case "compaction_start":
			return [{ type: "compaction", phase: "start", reason: event.reason }];
		case "compaction_end":
			return [
				{
					type: "compaction",
					phase: "end",
					reason: event.reason,
					aborted: event.aborted,
					willRetry: event.willRetry,
					...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}),
				},
			];
		case "auto_retry_start":
			return [
				{
					type: "retry",
					phase: "start",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					errorMessage: event.errorMessage,
				},
			];
		case "auto_retry_end":
			return [
				{
					type: "retry",
					phase: "end",
					success: event.success,
					attempt: event.attempt,
					...(event.finalError !== undefined ? { finalError: event.finalError } : {}),
				},
			];
		case "session_action_update": {
			const actions = event.actions as { steering?: readonly string[]; followUps?: readonly string[] } | undefined;
			const steering = Array.from(actions?.steering ?? []) as string[];
			const followUp = Array.from(actions?.followUps ?? []) as string[];
			return [{ type: "queue", steering, followUp }];
		}
		case "auth_stale":
			return [
				{
					type: "error",
					message: `Authentication for ${event.provider} is stale. Sign in again to continue.`,
				},
			];
		case "ipython_sent_agent_message":
			return [
				{
					type: "state",
					state: { name: "agent_start", message: "Subagent message received" },
				},
			];
		default: {
			if (KNOWN_IGNORED.has(event.type)) return [];
			// Future prime-agent events: ignore silently. Compile-time exhaustiveness
			// is enforced by the caller's `never` check on AgentSessionEvent's union.
			return [];
		}
	}
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

function thinkingTextFromPart(part: ChatMessage["parts"][number]): string {
	if (part.type !== "tool-Thinking") return "";
	if (part.input && typeof part.input === "object") {
		const rec = part.input as Record<string, unknown>;
		if (typeof rec.thought === "string") return rec.thought;
		if (typeof rec.text === "string") return rec.text;
	}
	if (typeof part.output === "string") return part.output;
	if (part.output && typeof part.output === "object") {
		const rec = part.output as Record<string, unknown>;
		if (typeof rec.thought === "string") return rec.thought;
		if (typeof rec.text === "string") return rec.text;
	}
	return "";
}

function promoteThinkingToAssistantText(message: ChatMessage): ChatMessage {
	if (message.role !== "assistant") return message;
	const text = message.parts
		.filter((part): part is Extract<ChatMessage["parts"][number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("");
	if (text.trim()) return message;
	const thinking = message.parts.map(thinkingTextFromPart).join("");
	if (!thinking.trim()) return message;
	const tools = message.parts.filter((part) => part.type !== "text" && part.type !== "tool-Thinking");
	return {
		...message,
		parts: [{ type: "text", text: thinking }, ...tools],
	};
}

function finalizeAssistantMessage(state: EventMapperState): ChatMessage {
	const parts: ChatMessage["parts"] = [];
	if (state.currentText.length > 0) {
		parts.push({ type: "text", text: state.currentText });
	}
	if (state.currentThinking.length > 0) {
		parts.push({
			type: "tool-Thinking",
			state: "output-available",
			input: { thought: state.currentThinking },
			output: state.currentThinking,
		} satisfies ChatToolPart);
	}
	for (const part of state.currentToolParts) {
		parts.push(part);
	}
	return promoteThinkingToAssistantText({
		id: state.currentMessageId ?? `${state.runId}-a${state.messageSeq}`,
		role: "assistant",
		parts,
	});
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate one AgentSessionEvent into zero-or-more ChatStreamEvent frames.
 *
 * Pure: no I/O. All session-local state lives in `state`. Returns `[]` for
 * events we deliberately suppress (either because the UI doesn't render them
 * or because the underlying field is already conveyed by a sibling event).
 */
export function mapAgentSessionEvent(state: EventMapperState, event: AgentSessionEvent): ChatStreamEvent[] {
	const asCore = mapCoreAgentEvent(state, event as AgentEvent);
	if (asCore !== undefined) return asCore;
	return mapSessionSpecificEvent(state, event);
}

export function mapAgentSessionEvents(
	state: EventMapperState,
	events: readonly AgentSessionEvent[],
): ChatStreamEvent[] {
	const out: ChatStreamEvent[] = [];
	for (const evt of events) {
		out.push(...mapAgentSessionEvent(state, evt));
	}
	return out;
}
