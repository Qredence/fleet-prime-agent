import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type {
	ChatErrorPart,
	ChatImagePart,
	ChatMessage,
	ChatPayloadPart,
	ChatReasoningPresentation,
	ChatReasoningStep,
	ChatStreamEvent,
	ChatToolPart,
	FleetErrorEnvelope,
	PrimeAgentArtifact,
	PrimeAgentArtifactStatus,
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
	type DaemonModelCatalogChangedFrame,
	type DaemonSessionBindingFrame,
	isDaemonModelCatalogChangedFrame,
	isDaemonSessionBindingFrame,
} from "./daemon-protocol";
import {
	createEmptyPrimeAgentSessionPresentation,
	stablePresentationId,
	upsertArtifact,
} from "./prime-agent-presentation";
import {
	type DaemonQuestionOption,
	type NormalizedDaemonQuestion,
	normalizeDaemonQuestions,
	normalizedQuestionsToClarification,
	normalizedQuestionsToWire,
} from "./question-normalizer";
import {
	browserSafePayload,
	categorizeTool,
	createFleetErrorEnvelope,
	createPayloadPart,
	extractToolBackgroundOutput,
	extractToolErrorText,
	isAssistantMessage,
	isChatToolPart,
	isRecord,
	isUserMessage,
	makeToolType,
	textFromAssistantMessage,
	textFromChatParts,
	toChatMessageFromAssistant,
	toChatMessageFromRuntimeMessage,
	toChatMessageFromUser,
	toChatMessagesFromAgentMessages,
} from "./transcript-hydrator";

export {
	categorizeTool,
	createFleetErrorEnvelope,
	type DaemonQuestionOption,
	type NormalizedDaemonQuestion,
	normalizeDaemonQuestions,
	normalizedQuestionsToClarification,
	normalizedQuestionsToWire,
	toChatMessageFromAssistant,
	toChatMessageFromRuntimeMessage,
	toChatMessageFromUser,
	toChatMessagesFromAgentMessages,
};

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
	currentAssistantMessage: AssistantMessage | undefined;
	currentAssistantImages: ChatImagePart[];
	currentAssistantErrors: ChatErrorPart[];
	reasoningStartedAt: number | undefined;
	reasoningSteps: ChatReasoningStep[];
	reasoningPhase: ChatReasoningPresentation["phase"] | undefined;
	currentToolParts: ChatToolPart[];
	currentToolSentAgentMessages: Record<string, Array<unknown>>;
	/**
	 * Tool name and args from `tool_execution_start`, keyed by `toolCallId`.
	 * The v0.10.1 Rust daemon omits `toolName` on `tool_execution_update`/`_end`
	 * (and `args` on update), so later frames resolve them from here.
	 */
	toolCallStarts: Map<string, ToolCallStart>;
	userMessages: ChatMessage[];
	inRun: boolean;
	presentation: PrimeAgentSessionPresentation;
	activeUserBashId: string | undefined;
	userBashSequence: number;
	rlmChildOverrides: Map<string, RlmChildStatusOverride>;
	rlmChildRuntimeOverrides: Map<string, RlmChildStatusOverride>;
}

export type ToolCallStart = { toolName: string; args: unknown };

/**
 * Protocol-7 top-level frames the v0.10.1 Rust daemon sends outside
 * `session_event` (no `meta`). Types and guards come from the R1 socket
 * client's daemon-protocol.ts.
 */
export type DaemonTopLevelFrame = DaemonSessionBindingFrame | DaemonModelCatalogChangedFrame;

/** Everything the mapper accepts: stock connection events plus Rust-only top-level frames. */
export type MapperInputEvent = AgentConnectionEvent | DaemonTopLevelFrame;

export type RlmChildStatusOverride = {
	status?: PrimeAgentRlmChild["status"];
	lastHeardFrom?: number;
};

/**
 * Creates an event mapper state with optional session, presentation, and RLM child status data.
 *
 * @param init - Initial session configuration and presentation state.
 * @returns A new event mapper state with transient run data reset.
 */
