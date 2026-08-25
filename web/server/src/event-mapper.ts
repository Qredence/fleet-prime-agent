import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent, ImageContent, UserMessage } from "@earendil-works/pi-ai";
import type { AgentConnectionEvent, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "@earendil-works/pi-coding-agent";
import type {
	ChatImagePart,
	ChatMessage,
	ChatReasoningPresentation,
	ChatReasoningStep,
	ChatStreamEvent,
	ChatToolPart,
	PrimeAgentArtifact,
	PrimeAgentGoal,
	PrimeAgentRefinement,
	PrimeAgentRefinementEdit,
	PrimeAgentSessionPresentation,
	PrimeAgentUserBash,
} from "@prime-agent/web-protocol";
import {
	createEmptyPrimeAgentSessionPresentation,
	stablePresentationId,
	upsertArtifact,
} from "./prime-agent-presentation";

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

function textFromAssistantMessage(msg: AssistantMessage): string {
	let text = "";
	for (const block of msg.content) {
		if (block.type === "text") text += block.text;
	}
	return text;
}

function getTimestamp(msg: AgentMessage): number | undefined {
	const t = (msg as { timestamp?: unknown }).timestamp;
	return typeof t === "number" ? t : undefined;
}

function imageToChatPart(image: ImageContent): ChatImagePart {
	return {
		type: "image",
		url: `data:${image.mimeType};base64,${image.data}`,
		mimeType: image.mimeType,
	};
}

function contentToChatParts(content: unknown): ChatMessage["parts"] {
	const blocks = typeof content === "string" ? [content] : Array.isArray(content) ? content : [];
	const parts: ChatMessage["parts"] = [];
	for (const block of blocks) {
		if (typeof block === "string") {
			parts.push({ type: "text", text: block });
			continue;
		}
		if (!block || typeof block !== "object") continue;
		const value = block as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown };
		if (value.type === "text" && typeof value.text === "string") {
			parts.push({ type: "text", text: value.text });
		} else if (value.type === "image" && typeof value.data === "string" && typeof value.mimeType === "string") {
			parts.push(
				imageToChatPart({
					type: "image",
					data: value.data,
					mimeType: value.mimeType,
				}),
			);
		}
	}
	return parts;
}

function toChatMessageFromAssistant(msg: AssistantMessage, id: string): ChatMessage {
	const parts: ChatMessage["parts"] = [];
	for (const block of msg.content) {
		const value = block as {
			type: string;
			text?: string;
			data?: string;
			mimeType?: string;
			id?: string;
			name?: string;
			arguments?: unknown;
		};
		if (value.type === "text" && typeof value.text === "string") {
			parts.push({ type: "text", text: value.text });
		} else if (value.type === "image" && value.data && value.mimeType) {
			parts.push(imageToChatPart({ type: "image", data: value.data, mimeType: value.mimeType }));
		} else if (value.type === "toolCall" && value.id && value.name) {
			parts.push({
				type: makeToolType(value.name),
				toolCallId: value.id,
				state: "output-available",
				input: value.arguments,
			} satisfies ChatToolPart);
		}
	}
	return {
		id,
		role: "assistant",
		parts,
		createdAt: getTimestamp(msg),
	};
}

function toChatMessageFromUser(msg: UserMessage, id: string): ChatMessage {
	return { id, role: "user", parts: contentToChatParts(msg.content), createdAt: getTimestamp(msg) };
}

function toolResultOutput(msg: Record<string, unknown>): Record<string, unknown> {
	const content = contentToChatParts(msg.content);
	return {
		content,
		...(msg.details !== undefined ? { details: msg.details } : {}),
		isError: msg.isError === true,
	};
}

