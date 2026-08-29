import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent, ImageContent, UserMessage } from "@earendil-works/pi-ai";
import type {
	ChatClarificationQuestion,
	ChatImagePart,
	ChatMessage,
	ChatReasoningPresentation,
	ChatReasoningStep,
	ChatStreamEvent,
	ChatToolCategory,
	ChatToolPart,
	FleetErrorEnvelope,
	PrimeAgentArtifact,
	PrimeAgentGoal,
	PrimeAgentParentSession,
	PrimeAgentRefinement,
	PrimeAgentRefinementEdit,
	PrimeAgentRlmChild,
	PrimeAgentRlmNode,
	PrimeAgentRlmTree,
	PrimeAgentSessionPresentation,
	PrimeAgentUserBash,
} from "@prime-agent/web-protocol";
import type { AgentConnectionEvent, AgentSessionEvent } from "prime-agent";
import { truncateTail } from "prime-agent";
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

export function categorizeTool(rawName: string): { category: ChatToolCategory; toolName: string; serverName?: string } {
	const lower = rawName.toLowerCase();
	if (lower === "ipython" || lower === "jupyter") {
		return { category: "kernel", toolName: "ipython" };
	}
	if (lower === "bash" || lower === "sh" || lower === "terminal") {
		return { category: "system", toolName: "bash" };
	}
	if (
		lower === "edit" ||
		lower === "edit_file" ||
		lower === "write" ||
		lower === "write_file" ||
		lower === "read" ||
		lower === "read_file" ||
		lower === "glob" ||
		lower === "grep"
	) {
		return { category: "system", toolName: rawName };
	}
	if (lower.startsWith("tool-question") || lower === "question" || lower === "ask_question") {
		return { category: "question", toolName: "ask_question" };
	}
	if (lower.startsWith("plan") || lower.startsWith("todo")) {
		return { category: "plan", toolName: rawName };
	}
	if (lower === "task" || lower === "agent" || lower === "rlm" || lower.startsWith("subagent")) {
		return { category: "rlm", toolName: rawName };
	}
	if (rawName.startsWith("mcp__") || rawName.includes("/")) {
		const parts = rawName.replace(/^mcp__/, "").split(/[_/]/);
		const serverName = parts[0];
		const toolName = parts.slice(1).join("_") || rawName;
		return { category: "mcp", toolName, serverName };
	}
	return { category: "custom", toolName: rawName };
}