export function createEventMapperState(init?: {
	sessionId?: string;
	presentation?: PrimeAgentSessionPresentation;
	rlmChildOverrides?: ReadonlyMap<string, RlmChildStatusOverride>;
	/**
	 * Transcript (snapshot) messages at attach time. The last assistant message
	 * carries in-flight `toolCall` blocks, which seed the toolCallId cache so a
	 * mid-tool attach (update/end with no start) keeps the real name and args.
	 */
	initialMessages?: readonly unknown[];
}): EventMapperState {
	const state: EventMapperState = {
		runId: "",
		sessionId: init?.sessionId ?? "",
		messageSeq: 0,
		currentMessageId: undefined,
		currentText: "",
		currentAssistantMessage: undefined,
		currentAssistantImages: [],
		currentAssistantErrors: [],
		reasoningStartedAt: undefined,
		reasoningSteps: [],
		reasoningPhase: undefined,
		currentToolParts: [],
		currentToolSentAgentMessages: {},
		toolCallStarts: new Map(),
		userMessages: [],
		inRun: false,
		presentation: init?.presentation ?? createEmptyPrimeAgentSessionPresentation(),
		activeUserBashId: undefined,
		userBashSequence: 0,
		rlmChildOverrides: new Map(init?.rlmChildOverrides),
		rlmChildRuntimeOverrides: new Map(),
	};
	if (init?.initialMessages) seedToolCallStartsFromMessages(state, init.initialMessages);
	return state;
}

/**
 * Seed the toolCallId → {toolName, args} cache from the `toolCall` blocks of
 * the last assistant message in a snapshot transcript (plus an optional
 * in-flight `streamingMessage`). Existing entries win: a live
 * `tool_execution_start` is more authoritative than a snapshot.
 *
 * @returns The number of tool calls seeded.
 */
export function seedToolCallStartsFromMessages(
	state: EventMapperState,
	messages: readonly unknown[] | undefined,
	streamingMessage?: unknown,
): number {
	const candidates = [...(Array.isArray(messages) ? messages : []), ...(streamingMessage ? [streamingMessage] : [])];
	const lastAssistant = [...candidates]
		.reverse()
		.find((message) => isRecord(message) && message.role === "assistant" && Array.isArray(message.content));
	if (!isRecord(lastAssistant) || !Array.isArray(lastAssistant.content)) return 0;
	let seeded = 0;
	for (const block of lastAssistant.content as unknown[]) {
		if (!isRecord(block) || block.type !== "toolCall") continue;
		if (typeof block.id !== "string" || !block.id || typeof block.name !== "string" || !block.name) continue;
		if (state.toolCallStarts.has(block.id)) continue;
		state.toolCallStarts.set(block.id, { toolName: block.name, args: block.arguments });
		seeded++;
	}
	return seeded;
}