/** Hydrate the canonical conversation while joining persisted tool results to calls. */
export function toChatMessagesFromAgentMessages(
	messages: readonly AgentMessage[],
	sessionId: string,
): Array<ChatMessage> {
	const output: Array<ChatMessage> = [];
	for (const [index, message] of messages.entries()) {
		const role = (message as { role?: unknown }).role;
		const id = `${sessionId}-m${index}`;
		if (role === "assistant") {
			output.push(toChatMessageFromAssistant(message as AssistantMessage, id));
			continue;
		}
		if (role === "user") {
			output.push(toChatMessageFromUser(message as UserMessage, id));
			continue;
		}
		if (role !== "toolResult") continue;

		const result = message as unknown as Record<string, unknown>;
		const toolCallId = typeof result.toolCallId === "string" ? result.toolCallId : undefined;
		const toolName = typeof result.toolName === "string" ? result.toolName : "tool";
		let attached = false;
		if (toolCallId) {
			for (let messageIndex = output.length - 1; messageIndex >= 0 && !attached; messageIndex -= 1) {
				const candidate = output[messageIndex]!;
				const partIndex = candidate.parts.findIndex(
					(part) => part.type.startsWith("tool-") && (part as ChatToolPart).toolCallId === toolCallId,
				);
				if (partIndex < 0) continue;
				const part = candidate.parts[partIndex]!;
				if (!part.type.startsWith("tool-")) continue;
				const nextPart: ChatToolPart = {
					...part,
					state: result.isError === true ? "output-error" : "output-available",
					output: toolResultOutput(result),
					result: toolResultOutput(result),
				};
				output[messageIndex] = {
					...candidate,
					parts: candidate.parts.map((item, itemIndex) => (itemIndex === partIndex ? nextPart : item)),
				};
				attached = true;
			}
		}
		if (!attached) {
			output.push({
				id,
				role: "assistant",
				createdAt: typeof result.timestamp === "number" ? result.timestamp : undefined,
				parts: [
					{
						type: makeToolType(toolName),
						...(toolCallId ? { toolCallId } : {}),
						state: result.isError === true ? "output-error" : "output-available",
						output: toolResultOutput(result),
						result: toolResultOutput(result),
					},
				],
			});
		}
	}
	return output;
}

/**
 * Fallback hydration for transcript messages Fleet does not model — custom or
 * future runtime message types (e.g. 0.8.0's `refinement_outcome`) hydrate as
 * empty assistant messages instead of throwing or leaking unmodeled content.
 */
function toChatMessageFromUnknownRole(id: string): ChatMessage {
	return { id, role: "assistant", parts: [] };
}

// Re-export so server code can use them when hydrating from a transcript.
export { toChatMessageFromAssistant, toChatMessageFromUnknownRole, toChatMessageFromUser };

// ---------------------------------------------------------------------------
// Per-session mapper state
// ---------------------------------------------------------------------------

/**
 * Upstream 0.8.0 made generic MCP OAuth credentials endpoint-bound; stored
 * credentials from before the upgrade fail with a raw binding error. Detect
 * that message and give Fleet users the actual recovery step instead.
 */
const OAUTH_BINDING_ERROR = /^Stored OAuth credentials are not bound to \S+; re-run \/mcp login (.+)$/;

export function withOAuthBindingGuidance(message: string): string {
	const match = OAUTH_BINDING_ERROR.exec(message);
	if (!match) return message;
	return `The MCP connection "${match[1]}" must be signed in again (one-time re-login after the runtime upgrade; stored logins are now tied to the server URL). Run \`/mcp login ${match[1]}\` in the Prime Agent CLI, then retry.`;
}

export interface EventMapperState {
	runId: string;
	sessionId: string;
	messageSeq: number;
	currentMessageId: string | undefined;
	currentText: string;
	currentAssistantImages: ChatImagePart[];
	reasoningStartedAt: number | undefined;
	reasoningSteps: ChatReasoningStep[];
	reasoningPhase: ChatReasoningPresentation["phase"] | undefined;
	currentToolParts: ChatToolPart[];
	userMessages: ChatMessage[];
	inRun: boolean;
	presentation: PrimeAgentSessionPresentation;
	activeUserBashId: string | undefined;
	userBashSequence: number;
}