export function createFleetErrorEnvelope(
	err: unknown,
	fallbackMessage = "An unexpected error occurred",
): FleetErrorEnvelope {
	const message = typeof err === "string" ? err : err instanceof Error ? err.message : fallbackMessage;
	const lower = message.toLowerCase();

	if (
		lower.includes("auth") ||
		lower.includes("stale") ||
		(lower.includes("token") && (lower.includes("expired") || lower.includes("invalid")))
	) {
		return {
			code: "AUTH_CREDENTIAL_EXPIRED",
			message,
			isTerminal: true,
			remediation: {
				action: "open_settings_tab",
				label: "Re-authenticate in Settings",
			},
		};
	}
	if (lower.includes("rate limit") || lower.includes("429") || lower.includes("quota")) {
		return {
			code: "RATE_LIMIT",
			message,
			isTerminal: false,
			remediation: {
				action: "retry_turn",
				label: "Retry in a moment",
			},
		};
	}
	if (lower.includes("context length") || lower.includes("maximum context") || lower.includes("overflow")) {
		return {
			code: "CONTEXT_OVERFLOW",
			message,
			isTerminal: false,
			remediation: {
				action: "compact_context",
				label: "Compact Context",
			},
		};
	}
	if (lower.includes("kernel") && (lower.includes("died") || lower.includes("crashed") || lower.includes("restart"))) {
		return {
			code: "KERNEL_CRASH",
			message,
			isTerminal: false,
			remediation: {
				action: "restart_kernel",
				label: "Restart IPython Kernel",
			},
		};
	}
	if (lower.includes("timeout") || lower.includes("timed out")) {
		return {
			code: "TOOL_TIMEOUT",
			message,
			isTerminal: false,
			remediation: {
				action: "retry_turn",
				label: "Retry with longer timeout",
			},
		};
	}

	return {
		code: "UNKNOWN_ERROR",
		message,
		isTerminal: false,
	};
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
			const { category, toolName, serverName } = categorizeTool(value.name);
			parts.push({
				type: makeToolType(value.name),
				category,
				toolName,
				serverName,
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

// ---------------------------------------------------------------------------
// Daemon question normalization
// ---------------------------------------------------------------------------

export interface DaemonQuestionOption {
	value: string;
	label: string;
	description?: string;
}

export interface NormalizedDaemonQuestion {
	id: string;
	question: string;
	options: Array<DaemonQuestionOption>;
	isMultiSelect: boolean;
	defaultOption?: string;
	allowWriteIn: boolean;
}

/**
 * Normalizes the heterogeneous question shapes emitted by daemon extensions
 * (`question`/`prompt`/`title` text, string or object options, camelCase or
 * snake_case flags) into a single canonical form. Returns `undefined` when
 * `raw` is not an array or yields no questions.
 */
export function normalizeDaemonQuestions(raw: unknown): Array<NormalizedDaemonQuestion> | undefined {
	if (!Array.isArray(raw)) return undefined;
	const questions: Array<NormalizedDaemonQuestion> = [];
	for (const [index, entry] of raw.entries()) {
		const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
		const question =
			typeof item.question === "string" && item.question.trim()
				? item.question
				: typeof item.prompt === "string" && item.prompt.trim()
					? item.prompt
					: typeof item.title === "string" && item.title.trim()
						? item.title
						: "";
		const options: Array<DaemonQuestionOption> = [];
		if (Array.isArray(item.options)) {
			for (const option of item.options) {
				if (typeof option === "string") {
					if (option.trim()) options.push({ value: option, label: option });
					continue;
				}
				if (!option || typeof option !== "object") continue;
				const record = option as Record<string, unknown>;
				const value =
					typeof record.value === "string"
						? record.value
						: typeof record.id === "string"
							? record.id
							: typeof record.label === "string"
								? record.label
								: undefined;
				if (value === undefined) continue;
				const label = typeof record.label === "string" && record.label.trim() ? record.label : value;
				const description =
					typeof record.description === "string" && record.description.trim() ? record.description : undefined;
				options.push(description === undefined ? { value, label } : { value, label, description });
			}
		}
		const isMultiSelect =
			typeof item.isMultiSelect === "boolean"
				? item.isMultiSelect
				: typeof item.is_multi_select === "boolean"
					? item.is_multi_select
					: item.kind === "multi";
		const allowWriteIn =
			typeof item.allowWriteIn === "boolean"
				? item.allowWriteIn
				: typeof item.allow_write_in === "boolean"
					? item.allow_write_in
					: typeof item.allowOther === "boolean"
						? item.allowOther
						: typeof item.allowCustom === "boolean"
							? item.allowCustom
							: false;
		questions.push({
			id: typeof item.id === "string" && item.id.trim() ? item.id : `question-${index + 1}`,
			question,
			options,
			isMultiSelect,
			...(typeof item.defaultOption === "string" ? { defaultOption: item.defaultOption } : {}),
			allowWriteIn,
		});
	}
	return questions.length > 0 ? questions : undefined;
}

/** Projects normalized questions into the `ChatPendingDialog` registry shape. */
export function normalizedQuestionsToClarification(
	questions: Array<NormalizedDaemonQuestion> | undefined,
): Array<ChatClarificationQuestion> | undefined {
	if (!questions) return undefined;
	return questions.map((q) => ({
		id: q.id,
		question: q.question,
		...(q.options.length > 0 ? { options: q.options.map((o) => o.value) } : {}),
		...(q.isMultiSelect ? { isMultiSelect: true } : {}),
		...(q.defaultOption !== undefined ? { defaultOption: q.defaultOption } : {}),
		...(q.allowWriteIn ? { allowWriteIn: true } : {}),
	}));
}

/**
 * Projects normalized questions into the wire shape consumed by the browser
 * question UI (`use-pending-question-bar` / `QuestionPrompt`): `prompt`/`title`
 * text, object options with `value`/`label`, an explicit `kind`, and
 * `allowOther`/`allowCustom` write-in flags.
 */
export function normalizedQuestionsToWire(
	questions: Array<NormalizedDaemonQuestion> | undefined,
): Array<Record<string, unknown>> | undefined {
	if (!questions || questions.length === 0) return undefined;
	return questions.map((q) => {
		let kind: "multi" | "single" | "text" = "text";
		if (q.isMultiSelect) kind = "multi";
		else if (q.options.length > 0) kind = "single";
		return {
			id: q.id,
			question: q.question,
			prompt: q.question,
			title: q.question,
			kind,
			...(q.options.length > 0 ? { options: q.options } : {}),
			...(q.allowWriteIn ? { allowOther: true, allowCustom: true } : {}),
			...(q.defaultOption !== undefined ? { defaultOption: q.defaultOption } : {}),
		};
	});
}

function toolResultOutput(msg: Record<string, unknown>): Record<string, unknown> {
	const content = contentToChatParts(msg.content);
	return {
		content,
		...(msg.details !== undefined ? { details: msg.details } : {}),
		isError: msg.isError === true,
	};
}

function extractToolErrorText(result: unknown): string {
	if (!result) return "Tool execution failed";
	if (typeof result === "string") return result;
	if (result instanceof Error) return result.message;
	if (typeof result === "object") {
		const rec = result as Record<string, unknown>;
		if (typeof rec.error === "string") return rec.error;
		if (rec.error instanceof Error) return rec.error.message;
		if (typeof rec.stderr === "string") return rec.stderr;
		if (typeof rec.message === "string") return rec.message;
		if (rec.details && typeof rec.details === "object") {
			const det = rec.details as Record<string, unknown>;
			if (typeof det.stderr === "string") return det.stderr;
			if (typeof det.error === "string") return det.error;
			if (typeof det.message === "string") return det.message;
		}
		if (Array.isArray(rec.content)) {
			const texts: Array<string> = [];
			for (const block of rec.content) {
				if (typeof block === "string") {
					if (block.trim()) texts.push(block.trim());
					continue;
				}
				if (block && typeof block === "object") {
					const item = block as { type?: unknown; text?: unknown };
					if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
						texts.push(item.text.trim());
					}
				}
			}
			if (texts.length > 0) return texts.join("\n");
		}
	}
	return "Tool execution failed";
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
		const isError = result.isError === true;
		const errorText = isError ? extractToolErrorText(result) : undefined;
		const errorEnvelope = errorText ? createFleetErrorEnvelope(errorText) : undefined;
		const durationMs =
			typeof result.durationMs === "number"
				? result.durationMs
				: typeof (result.details as { durationMs?: number })?.durationMs === "number"
					? (result.details as { durationMs: number }).durationMs
					: undefined;

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
					state: isError ? "output-error" : "output-available",
					output: toolResultOutput(result),
					result: toolResultOutput(result),
					...(durationMs !== undefined ? { durationMs } : {}),
					...(errorEnvelope ? { error: errorEnvelope } : {}),
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
						state: isError ? "output-error" : "output-available",
						output: toolResultOutput(result),
						result: toolResultOutput(result),
						...(durationMs !== undefined ? { durationMs } : {}),
						...(errorEnvelope ? { error: errorEnvelope } : {}),
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

export function computeRlmExecutionTree(
	rootSessionId: string,
	children: readonly PrimeAgentRlmChild[],
	activeNodeId?: string,
): PrimeAgentRlmTree {
	const nodes: Record<string, PrimeAgentRlmNode> = {};
	const rootChildrenIds: string[] = [];

	for (const child of children) {
		nodes[child.id] = {
			...child,
			depth: 1,
			childrenIds: [],
		};
	}

	for (const child of children) {
		if (child.parentId && child.parentId !== rootSessionId && nodes[child.parentId]) {
			nodes[child.parentId].childrenIds.push(child.id);
		} else {
			rootChildrenIds.push(child.id);
		}
	}

	const queue: Array<{ id: string; depth: number }> = rootChildrenIds.map((id) => ({ id, depth: 1 }));
	const visited = new Set<string>();

	while (queue.length > 0) {
		const item = queue.shift();
		if (!item || visited.has(item.id)) continue;
		visited.add(item.id);

		const node = nodes[item.id];
		if (node) {
			node.depth = item.depth;
			for (const childId of node.childrenIds) {
				queue.push({ id: childId, depth: item.depth + 1 });
			}
		}
	}

	return {
		rootSessionId,
		nodes,
		rootChildrenIds,
		...(activeNodeId ? { activeNodeId } : {}),
	};
}

export function safeRlmChild(
	child: Extract<AgentSessionEvent, { type: "rlm_child_update" }>["child"],
): PrimeAgentRlmChild {
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
			const { category, toolName, serverName } = categorizeTool(event.toolName);
			const part = upsertCurrentToolPart(state, {
				type: makeToolType(event.toolName),
				category,
				toolName,
				serverName,
				toolCallId: event.toolCallId,
				state: "input-streaming",
				input: event.args,
			});
			return [reasoningFrame(state, "executing", true), { type: "tool", part, messageId: state.currentMessageId }];
		}
		case "tool_execution_update": {
			const { category, toolName, serverName } = categorizeTool(event.toolName);
			const part = upsertCurrentToolPart(state, {
				type: makeToolType(event.toolName),
				category,
				toolName,
				serverName,
				toolCallId: event.toolCallId,
				state: "input-streaming",
				input: event.args,
				result: event.partialResult,
			});
			return [{ type: "tool", part, messageId: state.currentMessageId }];
		}
		case "tool_execution_end": {
			const { category, toolName, serverName } = categorizeTool(event.toolName);
			const errorText = event.isError ? extractToolErrorText(event.result) : undefined;
			const errorEnvelope = errorText ? createFleetErrorEnvelope(errorText) : undefined;
			const durationMs =
				typeof (event.result as { durationMs?: number })?.durationMs === "number"
					? (event.result as { durationMs: number }).durationMs
					: typeof (event.result as { details?: { durationMs?: number } })?.details?.durationMs === "number"
						? (event.result as { details: { durationMs: number } }).details.durationMs
						: undefined;

			const part = upsertCurrentToolPart(state, {
				type: makeToolType(event.toolName),
				category,
				toolName,
				serverName,
				toolCallId: event.toolCallId,
				state: event.isError ? "output-error" : "output-available",
				output: event.result,
				result: event.result,
				...(durationMs !== undefined ? { durationMs } : {}),
				...(errorEnvelope ? { error: errorEnvelope } : {}),
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
		case "compaction_end": {
			const summary = event.result?.summary;
			const tokensBefore = event.result?.tokensBefore;
			const firstKeptEntryId = event.result?.firstKeptEntryId;
			const errorMsg = event.errorMessage ? withOAuthBindingGuidance(event.errorMessage) : undefined;
			const error = errorMsg ? createFleetErrorEnvelope(errorMsg) : undefined;
			const frames: ChatStreamEvent[] = [
				reasoningFrame(state, "recovering", false),
				{
					type: "compaction",
					phase: "end",
					reason: event.reason,
					aborted: event.aborted,
					willRetry: event.willRetry,
					...(summary !== undefined ? { summary } : {}),
					...(tokensBefore !== undefined ? { tokensBefore } : {}),
					...(firstKeptEntryId !== undefined ? { firstKeptEntryId } : {}),
					...(errorMsg !== undefined ? { errorMessage: errorMsg } : {}),
					...(error !== undefined ? { error } : {}),
				},
			];
			if (event.result) {
				const artifact: PrimeAgentArtifact = {
					id: stablePresentationId(`${presentationRunId(state)}:compaction:${Date.now()}`),
					runId: presentationRunId(state),
					kind: "compaction",
					title: `Compacted (${event.reason})`,
					status: event.aborted ? "cancelled" : errorMsg ? "error" : "success",
					output: {
						reason: event.reason,
						summary: event.result.summary,
						tokensBefore: event.result.tokensBefore,
						firstKeptEntryId: event.result.firstKeptEntryId,
					},
					timestamp: Date.now(),
				};
				frames.unshift(emitPresentation(state, upsertArtifact(state.presentation, artifact)));
			}
			return frames;
		}
		case "auto_retry_start": {
			const errorMsg = event.errorMessage ? withOAuthBindingGuidance(event.errorMessage) : undefined;
			const error = errorMsg ? createFleetErrorEnvelope(errorMsg) : undefined;
			return [
				reasoningFrame(state, "recovering", true),
				{
					type: "retry",
					phase: "start",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					...(errorMsg !== undefined ? { errorMessage: errorMsg } : {}),
					...(error !== undefined ? { error } : {}),
				},
			];
		}
		case "auto_retry_end": {
			const finalErrorMsg = event.finalError ? withOAuthBindingGuidance(event.finalError) : undefined;
			const error = finalErrorMsg ? createFleetErrorEnvelope(finalErrorMsg) : undefined;
			return [
				reasoningFrame(state, event.success ? "recovering" : "error", false),
				{
					type: "retry",
					phase: "end",
					success: event.success,
					attempt: event.attempt,
					...(finalErrorMsg !== undefined ? { finalError: finalErrorMsg } : {}),
					...(error !== undefined ? { error } : {}),
				},
			];
		}
		case "session_action_update": {
			const actions = event.actions as { steering?: readonly string[]; followUps?: readonly string[] } | undefined;
			const steering = Array.from(actions?.steering ?? []) as string[];
			const followUp = Array.from(actions?.followUps ?? []) as string[];
			return [{ type: "queue", steering, followUp }];
		}
		case "auth_stale": {
			const message = `Authentication for ${event.provider} is stale. Sign in again to continue.`;
			return [
				reasoningFrame(state, "error", false),
				{
					type: "error",
					message,
					error: createFleetErrorEnvelope(message),
				},
			];
		}
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
			const rawRlmChildren = state.presentation.rlmChildren.filter((entry) => entry.id !== child.id);
			rawRlmChildren.push(child);
			const rlmTree = computeRlmExecutionTree(state.sessionId, rawRlmChildren, child.id);
			const rlmChildren = rawRlmChildren.map((c) => {
				const treeNode = rlmTree.nodes[c.id];
				return treeNode ? { ...c, depth: treeNode.depth, childrenIds: treeNode.childrenIds } : c;
			});
			const presentation: PrimeAgentSessionPresentation = {
				...state.presentation,
				rlmChildren,
				rlmTree,
			};
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
			const updatedChild = rlmTree.nodes[child.id] ?? child;
			return [
				emitPresentation(state, upsertArtifact(presentation, artifact)),
				{ type: "rlm", child: updatedChild, tree: rlmTree },
			];
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
		case "session_replaced": {
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
		case "session_resynced": {
			resetRun(state);
			const events: ChatStreamEvent[] = [];
			if (event.snapshot.parent || event.snapshot.children) {
				const rawRlmChildren = (event.snapshot.children ?? []).map(safeRlmChild);
				const rlmTree = computeRlmExecutionTree(state.sessionId, rawRlmChildren);
				const rlmChildren = rawRlmChildren.map((c) => {
					const treeNode = rlmTree.nodes[c.id];
					return treeNode ? { ...c, depth: treeNode.depth, childrenIds: treeNode.childrenIds } : c;
				});
				const parent: PrimeAgentParentSession | undefined = event.snapshot.parent
					? {
							...(event.snapshot.parent.activeSessionId
								? { activeSessionId: event.snapshot.parent.activeSessionId }
								: {}),
							...(event.snapshot.parent.sessionId ? { sessionId: event.snapshot.parent.sessionId } : {}),
							...(event.snapshot.parent.nodeId ? { nodeId: event.snapshot.parent.nodeId } : {}),
							...(event.snapshot.parent.childId ? { childId: event.snapshot.parent.childId } : {}),
						}
					: state.presentation.parent;
				const presentation: PrimeAgentSessionPresentation = {
					...state.presentation,
					...(parent ? { parent } : {}),
					rlmChildren,
					rlmTree,
				};
				events.push(emitPresentation(state, presentation));
			}
			const resetMessage: ChatMessage = {
				id: state.currentMessageId ?? `${state.runId}-reset`,
				role: "assistant",
				parts: [],
				createdAt: Date.now(),
			};
			events.push(
				{ type: "state", state: { name: "agent_settled" } },
				{
					type: "done",
					runId: state.runId,
					sessionId: state.sessionId,
					message: resetMessage,
					sessionReset: true,
				},
			);
			return events;
		}
		case "extension_ui_request": {
			// Forward a serializable UI request to the web client as a tool
			// frame. The bridge's dialog registry maps the `toolCallId` to a
			// PendingDialog, and `answerDialog` resolves it from the answer.
			const request = event.request;
			const payload = (request.payload && typeof request.payload === "object" ? request.payload : {}) as Record<
				string,
				unknown
			>;
			return [
				{
					type: "tool",
					part: {
						type: "tool-Question",
						category: "question",
						toolName: "ask_question",
						toolCallId: request.id,
						state: "input-streaming",
						input: {
							kind: "extension",
							method: request.method,
							title: typeof payload.title === "string" ? payload.title : undefined,
							message: typeof payload.message === "string" ? payload.message : undefined,
							options: Array.isArray(payload.options) ? payload.options : undefined,
							questions: normalizedQuestionsToWire(normalizeDaemonQuestions(payload.questions)),
							placeholder: typeof payload.placeholder === "string" ? payload.placeholder : undefined,
							payload: request.payload,
						},
					},
				},
			];
		}
		case "extension_error": {
			const envelope: FleetErrorEnvelope = {
				code: "EXTENSION_ERROR",
				message: `Extension error in ${event.extensionPath}: ${event.error}`,
				isTerminal: false,
			};
			return [
				{
					type: "error",
					message: envelope.message,
					runId: state.runId,
					code: envelope.code,
					error: envelope,
				},
			];
		}
		case "closed": {
			if (event.error) {
				const envelope = createFleetErrorEnvelope(event.error, "Connection closed with error");
				return [
					{
						type: "error",
						message: envelope.message,
						runId: state.runId,
						code: envelope.code,
						error: envelope,
					},
				];
			}
			return [];
		}
		case "side_question_event":
		case "connection_status":
		case "heartbeats_changed":
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