function resetRun(state: EventMapperState): void {
	state.runId = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	state.messageSeq = 0;
	state.currentMessageId = undefined;
	state.currentText = "";
	state.currentAssistantMessage = undefined;
	state.currentAssistantImages = [];
	state.currentAssistantErrors = [];
	state.reasoningStartedAt = undefined;
	state.reasoningSteps = [];
	state.reasoningPhase = undefined;
	state.currentToolParts = [];
	state.currentToolSentAgentMessages = {};
	state.toolCallStarts.clear();
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

/**
 * Creates a presentation-safe RLM child record with optional status and activity timestamp overrides.
 *
 * @param child - The RLM child update to sanitize
 * @param override - Optional status and last-heard-from values to apply
 * @returns A sanitized RLM child record with a current timestamp
 */
export function safeRlmChild(
	child: Extract<AgentSessionEvent, { type: "rlm_child_update" }>["child"],
	override?: RlmChildStatusOverride,
): PrimeAgentRlmChild {
	const childLastHeardFrom = (child as { lastHeardFrom?: unknown }).lastHeardFrom;
	const lastHeardFrom =
		override?.lastHeardFrom ?? (typeof childLastHeardFrom === "number" ? childLastHeardFrom : undefined);
	return {
		id: child.id,
		...(child.parentId ? { parentId: child.parentId } : {}),
		...(child.activeSessionId ? { activeSessionId: child.activeSessionId } : {}),
		...(child.sessionName ? { sessionName: child.sessionName } : {}),
		...(child.model ? { model: child.model } : {}),
		label: child.label,
		status: override?.status ?? child.status,
		...(child.durationMs !== undefined ? { durationMs: child.durationMs } : {}),
		...(child.answerPreview ? { answerPreview: child.answerPreview } : {}),
		...(child.toolUseCount !== undefined ? { toolUseCount: child.toolUseCount } : {}),
		...(child.tokenCount !== undefined ? { tokenCount: child.tokenCount } : {}),
		...(child.recap ? { recap: child.recap } : {}),
		...(child.activity ? { activity: child.activity } : {}),
		...(child.repliedSinceTask !== undefined ? { repliedSinceTask: child.repliedSinceTask } : {}),
		...(child.progressNote ? { progressNote: child.progressNote } : {}),
		...(child.activityStaleMs !== undefined ? { activityStaleMs: child.activityStaleMs } : {}),
		...(child.error ? { error: child.error } : {}),
		...(lastHeardFrom !== undefined ? { lastHeardFrom } : {}),
		timestamp: Date.now(),
	};
}

/**
 * Maps an RLM child status to an artifact status.
 *
 * @param status - The RLM child status to convert
 * @returns The corresponding artifact status
 */
function rlmArtifactStatus(status: PrimeAgentRlmChild["status"]): PrimeAgentArtifactStatus {
	if (status === "cancelled") return "cancelled";
	if (status === "error" || status === "failed") return "error";
	if (status === "done") return "success";
	return "running";
}

/**
 * Applies RLM child status overrides and updates related execution-tree and artifact presentation data.
 *
 * @param state - The event mapper state containing RLM presentation data.
 * @param overrides - Status and activity-time overrides keyed by RLM child ID.
 * @returns A presentation update event when the overrides change RLM data, otherwise an empty array.
 */
export function applyRlmChildStatusOverrides(
	state: EventMapperState,
	overrides: ReadonlyMap<string, RlmChildStatusOverride>,
): ChatStreamEvent[] {
	for (const [childId, override] of overrides) state.rlmChildOverrides.set(childId, override);

	let changed = false;
	const rawRlmChildren = state.presentation.rlmChildren.map((child) => {
		const override = state.rlmChildOverrides.get(child.id);
		const runtimeOverride = state.rlmChildRuntimeOverrides.get(child.id);
		const status = override?.status ?? runtimeOverride?.status ?? child.status;
		const lastHeardFrom = override ? override.lastHeardFrom : (runtimeOverride?.lastHeardFrom ?? child.lastHeardFrom);
		if (status === child.status && lastHeardFrom === child.lastHeardFrom) return child;
		changed = true;
		return {
			...child,
			status,
			...(lastHeardFrom !== undefined ? { lastHeardFrom } : {}),
		};
	});
	if (!changed) return [];

	const rlmTree = computeRlmExecutionTree(state.sessionId, rawRlmChildren, state.presentation.rlmTree?.activeNodeId);
	const rlmChildren = rawRlmChildren.map((child) => {
		const treeNode = rlmTree.nodes[child.id];
		return treeNode ? { ...child, depth: treeNode.depth, childrenIds: treeNode.childrenIds } : child;
	});
	const updatedArtifacts = state.presentation.artifactRuns.map((run) => ({
		...run,
		artifacts: run.artifacts.map((artifact) => {
			if (artifact.kind !== "rlm" || !artifact.sourceToolCallId) return artifact;
			const child = rlmChildren.find((entry) => entry.id === artifact.sourceToolCallId);
			if (!child) return artifact;
			return {
				...artifact,
				status: rlmArtifactStatus(child.status),
				output: child,
				timestamp: child.timestamp,
			};
		}),
	}));
	return [
		emitPresentation(state, {
			...state.presentation,
			rlmChildren,
			rlmTree,
			artifactRuns: updatedArtifacts,
		}),
	];
}

/**
 * Creates a presentation-safe goal object from a goal update event.
 *
 * @param goal - The goal data from the session event
 * @returns A sanitized goal object containing available goal metadata and usage statistics
 */
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

function sentAgentMessageId(value: unknown): string | undefined {
	const record = isRecord(value) ? value : undefined;
	return typeof record?.id === "string" ? record.id : undefined;
}

function rememberSentAgentMessage(state: EventMapperState, toolCallId: string, message: unknown): void {
	const safeMessage = browserSafePayload(message);
	if (safeMessage === undefined) return;
	const messages = state.currentToolSentAgentMessages[toolCallId] ?? [];
	const id = sentAgentMessageId(safeMessage);
	if (id && messages.some((entry) => sentAgentMessageId(entry) === id)) return;
	state.currentToolSentAgentMessages[toolCallId] = [...messages, safeMessage];
}

function withSentAgentMessages(state: EventMapperState, toolCallId: string | undefined, value: unknown): unknown {
	if (!toolCallId) return value;
	const sentAgentMessages = state.currentToolSentAgentMessages[toolCallId];
	if (!sentAgentMessages || sentAgentMessages.length === 0) return value;
	const base = isRecord(value) ? value : {};
	const details = isRecord(base.details) ? base.details : {};
	return { ...base, details: { ...details, sentAgentMessages } };
}

function upsertCurrentToolPart(state: EventMapperState, nextPart: ChatToolPart): ChatToolPart {
	const toolCallId = nextPart.toolCallId;
	const enrichedPart: ChatToolPart =
		typeof toolCallId === "string"
			? {
					...nextPart,
					...(nextPart.output !== undefined
						? { output: withSentAgentMessages(state, toolCallId, nextPart.output) }
						: {}),
					...(nextPart.result !== undefined
						? { result: withSentAgentMessages(state, toolCallId, nextPart.result) }
						: {}),
				}
			: nextPart;
	if (typeof toolCallId !== "string" || toolCallId.length === 0) {
		state.currentToolParts.push(enrichedPart);
		return enrichedPart;
	}

	const existingIndex = state.currentToolParts.findIndex((part) => part.toolCallId === toolCallId);
	if (existingIndex < 0) {
		state.currentToolParts.push(enrichedPart);
		return enrichedPart;
	}

	const existing = state.currentToolParts[existingIndex]!;
	const merged: ChatToolPart = {
		...existing,
		...enrichedPart,
		...(existing.input !== undefined ? { input: existing.input } : {}),
	};
	state.currentToolParts[existingIndex] = merged;
	return merged;
}

function appendFinalAssistantText(state: EventMapperState, finalText: string): void {
	if (!finalText || state.currentText.endsWith(finalText)) return;
	if (finalText.startsWith(state.currentText)) {
		state.currentText = finalText;
		return;
	}
	state.currentText += finalText;
}

function rememberAssistantMessage(state: EventMapperState, message: AssistantMessage): ChatMessage {
	state.currentAssistantMessage = message;
	if (!state.currentMessageId) state.currentMessageId = `${state.runId}-a${state.messageSeq++}`;
	const chatMessage = toChatMessageFromAssistant(message, state.currentMessageId);
	appendFinalAssistantText(state, textFromAssistantMessage(message));
	for (const part of chatMessage.parts) {
		if (isChatToolPart(part)) upsertCurrentToolPart(state, part);
	}
	state.currentAssistantImages = chatMessage.parts.filter((part): part is ChatImagePart => part.type === "image");
	state.currentAssistantErrors = chatMessage.parts.filter((part): part is ChatErrorPart => part.type === "error");
	return chatMessage;
}

/**
 * Resolve tool identity for a tool_execution_* frame. v0.9.8 sends `toolName`
 * on every frame; the v0.10.1 Rust daemon only on `tool_execution_start`, so
 * update/end fall back to the start cache, then to the tool part already built
 * from the assistant message's toolCall. Never hands `undefined` to categorizeTool.
 */
function resolveToolIdentity(
	state: EventMapperState,
	toolCallId: string,
	frameToolName: unknown,
): Pick<ChatToolPart, "type" | "category" | "toolName" | "serverName"> {
	const rawName =
		typeof frameToolName === "string" && frameToolName.length > 0
			? frameToolName
			: state.toolCallStarts.get(toolCallId)?.toolName;
	if (rawName !== undefined) {
		const { category, toolName, serverName } = categorizeTool(rawName);
		return { type: makeToolType(rawName), category, toolName, serverName };
	}
	const existing = state.currentToolParts.find((part) => part.toolCallId === toolCallId);
	if (existing) {
		return {
			type: existing.type,
			category: existing.category,
			toolName: existing.toolName,
			serverName: existing.serverName,
		};
	}
	const { category, toolName, serverName } = categorizeTool("unknown_tool");
	return { type: makeToolType("unknown_tool"), category, toolName, serverName };
}

// ---------------------------------------------------------------------------
// Core agent-loop events
/**
 * Maps a core agent event to browser-facing chat stream events.
 *
 * @param state - Mutable event-mapper state for the current session and run
 * @param event - Core agent event to map
 * @returns Chat stream events for the event, or `undefined` when the event is not handled
 */

function mapCoreAgentEvent(state: EventMapperState, event: AgentEvent): ChatStreamEvent[] | undefined {
	switch (event.type) {
		case "agent_start": {
			resetRun(state);
			return [{ type: "state", state: { name: "agent_start" } }, reasoningFrame(state, "waiting", true)];
		}
		case "agent_end": {
			const finalAssistant = [...event.messages].reverse().find(isAssistantMessage);
			if (finalAssistant) rememberAssistantMessage(state, finalAssistant);
			const payloadFrames = event.messages.flatMap((message, index) => {
				const role = (message as { role?: unknown }).role;
				if (role === "assistant" || role === "user" || role === "toolResult") return [];
				const payloadMessage = toChatMessageFromRuntimeMessage(message, `${state.runId}-runtime-${index}`);
				if (!payloadMessage) return [];
				const contentText = textFromChatParts(payloadMessage.parts);
				return payloadMessage.parts
					.filter((part): part is ChatPayloadPart => part.type === "payload")
					.map((part) => ({
						type: "payload" as const,
						part: part.text || !contentText ? part : { ...part, text: contentText },
						...(state.currentMessageId ? { messageId: state.currentMessageId } : {}),
					}));
			});
			const finalMessage = finalizeAssistantMessage(state);
			state.toolCallStarts.clear();
			state.inRun = false;
			return [
				...payloadFrames,
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
			if (isAssistantMessage(event.message)) {
				state.currentAssistantMessage = event.message;
				if (!state.currentMessageId) state.currentMessageId = `${state.runId}-a${state.messageSeq++}`;
			}
			return [];
		}
		case "message_update": {
			if (!isAssistantMessage(event.message)) return [];
			state.currentAssistantMessage = event.message;
			const streamEvent = (event as { assistantMessageEvent?: AssistantMessageEvent }).assistantMessageEvent;
			if (!streamEvent || typeof streamEvent.type !== "string") {
				// v0.10.1 sends whole-message updates with no assistantMessageEvent
				// (provider Done/Error: pa-core run_once.rs:489, pa-daemon turn.rs:761-763;
				// also the scripted engine). There is no delta to read: take the message
				// snapshot like the terminal `done` stream event does. Nothing is emitted;
				// the text reaches the browser via the final `done` message.
				rememberAssistantMessage(state, event.message);
				return [];
			}
			return mapAssistantStreamEvent(state, streamEvent);
		}
		case "message_end": {
			// Some providers expose their final assistant content only on the
			// authoritative message_end lifecycle event. Keep visible assistant
			// metadata and tool calls while detailed reasoning remains excluded.
			// The terminal text must also preserve earlier messages in this run:
			// append rather than replace, skipping the delta-equivalent suffix.
			if (isAssistantMessage(event.message)) {
				const message = rememberAssistantMessage(state, event.message);
				if (message.parts.some((part) => part.type === "image" || part.type === "error")) {
					return [{ type: "message", message }];
				}
			}
			return [];
		}
		case "tool_execution_start": {
			const startToolName = typeof event.toolName === "string" ? event.toolName : undefined;
			if (startToolName) state.toolCallStarts.set(event.toolCallId, { toolName: startToolName, args: event.args });
			const identity = resolveToolIdentity(state, event.toolCallId, startToolName);
			const part = upsertCurrentToolPart(state, {
				...identity,
				toolCallId: event.toolCallId,
				state: "input-streaming",
				input: event.args,
			});
			return [reasoningFrame(state, "executing", true), { type: "tool", part, messageId: state.currentMessageId }];
		}
		case "tool_execution_update": {
			const frame = event as { toolName?: unknown; args?: unknown };
			const identity = resolveToolIdentity(state, event.toolCallId, frame.toolName);
			const input = frame.args !== undefined ? frame.args : state.toolCallStarts.get(event.toolCallId)?.args;
			const backgroundOutput = extractToolBackgroundOutput(event.partialResult);
			const part = upsertCurrentToolPart(state, {
				...identity,
				toolCallId: event.toolCallId,
				state: "input-streaming",
				input,
				result: event.partialResult,
				...(backgroundOutput !== undefined ? { backgroundOutput } : {}),
			});
			return [{ type: "tool", part, messageId: state.currentMessageId }];
		}
		case "tool_execution_end": {
			const identity = resolveToolIdentity(state, event.toolCallId, (event as { toolName?: unknown }).toolName);
			// Mid-tool attach: no start frame, so args come from the snapshot-seeded cache.
			const cachedInput = state.toolCallStarts.get(event.toolCallId)?.args;
			state.toolCallStarts.delete(event.toolCallId);
			const errorText = event.isError ? extractToolErrorText(event.result) : undefined;
			const errorEnvelope = errorText ? createFleetErrorEnvelope(errorText) : undefined;
			const durationMs =
				typeof (event.result as { durationMs?: number })?.durationMs === "number"
					? (event.result as { durationMs: number }).durationMs
					: typeof (event.result as { details?: { durationMs?: number } })?.details?.durationMs === "number"
						? (event.result as { details: { durationMs: number } }).details.durationMs
						: undefined;
			const backgroundOutput = extractToolBackgroundOutput(event.result);

			const part = upsertCurrentToolPart(state, {
				...identity,
				toolCallId: event.toolCallId,
				state: event.isError ? "output-error" : "output-available",
				...(cachedInput !== undefined ? { input: cachedInput } : {}),
				output: event.result,
				result: event.result,
				...(durationMs !== undefined ? { durationMs } : {}),
				...(backgroundOutput !== undefined ? { backgroundOutput } : {}),
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
			rememberAssistantMessage(state, event.message);
			return [];
		}
		default:
			return [];
	}
}

// ---------------------------------------------------------------------------
// Session-specific events (AgentSessionEvent extends AgentEvent)
/**
 * Maps a session-specific agent event to browser-facing stream events and presentation updates.
 *
 * @param state - Mutable mapper state for the current session and run
 * @param event - Session event to map
 * @returns Stream events representing the session event
 */

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
			rememberSentAgentMessage(state, event.toolCallId, event.message);
			{
				const existing = state.currentToolParts.find((part) => part.toolCallId === event.toolCallId);
				const result = withSentAgentMessages(state, event.toolCallId, existing?.result ?? existing?.output);
				const part = upsertCurrentToolPart(state, {
					type: "tool-IPython",
					category: "kernel",
					toolName: "ipython",
					toolCallId: event.toolCallId,
					state: existing?.state ?? "input-streaming",
					...(result !== undefined ? { output: result, result } : {}),
				});
				return [
					{ type: "tool", part, ...(state.currentMessageId ? { messageId: state.currentMessageId } : {}) },
					{
						type: "state",
						state: { name: "agent_start", message: "Subagent message received" },
					},
				];
			}
		case "session_info_changed":
			return [emitPresentation(state, { ...state.presentation, sessionName: event.name })];
		case "thinking_level_changed":
			return [emitPresentation(state, { ...state.presentation, thinkingLevel: event.level })];
		case "service_tier_changed":
			return [emitPresentation(state, { ...state.presentation, serviceTier: event.serviceTier })];
		case "rlm_child_update": {
			const runtimeChild = safeRlmChild(event.child);
			state.rlmChildRuntimeOverrides.set(event.child.id, {
				status: runtimeChild.status,
				...(runtimeChild.lastHeardFrom !== undefined ? { lastHeardFrom: runtimeChild.lastHeardFrom } : {}),
			});
			const child = safeRlmChild(event.child, state.rlmChildOverrides.get(event.child.id));
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
				status: rlmArtifactStatus(child.status),
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
			// Events without a browser projection (for example `rlm_progress_note`,
			// which the parent already folds into `rlm_child_update.child.progressNote`)
			// and future prime-agent events are ignored silently.
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
	parts.push(...state.currentAssistantErrors);
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
 * Maps a connection event to browser-facing chat stream frames.
 *
 * Session replacement and resynchronization reset run state and emit settlement
 * frames. Extension requests, errors, and side questions are converted to
 * corresponding client-facing frames; bookkeeping events produce no frames.
 *
 * @param state - Session-local mapper state to update
 * @param event - Connection event to map
 * @returns The chat stream frames produced for the event
 */
export function mapAgentConnectionEvent(state: EventMapperState, event: MapperInputEvent): ChatStreamEvent[] {
	if (isDaemonTopLevelFrame(event)) return mapDaemonTopLevelFrame(state, event);
	switch (event.type) {
		case "session_event":
			return mapAgentSessionEvent(state, event.event);
		case "session_replaced": {
			resetRun(state);
			seedToolCallStartsFromMessages(state, event.messages);
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
			// A resync (reconnect, or the bridge's reload after a sequence gap) may
			// land mid-tool: re-seed tool identity from the snapshot transcript.
			seedToolCallStartsFromMessages(state, event.snapshot.messages, event.snapshot.streamingMessage);
			const events: ChatStreamEvent[] = [];
			if (event.snapshot.parent || event.snapshot.children) {
				const rawRlmChildren = (event.snapshot.children ?? []).map((child) => {
					const runtimeChild = safeRlmChild(child);
					state.rlmChildRuntimeOverrides.set(child.id, {
						status: runtimeChild.status,
						...(runtimeChild.lastHeardFrom !== undefined ? { lastHeardFrom: runtimeChild.lastHeardFrom } : {}),
					});
					return safeRlmChild(child, state.rlmChildOverrides.get(child.id));
				});
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
			// `session_closed{reason:"killed"}` (a client's plain kill; shutdown and
			// replaced have their own reasons, pa-daemon worker/env.rs:22-36) reaches
			// here from the stock adapter as `closed` with an error, on v0.9.8 and
			// v0.10.1 alike, so it maps to an error frame. Kept for parity: the
			// ChatStreamEvent contract is frozen.
			// TODO(post-cutover follow-up): no UI when Fleet itself sent the kill; a
			// neutral "session stopped" notice otherwise (separate contract decision).
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
		case "connection_status":
		case "heartbeats_changed":
			return [];
		case "side_question_event": {
			const text = [
				`Question: ${event.event.question}`,
				event.event.answer ? `Answer: ${event.event.answer}` : `Status: ${event.event.status}`,
			].join("\n\n");
			return [
				{
					type: "payload",
					part: createPayloadPart("sideQuestion", "Side question", event.event, text, event.event.id),
					...(state.currentMessageId ? { messageId: state.currentMessageId } : {}),
				},
			];
		}
		case "session_status":
			return event.recap ? [emitPresentation(state, { ...state.presentation, recap: event.recap })] : [];
		default: {
			// Future-proof: ignore unknown connection events silently.
			return [];
		}
	}
}

function isDaemonTopLevelFrame(event: MapperInputEvent): event is DaemonTopLevelFrame {
	return isDaemonSessionBindingFrame(event) || isDaemonModelCatalogChangedFrame(event);
}

/**
 * Rust-only top-level frames. Neither has a fitting ChatStreamEvent variant,
 * and adding one is a contract change that needs its own decision, so both
 * are consumed without emitting anything.
 */
function mapDaemonTopLevelFrame(state: EventMapperState, frame: DaemonTopLevelFrame): ChatStreamEvent[] {
	switch (frame.type) {
		case "session_binding":
			// The daemon re-bound the persisted session to a new runtime
			// (`activeSessionId`); in-flight tool calls of the old runtime are gone.
			// TODO(R1): the bridge/socket client must re-target routing at
			// `frame.activeSessionId`; decide separately whether the browser needs a
			// ChatStreamEvent for it (contract change). `state.sessionId` is Fleet's
			// id and is intentionally left unchanged here.
			state.toolCallStarts.clear();
			return [];
		case "model_catalog_changed":
			// TODO(R1): the bridge should re-fetch `get_model_catalog` and refresh
			// its models cache; there is no ChatStreamEvent for model catalog updates.
			return [];
		default:
			return [];
	}
}

/**
 * Surface a daemon `meta.sequence` gap through the existing resync path: the
 * caller fetches a fresh snapshot (`connection.getInitialSnapshot()`) and this
 * maps it as `session_resynced`, which resets the run, re-seeds tool identity
 * and emits `done` with `sessionReset: true` so the browser reloads the
 * transcript. No new ChatStreamEvent variant.
 *
 * TODO(R1 bridge): call this from prime-bridge.ts when daemon-runtime reports
 * a gap (see daemon-sequence-gap.ts); not wired yet.
 */
export function resyncAfterSequenceGap(
	state: EventMapperState,
	snapshot: Extract<AgentConnectionEvent, { type: "session_resynced" }>["snapshot"],
): ChatStreamEvent[] {
	return mapAgentConnectionEvent(state, { type: "session_resynced", snapshot });
}

export function mapAgentConnectionEvents(
	state: EventMapperState,
	events: readonly MapperInputEvent[],
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