export function createEventMapperState(init?: {
	sessionId?: string;
	presentation?: PrimeAgentSessionPresentation;
}): EventMapperState {
	return {
		runId: "",
		sessionId: init?.sessionId ?? "",
		messageSeq: 0,
		currentMessageId: undefined,
		currentText: "",
		currentAssistantImages: [],
		reasoningStartedAt: undefined,
		reasoningSteps: [],
		reasoningPhase: undefined,
		currentToolParts: [],
		userMessages: [],
		inRun: false,
		presentation: init?.presentation ?? createEmptyPrimeAgentSessionPresentation(),
		activeUserBashId: undefined,
		userBashSequence: 0,
	};
}

function resetRun(state: EventMapperState): void {
	state.runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	state.messageSeq = 0;
	state.currentMessageId = undefined;
	state.currentText = "";
	state.currentAssistantImages = [];
	state.reasoningStartedAt = undefined;
	state.reasoningSteps = [];
	state.reasoningPhase = undefined;
	state.currentToolParts = [];
	state.userMessages = [];
	state.activeUserBashId = undefined;
	state.inRun = true;
}

function emitPresentation(
	state: EventMapperState,
	presentation: PrimeAgentSessionPresentation,
): Extract<ChatStreamEvent, { type: "presentation" }> {
	state.presentation = { ...presentation, revision: state.presentation.revision + 1 };
	return {
		type: "presentation",
		sessionId: state.sessionId,
		presentation: state.presentation,
	};
}

function presentationRunId(state: EventMapperState): string {
	return state.runId || state.sessionId || "session";
}

function bashStatus(input: {
	exitCode?: number;
	cancelled: boolean;
	errorMessage?: string;
}): PrimeAgentUserBash["status"] {
	if (input.cancelled) return "cancelled";
	if (input.errorMessage || (input.exitCode !== undefined && input.exitCode !== 0)) return "error";
	return "success";
}

function upsertUserBash(state: EventMapperState, next: PrimeAgentUserBash): PrimeAgentSessionPresentation {
	const userBash = [...state.presentation.userBash];
	const existingIndex = userBash.findIndex((entry) => entry.id === next.id);
	if (existingIndex < 0) userBash.push(next);
	else userBash[existingIndex] = next;
	return { ...state.presentation, userBash };
}

function userBashArtifact(entry: PrimeAgentUserBash, timestamp = Date.now()): PrimeAgentArtifact {
	return {
		id: stablePresentationId(`${entry.runId}:bash`),
		runId: entry.runId,
		sourceToolCallId: entry.runId,
		kind: "bash",
		title: entry.command || "Bash",
		status: entry.status,
		input: { command: entry.command, excludeFromContext: entry.excludeFromContext },
		output: {
			stdout: entry.output,
			...(entry.errorMessage ? { error: entry.errorMessage } : {}),
			...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
			cancelled: entry.cancelled,
			truncated: entry.truncated,
		},
		timestamp,
	};
}

function safeRlmChild(
	child: Extract<AgentSessionEvent, { type: "rlm_child_update" }>["child"],
): PrimeAgentSessionPresentation["rlmChildren"][number] {
	return {
		id: child.id,
		...(child.parentId ? { parentId: child.parentId } : {}),
		...(child.activeSessionId ? { activeSessionId: child.activeSessionId } : {}),
		...(child.sessionName ? { sessionName: child.sessionName } : {}),
		...(child.model ? { model: child.model } : {}),
		label: child.label,
		status: child.status,
		...(child.durationMs !== undefined ? { durationMs: child.durationMs } : {}),
		...(child.answerPreview ? { answerPreview: child.answerPreview } : {}),
		...(child.toolUseCount !== undefined ? { toolUseCount: child.toolUseCount } : {}),
		...(child.tokenCount !== undefined ? { tokenCount: child.tokenCount } : {}),
		...(child.recap ? { recap: child.recap } : {}),
		...(child.activity ? { activity: child.activity } : {}),
		...(child.repliedSinceTask !== undefined ? { repliedSinceTask: child.repliedSinceTask } : {}),
		...(child.error ? { error: child.error } : {}),
		timestamp: Date.now(),
	};
}

function safeGoal(goal: Extract<AgentSessionEvent, { type: "goal_update" }>["goal"]): PrimeAgentGoal {
	return {
		active: goal.active,
		status: goal.status,
		...(goal.goalId ? { goalId: goal.goalId } : {}),
		...(goal.objective ? { objective: goal.objective } : {}),
		...(goal.tokenBudget !== undefined ? { tokenBudget: goal.tokenBudget } : {}),
		tokensUsed: goal.tokensUsed,
		timeUsedSeconds: goal.timeUsedSeconds,
		continuationsUsed: goal.continuationsUsed,
		...(goal.createdAt !== undefined ? { createdAt: goal.createdAt } : {}),
		...(goal.updatedAt !== undefined ? { updatedAt: goal.updatedAt } : {}),
		...(goal.lastReason ? { lastReason: goal.lastReason } : {}),
		...(goal.lastError ? { lastError: goal.lastError } : {}),
	};
}

function refinementContent(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const content = (value as { content?: unknown }).content;
	return typeof content === "string" ? content : undefined;
}

function safeRefinement(
	result: Extract<AgentSessionEvent, { type: "refine_complete" }>["result"],
): PrimeAgentRefinement {
	const edits: PrimeAgentRefinementEdit[] = result.appliedEdits.map((edit) => ({
		action: edit.action,
		kind: edit.kind,
		id: edit.id,
		...(edit.title ? { title: edit.title } : {}),
		...(edit.content ? { content: edit.content } : {}),
		...(edit.reason ? { reason: edit.reason } : {}),
		...(refinementContent(edit.before) ? { before: refinementContent(edit.before) } : {}),
		...(refinementContent(edit.after) ? { after: refinementContent(edit.after) } : {}),
		applied: edit.applied,
		...(edit.error ? { error: edit.error } : {}),
	}));
	return {
		id: result.id,
		summary: result.summary,
		rationale: result.rationale,
		expectedOutcome: result.expectedOutcome,
		...(result.scope === "local" || result.scope === "global" ? { scope: result.scope } : {}),
		...(result.rollbackOf ? { rollbackOf: result.rollbackOf } : {}),
		edits,
		status: "success",
		timestamp: Date.now(),
	};
}

type SafeReasoningPhase = ChatReasoningPresentation["phase"];

const REASONING_COPY: Record<SafeReasoningPhase, { title: string; body: string; restingLabel: string }> = {
	waiting: {
		title: "Preparing run",
		body: "Setting up the requested task.",
		restingLabel: "Prepared run",
	},
	context: {
		title: "Reviewing workspace context",
		body: "Reviewing the available conversation and project context.",
		restingLabel: "Reviewed context",
	},
	planning: {
		title: "Planning next step",
		body: "Choosing the next safe action.",
		restingLabel: "Prepared next step",
	},
	executing: {
		title: "Running selected tools",
		body: "Executing the selected agent actions.",
		restingLabel: "Completed selected actions",
	},
	responding: {
		title: "Writing response",
		body: "Preparing the response.",
		restingLabel: "Response prepared",
	},
	recovering: {
		title: "Recovering after retry",
		body: "Recovering the current request.",
		restingLabel: "Recovery completed",
	},
	complete: {
		title: "Completed",
		body: "Finished the current run.",
		restingLabel: "Completed",
	},
	error: {
		title: "Run needs attention",
		body: "The current run could not continue normally.",
		restingLabel: "Run needs attention",
	},
};

function reasoningFrame(
	state: EventMapperState,
	phase: SafeReasoningPhase,
	streaming: boolean,
): Extract<ChatStreamEvent, { type: "reasoning" }> {
	const now = Date.now();
	const startedAt = state.reasoningStartedAt ?? now;
	state.reasoningStartedAt = startedAt;
	const copy = REASONING_COPY[phase];
	if (state.reasoningPhase !== phase) {
		state.reasoningPhase = phase;
		state.reasoningSteps.push({
			id: `${state.runId}-reasoning-${state.reasoningSteps.length}`,
			title: copy.title,
			body: copy.body,
		});
	}
	return {
		type: "reasoning",
		...(state.currentMessageId ? { messageId: state.currentMessageId } : {}),
		presentation: {
			runId: state.runId,
			phase,
			steps: [...state.reasoningSteps],
			visibleSteps: state.reasoningSteps.length,
			streaming,
			startedAt,
			elapsedMs: Math.max(0, now - startedAt),
			restingLabel: copy.restingLabel,
		},
	};
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
			return [{ type: "state", state: { name: "agent_start" } }, reasoningFrame(state, "waiting", true)];
		}
		case "agent_end": {
			const finalMessage = finalizeAssistantMessage(state);
			state.inRun = false;
			return [
				reasoningFrame(state, "complete", false),
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
			return [{ type: "state", state: { name: "turn_start" } }, reasoningFrame(state, "context", true)];
		case "turn_end":
			return [{ type: "state", state: { name: "turn_end" } }];
		case "message_start": {
			if (isUserMessage(event.message)) {
				const id = `${state.runId}-u${state.userMessages.length}`;
				const message = toChatMessageFromUser(event.message, id);
				state.userMessages.push(message);
				return [{ type: "message", message }];
			}
			return [];
		}
		case "message_update": {
			if (!isAssistantMessage(event.message)) return [];
			return mapAssistantStreamEvent(state, event.assistantMessageEvent);
		}
		case "message_end": {
			// Some providers expose their final assistant content only on the
			// authoritative message_end lifecycle event. Keep only text blocks;
			// detailed reasoning remains excluded from the Fleet browser stream.
			// The terminal text must also preserve earlier messages in this run:
			// append rather than replace, skipping the delta-equivalent suffix.
			if (isAssistantMessage(event.message)) {
				const finalText = textFromAssistantMessage(event.message);
				if (finalText && !state.currentText.endsWith(finalText)) {
					state.currentText += finalText;
				}
				const message = toChatMessageFromAssistant(
					event.message,
					state.currentMessageId ?? `${state.runId}-a${state.messageSeq}`,
				);
				state.currentAssistantImages = message.parts.filter((part): part is ChatImagePart => part.type === "image");
				if (state.currentAssistantImages.length > 0) return [{ type: "message", message }];
			}
			return [];
		}
		case "tool_execution_start": {
			const part = upsertCurrentToolPart(state, {
				type: makeToolType(event.toolName),
				toolCallId: event.toolCallId,
				state: "input-streaming",
				input: event.args,
			});
			return [reasoningFrame(state, "executing", true), { type: "tool", part, messageId: state.currentMessageId }];
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
				reasoningFrame(state, "responding", true),
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
			return [reasoningFrame(state, "planning", true)];
		}
		case "text_start":
		case "text_end":
		case "toolcall_start":
		case "toolcall_delta":
		case "toolcall_end":
		case "error":
			return [];
		case "thinking_start": {
			if (!state.currentMessageId) {
				state.currentMessageId = `${state.runId}-a${state.messageSeq++}`;
			}
			return [reasoningFrame(state, "planning", true)];
		}
		case "thinking_end":
			return [];
		case "done": {
			// Some providers deliver visible answer text only in the terminal message
			// rather than emitting text_delta events. The terminal AssistantMessage is
			// authoritative, but only text blocks may enter Fleet's standard transcript.
			// Append (skip the delta-equivalent suffix) so earlier messages in this
			// run are preserved instead of being replaced by the latest one.
			const finalText = textFromAssistantMessage(event.message);
			if (finalText && !state.currentText.endsWith(finalText)) {
				state.currentText += finalText;
			}
			const message = toChatMessageFromAssistant(
				event.message,
				state.currentMessageId ?? `${state.runId}-a${state.messageSeq}`,
			);
			state.currentAssistantImages = message.parts.filter((part): part is ChatImagePart => part.type === "image");
			return [];
		}
		default:
			return [];
	}
}

// ---------------------------------------------------------------------------
// Session-specific events (AgentSessionEvent extends AgentEvent)
// ---------------------------------------------------------------------------

function mapSessionSpecificEvent(state: EventMapperState, event: AgentSessionEvent): ChatStreamEvent[] {
	switch (event.type) {
		case "compaction_start":
			return [
				reasoningFrame(state, "recovering", true),
				{ type: "compaction", phase: "start", reason: event.reason },
			];
		case "compaction_end":
			return [
				reasoningFrame(state, "recovering", false),
				{
					type: "compaction",
					phase: "end",
					reason: event.reason,
					aborted: event.aborted,
					willRetry: event.willRetry,
					...(event.errorMessage !== undefined
						? { errorMessage: withOAuthBindingGuidance(event.errorMessage) }
						: {}),
				},
			];
		case "auto_retry_start":
			return [
				reasoningFrame(state, "recovering", true),
				{
					type: "retry",
					phase: "start",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					...(event.errorMessage !== undefined
						? { errorMessage: withOAuthBindingGuidance(event.errorMessage) }
						: {}),
				},
			];
		case "auto_retry_end":
			return [
				reasoningFrame(state, event.success ? "recovering" : "error", false),
				{
					type: "retry",
					phase: "end",
					success: event.success,
					attempt: event.attempt,
					...(event.finalError !== undefined ? { finalError: withOAuthBindingGuidance(event.finalError) } : {}),
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
				reasoningFrame(state, "error", false),
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
		case "session_info_changed":
			return [emitPresentation(state, { ...state.presentation, sessionName: event.name })];
		case "thinking_level_changed":
			return [emitPresentation(state, { ...state.presentation, thinkingLevel: event.level })];
		case "service_tier_changed":
			return [emitPresentation(state, { ...state.presentation, serviceTier: event.serviceTier })];
		case "rlm_child_update": {
			const child = safeRlmChild(event.child);
			const rlmChildren = state.presentation.rlmChildren.filter((entry) => entry.id !== child.id);
			rlmChildren.push(child);
			const presentation = { ...state.presentation, rlmChildren };
			const artifact: PrimeAgentArtifact = {
				id: stablePresentationId(`${presentationRunId(state)}:${child.id}:rlm`),
				runId: presentationRunId(state),
				sourceToolCallId: child.id,
				kind: "rlm",
				title: child.label,
				status:
					child.status === "cancelled"
						? "cancelled"
						: child.status === "error"
							? "error"
							: child.status === "done"
								? "success"
								: "running",
				output: child,
				timestamp: child.timestamp,
			};
			return [emitPresentation(state, upsertArtifact(presentation, artifact))];
		}
		case "recap_update": {
			const presentation = { ...state.presentation, recap: event.recap };
			if (!event.recap) return [emitPresentation(state, presentation)];
			const artifact: PrimeAgentArtifact = {
				id: stablePresentationId(`${presentationRunId(state)}:recap`),
				runId: presentationRunId(state),
				kind: "recap",
				title: "Recap",
				status: "success",
				output: { text: event.recap },
				timestamp: Date.now(),
			};
			return [emitPresentation(state, upsertArtifact(presentation, artifact))];
		}
		case "goal_update":
			return [emitPresentation(state, { ...state.presentation, goal: safeGoal(event.goal) })];
		case "bash_start": {
			const runId =
				event.runId ?? stablePresentationId(`bash:${state.sessionId}:${state.userBashSequence++}:${event.command}`);
			const id = stablePresentationId(`user-bash:${runId}`);
			state.activeUserBashId = id;
			const entry: PrimeAgentUserBash = {
				id,
				runId,
				command: event.command,
				output: "",
				status: "running",
				cancelled: false,
				truncated: false,
				excludeFromContext: event.excludeFromContext,
				startedAt: Date.now(),
			};
			const presentation = upsertUserBash(state, entry);
			return [emitPresentation(state, upsertArtifact(presentation, userBashArtifact(entry, entry.startedAt)))];
		}
		case "bash_output": {
			const active = state.presentation.userBash.find((entry) => entry.id === state.activeUserBashId);
			if (!active) return [];
			const entry = { ...active, output: truncateTail(active.output + event.chunk).content };
			return [emitPresentation(state, upsertArtifact(upsertUserBash(state, entry), userBashArtifact(entry)))];
		}
		case "bash_end": {
			const active = state.presentation.userBash.find(
				(entry) =>
					entry.id === state.activeUserBashId || (event.runId !== undefined && entry.runId === event.runId),
			);
			if (!active) return [];
			const entry: PrimeAgentUserBash = {
				...active,
				status: bashStatus(event),
				...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
				cancelled: event.cancelled,
				truncated: event.truncated,
				...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
				endedAt: Date.now(),
			};
			state.activeUserBashId = undefined;
			return [
				emitPresentation(
					state,
					upsertArtifact(upsertUserBash(state, entry), userBashArtifact(entry, entry.endedAt)),
				),
			];
		}
		case "refine_complete": {
			const refinement = safeRefinement(event.result);
			const refinements = [
				...state.presentation.refinements.filter((entry) => entry.id !== refinement.id),
				refinement,
			];
			const presentation = { ...state.presentation, refinements };
			const artifact: PrimeAgentArtifact = {
				id: stablePresentationId(`${presentationRunId(state)}:${refinement.id}:refinement`),
				runId: presentationRunId(state),
				sourceToolCallId: refinement.id,
				kind: "refinement",
				title: refinement.summary || "Refinement",
				status: "success",
				output: refinement,
				timestamp: refinement.timestamp,
			};
			return [emitPresentation(state, upsertArtifact(presentation, artifact))];
		}
		case "refine_failed": {
			const id = stablePresentationId(
				`${presentationRunId(state)}:refinement:${state.presentation.refinements.length}`,
			);
			const timestamp = Date.now();
			const refinement: PrimeAgentRefinement = {
				id,
				summary: "Refinement failed",
				rationale: "",
				expectedOutcome: "",
				edits: [],
				status: "error",
				error: event.error,
				timestamp,
			};
			const presentation = { ...state.presentation, refinements: [...state.presentation.refinements, refinement] };
			const artifact: PrimeAgentArtifact = {
				id: stablePresentationId(`${presentationRunId(state)}:${id}:refinement`),
				runId: presentationRunId(state),
				sourceToolCallId: id,
				kind: "refinement",
				title: refinement.summary,
				status: "error",
				output: { error: event.error },
				timestamp,
			};
			return [emitPresentation(state, upsertArtifact(presentation, artifact))];
		}
		default: {
			// Future prime-agent events: ignore silently. Compile-time exhaustiveness
			// is enforced by the caller's `never` check on AgentSessionEvent's union.
			return [];
		}
	}
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

/* Legacy raw-thinking helpers intentionally removed: standard Fleet transcript
 * messages never carry detailed model thinking. */

function finalizeAssistantMessage(state: EventMapperState): ChatMessage {
	const parts: ChatMessage["parts"] = [];
	if (state.currentText.length > 0) {
		parts.push({ type: "text", text: state.currentText });
	}
	for (const part of state.currentToolParts) {
		parts.push(part);
	}
	parts.push(...state.currentAssistantImages);
	return {
		id: state.currentMessageId ?? `${state.runId}-a${state.messageSeq}`,
		role: "assistant",
		parts,
	};
}

// ---------------------------------------------------------------------------
// Connection-level event mapping (AgentConnection seam)
// ---------------------------------------------------------------------------

/**
 * Translate one `AgentConnectionEvent` into zero-or-more `ChatStreamEvent` frames.
 *
 * The connection surface wraps the engine-internal `AgentSessionEvent` union
 * inside a `session_event` envelope and adds four new event kinds the
 * AgentSession surface never had:
 *
 *   - `session_replaced`: runtime rebuilt (new/switch/fork/import). We surface
 *     a synthetic done frame and reset the per-run mapper state so the next
 *     turn starts cleanly.
 *   - `session_resynced`: snapshot reattached after daemon recovery. Same
 *     treatment as a session_replaced for mapper state.
 *   - `extension_ui_request`: a serialized request from an extension that
 *     needs a user dialog. We surface it as a `tool-Question` frame so the
 *     web client renders the dialog and the bridge routes the answer back
 *     through `PendingDialogRegistry`.
 *   - `connection_status`, `heartbeats_changed`, `closed`, `extension_error`,
 *     `side_question_event`, `session_status`: bookkeeping we deliberately
 *     suppress at the wire level (the presentation layer already has
 *     equivalent signals from session events, or they are out of scope for
 *     the web UI).
 *
 * Pure: no I/O. All session-local state lives in `state`. Returns `[]` for
 * events we deliberately suppress.
 */
export function mapAgentConnectionEvent(state: EventMapperState, event: AgentConnectionEvent): ChatStreamEvent[] {
	switch (event.type) {
		case "session_event":
			return mapAgentSessionEvent(state, event.event);
		case "session_replaced":
		case "session_resynced": {
			// Runtime rebuilt (new/switch/fork/import) or daemon reattached.
			// Reset the per-run mapper so the next prompt starts cleanly, and
			// surface a synthetic done frame so any live SSE stream closes.
			// The empty assistant message satisfies the wire shape; SSE consumers
			// that filter on `frame.message.parts.length === 0` are the intended
			// audience. `sessionReset: true` marks the terminal as a rewind
			// rather than a real run completion.
			resetRun(state);
			const resetMessage: ChatMessage = {
				id: state.currentMessageId ?? `${state.runId}-reset`,
				role: "assistant",
				parts: [],
				createdAt: Date.now(),
			};
			return [
				{ type: "state", state: { name: "agent_settled" } },
				{
					type: "done",
					runId: state.runId,
					sessionId: state.sessionId,
					message: resetMessage,
					sessionReset: true,
				},
			];
		}
		case "extension_ui_request": {
			// Forward a serializable UI request to the web client as a tool
			// frame. The bridge's dialog registry maps the `toolCallId` to a
			// PendingDialog, and `answerDialog` resolves it from the answer.
			// The `kind: "extension"` discriminator inside the part's `input`
			// is the bridge-private contract — the client renders the same
			// tool-Question card and the answer is delivered as usual.
			const request = event.request;
			return [
				{
					type: "tool",
					part: {
						type: "tool-Question",
						toolCallId: request.id,
						state: "input-streaming",
						input: {
							kind: "extension",
							method: request.method,
							payload: request.payload,
						},
					},
				},
			];
		}
		case "side_question_event":
		case "connection_status":
		case "heartbeats_changed":
		case "closed":
		case "extension_error":
		case "session_status":
			return [];
		default: {
			// Future-proof: ignore unknown connection events silently.
			return [];
		}
	}
}

export function mapAgentConnectionEvents(
	state: EventMapperState,
	events: readonly AgentConnectionEvent[],
): ChatStreamEvent[] {
	const out: ChatStreamEvent[] = [];
	for (const evt of events) {
		out.push(...mapAgentConnectionEvent(state, evt));
	}
	return out;
}

// ---------------------------------------------------------------------------
// Legacy AgentSessionEvent entry points (kept for test back-compat)
// ---------------------------------------------------------------------------

/**
 * Translate one `AgentSessionEvent` (the engine-internal union) into
 * `ChatStreamEvent` frames. The bridge itself subscribes to
 * `AgentConnectionEvent`; this entry point exists so existing mapper tests
 * and the presentation-rebuild path can keep using the inner union.
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
