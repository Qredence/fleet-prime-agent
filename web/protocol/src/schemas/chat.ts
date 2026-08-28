import { ChatAttachmentSchema, MAX_TURN_ATTACHMENT_BYTES, ProjectIdSchema, SessionIdSchema } from "../fleet-contract";
import { ChatModeSchema, ChatPlanActionSchema, ChatThinkingLevelSchema, z } from "./shared";

export const ChatModelSelectionSchema = z
	.object({
		provider: z.string(),
		id: z.string(),
		thinkingLevel: ChatThinkingLevelSchema.optional(),
	})
	.openapi({ description: "Selected model" });

export const ChatSessionMetadataSchema = z
	.object({
		sessionId: SessionIdSchema.optional().openapi({ description: "Session ID" }),
		projectId: ProjectIdSchema.nullable().optional().openapi({ description: "Opaque project ID" }),
	})
	.openapi({ description: "Chat session metadata" });

export const ChatRequestSchema = z
	.object({
		sessionId: SessionIdSchema.optional(),
		message: z.string().optional().openapi({ description: "User message" }),
		model: ChatModelSelectionSchema.optional(),
		mode: ChatModeSchema.optional(),
		openUI: z.boolean().optional(),
		openUIArtifact: z.boolean().optional(),
		attachments: z.array(ChatAttachmentSchema).max(16).optional(),
		planAction: ChatPlanActionSchema.optional(),
		streamingBehavior: z.enum(["steer", "followUp"]).optional().openapi({ description: "Streaming behavior" }),
		userId: z.string().optional().openapi({ description: "Authenticated user ID (server-injected)" }),
		userEmail: z.string().optional().openapi({ description: "Authenticated user email (server-injected)" }),
	})
	.superRefine((request, context) => {
		const uploadBytes = (request.attachments ?? []).reduce(
			(total, attachment) => total + (attachment.kind === "upload" ? attachment.size : 0),
			0,
		);
		if (uploadBytes > MAX_TURN_ATTACHMENT_BYTES) {
			context.addIssue({
				code: "custom",
				path: ["attachments"],
				message: "Attachments exceed the 100 MiB per-turn limit",
			});
		}
	})
	.openapi({ description: "Chat request body" });

export const ChatNewRequestSchema = z
	.object({
		projectId: ProjectIdSchema.optional(),
		thinkingLevel: ChatThinkingLevelSchema.optional(),
		mode: ChatModeSchema.optional(),
		model: ChatModelSelectionSchema.optional(),
	})
	.openapi({ description: "Create a project-scoped chat session" });

export const ChatClarificationQuestionSchema = z
	.object({
		id: z.string().optional(),
		question: z.string(),
		options: z.array(z.string()).optional(),
		isMultiSelect: z.boolean().optional(),
		defaultOption: z.string().optional(),
		allowWriteIn: z.boolean().optional(),
	})
	.openapi({ description: "Interactive clarification question" });

export const ChatQuestionAnswerSchema = z
	.object({
		kind: z.enum(["single", "multi", "text", "skip", "questions"]),
		questionId: z.string().optional(),
		selectedIds: z.array(z.string()).optional(),
		text: z.string().optional(),
		answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
	})
	.openapi({ description: "Question answer" });

export const ChatPendingDialogSchema = z
	.object({
		sessionId: SessionIdSchema,
		toolCallId: z.string(),
		kind: z.enum(["confirm", "select", "input", "questions"]),
		title: z.string(),
		message: z.string().optional(),
		options: z.array(z.string()).optional(),
		questions: z.array(ChatClarificationQuestionSchema).optional(),
		placeholder: z.string().optional(),
		createdAt: z.number(),
		timeoutMs: z.number().optional(),
	})
	.openapi({ description: "Pending interactive dialog" });

export const ChatPendingDialogsResponseSchema = z
	.object({
		dialogs: z.array(ChatPendingDialogSchema),
	})
	.openapi({ description: "List of pending dialogs for a session" });

export const ChatQuestionAnswerRequestSchema = z
	.object({
		sessionId: SessionIdSchema.optional(),
		toolCallId: z.string().optional(),
		answer: ChatQuestionAnswerSchema,
	})
	.openapi({ description: "Question answer request body" });

export const ChatQuestionAnswerResponseSchema = z
	.object({
		ok: z.boolean(),
		message: z.string().optional(),
		mode: ChatModeSchema.optional(),
		planAction: ChatPlanActionSchema.optional(),
	})
	.openapi({ description: "Question answer response" });

export const ChatPlanTodoSchema = z
	.object({
		step: z.number(),
		text: z.string(),
		completed: z.boolean(),
	})
	.openapi({ description: "Structured plan todo" });

export const ChatPlanStateSchema = z
	.object({
		mode: ChatModeSchema,
		executing: z.boolean(),
		pendingDecision: z.boolean(),
		completed: z.number(),
		total: z.number(),
		todos: z.array(ChatPlanTodoSchema),
		message: z.string().optional(),
	})
	.openapi({ description: "Structured plan state" });

export const ChatPlanPresentationSchema = z
	.object({
		assistantMessageId: z.string().min(1),
		clientMessageId: z.string().min(1).optional(),
		state: ChatPlanStateSchema,
	})
	.openapi({ description: "Durable Fleet Plan presentation" });

export const ChatPlanPresentationUpsertRequestSchema = z
	.object({
		sessionId: SessionIdSchema,
		presentation: ChatPlanPresentationSchema,
	})
	.openapi({ description: "Upsert a durable Fleet Plan presentation" });

export const ChatTextPartSchema = z
	.object({
		type: z.literal("text"),
		text: z.string(),
	})
	.openapi({ description: "Text message part" });

export const ChatErrorPartSchema = z
	.object({
		type: z.literal("error"),
		title: z.string().optional(),
		message: z.string(),
	})
	.openapi({ description: "Error message part" });

export const ChatImagePartSchema = z
	.object({
		type: z.literal("image"),
		url: z.string().min(1),
		mimeType: z.string().optional(),
		alt: z.string().optional(),
	})
	.openapi({ description: "Image message part" });

export const ChatPayloadPartSchema = z
	.object({
		type: z.literal("payload"),
		id: z.string().min(1).optional(),
		kind: z.string().min(1),
		title: z.string().min(1),
		text: z.string().optional(),
		payload: z.unknown().optional(),
	})
	.passthrough()
	.openapi({ description: "Browser-visible Prime Agent runtime payload" });

export const FleetErrorCodeSchema = z
	.enum([
		"AUTH_CREDENTIAL_EXPIRED",
		"AUTH_MISSING",
		"KERNEL_CRASH",
		"KERNEL_TIMEOUT",
		"CONTEXT_OVERFLOW",
		"BUDGET_EXCEEDED",
		"TOOL_TIMEOUT",
		"RATE_LIMIT",
		"NETWORK_DISCONNECTED",
		"EXTENSION_ERROR",
		"SESSION_ABORTED",
		"UNKNOWN_ERROR",
	])
	.openapi({ description: "Machine-readable Fleet error code" });

export const FleetErrorRemediationActionSchema = z
	.enum(["open_settings_tab", "restart_kernel", "retry_turn", "compact_context", "expand_budget", "reconnect"])
	.openapi({ description: "Remediation action trigger" });

export const FleetErrorRemediationSchema = z
	.object({
		action: FleetErrorRemediationActionSchema,
		target: z.string().optional(),
		label: z.string(),
	})
	.openapi({ description: "Structured error remediation hint" });

export const FleetErrorEnvelopeSchema = z
	.object({
		code: FleetErrorCodeSchema,
		message: z.string(),
		provider: z.string().optional(),
		isTerminal: z.boolean().optional(),
		remediation: FleetErrorRemediationSchema.optional(),
	})
	.openapi({ description: "Standardized Fleet error envelope" });

export const ChatErrorEnvelopeSchema = FleetErrorEnvelopeSchema;

export const ChatToolCategorySchema = z
	.enum(["kernel", "system", "mcp", "rlm", "plan", "question", "custom"])
	.openapi({ description: "Normalized tool category" });

export const ChatToolPartSchema = z
	.object({
		type: z.string(),
		category: ChatToolCategorySchema.optional(),
		toolName: z.string().optional(),
		serverName: z.string().optional(),
		toolCallId: z.string().optional(),
		state: z.string().optional(),
		input: z.unknown().optional(),
		output: z.unknown().optional(),
		result: z.unknown().optional(),
		durationMs: z.number().optional(),
		error: FleetErrorEnvelopeSchema.optional(),
	})
	.passthrough()
	.openapi({ description: "Tool message part" });

export const ChatMessagePartSchema = z
	.union([ChatTextPartSchema, ChatErrorPartSchema, ChatImagePartSchema, ChatPayloadPartSchema, ChatToolPartSchema])
	.openapi({ description: "Message part" });

export const ChatMessageSchema = z
	.object({
		id: z.string(),
		role: z.enum(["user", "assistant"]),
		parts: z.array(ChatMessagePartSchema),
		createdAt: z.union([z.date(), z.string(), z.number()]).optional(),
		experimental_attachments: z
			.array(
				z.object({
					contentType: z.string().optional(),
					url: z.string().optional(),
				}),
			)
			.optional(),
	})
	.passthrough()
	.openapi({ description: "Chat message" });

export const FleetAdapterFeatureSchema = z.enum(["reasoning-summary-v1"]);

export const FleetAdapterCapabilitiesSchema = z
	.object({
		protocolVersion: z.number().int().positive(),
		schemaRevision: z.number().int().positive(),
		features: z.array(z.string()),
	})
	.openapi({ description: "Optional Fleet adapter capabilities" });

export const ChatReasoningStepSchema = z
	.object({
		id: z.string(),
		title: z.string(),
		body: z.string(),
	})
	.openapi({ description: "Safe Fleet reasoning progress step" });

export const ChatReasoningPresentationSchema = z
	.object({
		runId: z.string(),
		phase: z.enum(["waiting", "context", "planning", "executing", "responding", "recovering", "complete", "error"]),
		steps: z.array(ChatReasoningStepSchema),
		visibleSteps: z.number().int().nonnegative(),
		streaming: z.boolean(),
		startedAt: z.number(),
		elapsedMs: z.number().nonnegative().optional(),
		restingLabel: z.string(),
	})
	.openapi({ description: "Browser-safe Fleet reasoning presentation" });

export const ChatStateEventSchema = z
	.object({
		name: z.enum([
			"agent_start",
			"agent_end",
			"agent_settled",
			"turn_start",
			"turn_end",
			"message_start",
			"message_end",
		]),
		message: z.string().optional(),
	})
	.openapi({ description: "Chat state event" });

export const ChatStartEventSchema = z
	.object({
		type: z.literal("start"),
		id: z.string(),
		runId: z.string(),
		sessionId: SessionIdSchema,
		requestKind: z.literal("session-command").optional(),
		sessionReset: z.boolean().optional(),
		diagnostics: z.array(z.string()).optional(),
		adapterCapabilities: FleetAdapterCapabilitiesSchema.optional(),
	})
	.openapi({ description: "Stream start event" });

export const ChatDeltaEventSchema = z
	.object({
		type: z.literal("delta"),
		text: z.string(),
		messageId: z.string().optional(),
	})
	.openapi({ description: "Stream delta event" });

export const ChatToolEventSchema = z
	.object({
		type: z.literal("tool"),
		part: ChatToolPartSchema,
		messageId: z.string().optional(),
	})
	.openapi({ description: "Stream tool event" });

export const ChatPlanEventSchema = z
	.object({
		type: z.literal("plan"),
		mode: ChatModeSchema,
		executing: z.boolean(),
		completed: z.number(),
		total: z.number(),
		message: z.string().optional(),
		state: ChatPlanStateSchema,
	})
	.openapi({ description: "Stream plan event" });

export const ChatStateStreamEventSchema = z
	.object({
		type: z.literal("state"),
		state: ChatStateEventSchema,
	})
	.openapi({ description: "Stream state event" });

export const ChatQueueEventSchema = z
	.object({
		type: z.literal("queue"),
		steering: z.array(z.string()),
		followUp: z.array(z.string()),
	})
	.openapi({ description: "Stream queue event" });

export const ChatThinkingEventSchema = z
	.object({
		type: z.literal("thinking"),
		phase: z.enum(["start", "delta", "end"]).optional(),
		text: z.string(),
		messageId: z.string().optional(),
	})
	.openapi({ description: "Live provider thinking event; never persisted" });

const PrimeAgentArtifactStatusSchema = z.enum(["running", "success", "error", "cancelled"]);
const PrimeAgentArtifactKindSchema = z.enum([
	"bash",
	"ipython",
	"mcp",
	"generic",
	"diff",
	"rlm",
	"recap",
	"refinement",
	"compaction",
	"openui-html",
]);

export const PrimeAgentArtifactSchema = z
	.object({
		id: z.string().min(1),
		runId: z.string().min(1),
		sourceMessageId: z.string().optional(),
		sourceToolCallId: z.string().optional(),
		kind: PrimeAgentArtifactKindSchema,
		title: z.string(),
		status: PrimeAgentArtifactStatusSchema,
		input: z.unknown().optional(),
		output: z.unknown().optional(),
		timestamp: z.number().finite(),
	})
	.openapi({ description: "Browser-safe Prime Agent technical artifact" });

export const PrimeAgentArtifactRunSchema = z
	.object({
		id: z.string().min(1),
		runId: z.string().min(1),
		artifacts: z.array(PrimeAgentArtifactSchema),
		startedAt: z.number().finite().optional(),
		endedAt: z.number().finite().optional(),
	})
	.openapi({ description: "Grouped Prime Agent technical artifacts" });

export const PrimeAgentUserBashSchema = z
	.object({
		id: z.string().min(1),
		runId: z.string().min(1),
		command: z.string(),
		output: z.string(),
		status: PrimeAgentArtifactStatusSchema,
		exitCode: z.number().int().optional(),
		cancelled: z.boolean(),
		truncated: z.boolean(),
		excludeFromContext: z.boolean(),
		errorMessage: z.string().optional(),
		startedAt: z.number().finite(),
		endedAt: z.number().finite().optional(),
	})
	.openapi({ description: "Normalized user Bash execution" });

export const PrimeAgentRlmChildSchema = z
	.object({
		id: z.string().min(1),
		parentId: z.string().optional(),
		activeSessionId: z.string().optional(),
		sessionName: z.string().optional(),
		model: z.string().optional(),
		label: z.string(),
		status: z.enum(["queued", "running", "done", "error", "cancelled"]),
		durationMs: z.number().finite().optional(),
		answerPreview: z.string().optional(),
		toolUseCount: z.number().int().nonnegative().optional(),
		tokenCount: z.number().int().nonnegative().optional(),
		recap: z.string().optional(),
		activity: z
			.object({ kind: z.enum(["waiting", "writing", "executing"]), toolName: z.string().optional() })
			.optional(),
		repliedSinceTask: z.boolean().optional(),
		error: z.string().optional(),
		depth: z.number().int().positive().optional(),
		childrenIds: z.array(z.string()).optional(),
		timestamp: z.number().finite(),
	})
	.openapi({ description: "Browser-safe RLM child status" });

export const PrimeAgentRlmNodeSchema = PrimeAgentRlmChildSchema.extend({
	depth: z.number().int().positive(),
	childrenIds: z.array(z.string()),
}).openapi({ description: "Hierarchical RLM execution tree node" });

export const PrimeAgentRlmTreeSchema = z
	.object({
		rootSessionId: z.string().min(1),
		nodes: z.record(z.string(), PrimeAgentRlmNodeSchema),
		rootChildrenIds: z.array(z.string()),
		activeNodeId: z.string().optional(),
	})
	.openapi({ description: "Hierarchical RLM execution tree" });

export const PrimeAgentParentSessionSchema = z
	.object({
		activeSessionId: z.string().optional(),
		sessionId: z.string().optional(),
		nodeId: z.string().optional(),
		childId: z.string().optional(),
	})
	.openapi({ description: "Parent session metadata for subagent branches" });

export const PrimeAgentGoalSchema = z
	.object({
		active: z.boolean(),
		status: z.enum(["idle", "active", "paused", "budget_limited", "complete", "error"]),
		goalId: z.string().optional(),
		objective: z.string().optional(),
		tokenBudget: z.number().int().positive().optional(),
		tokensUsed: z.number().int().nonnegative(),
		timeUsedSeconds: z.number().nonnegative(),
		continuationsUsed: z.number().int().nonnegative(),
		createdAt: z.number().finite().optional(),
		updatedAt: z.number().finite().optional(),
		lastReason: z.string().optional(),
		lastError: z.string().optional(),
	})
	.openapi({ description: "Browser-safe Prime Agent goal state" });

export const PrimeAgentRefinementEditSchema = z.object({
	action: z.enum(["create", "update", "delete"]),
	kind: z.string(),
	id: z.string(),
	title: z.string().optional(),
	content: z.string().optional(),
	reason: z.string().optional(),
	before: z.string().optional(),
	after: z.string().optional(),
	applied: z.boolean(),
	error: z.string().optional(),
});

export const PrimeAgentRefinementSchema = z
	.object({
		id: z.string().min(1),
		summary: z.string(),
		rationale: z.string(),
		expectedOutcome: z.string(),
		scope: z.enum(["local", "global"]).optional(),
		rollbackOf: z.string().optional(),
		edits: z.array(PrimeAgentRefinementEditSchema),
		status: z.enum(["success", "error"]),
		error: z.string().optional(),
		timestamp: z.number().finite(),
	})
	.openapi({ description: "Browser-safe refinement result" });

export const PrimeAgentSessionPresentationSchema = z
	.object({
		revision: z.number().int().nonnegative(),
		sessionName: z.string().optional(),
		thinkingLevel: ChatThinkingLevelSchema.optional(),
		serviceTier: z.enum(["auto", "default", "flex", "scale", "priority"]).nullable().optional(),
		goal: PrimeAgentGoalSchema.optional(),
		recap: z.string().optional(),
		parent: PrimeAgentParentSessionSchema.optional(),
		rlmTree: PrimeAgentRlmTreeSchema.optional(),
		userBash: z.array(PrimeAgentUserBashSchema),
		rlmChildren: z.array(PrimeAgentRlmChildSchema),
		refinements: z.array(PrimeAgentRefinementSchema),
		artifactRuns: z.array(PrimeAgentArtifactRunSchema),
	})
	.openapi({ description: "Durable browser-visible Prime Agent presentation state" });

export const ChatOpenUIArtifactPayloadSchema = z
	.object({
		title: z.string().min(1),
		document: z.string().min(1),
	})
	.openapi({ description: "Validated OpenUI HTML artifact payload" });

export const ChatOpenUIArtifactUpsertRequestSchema = z
	.object({
		sessionId: SessionIdSchema,
		assistantMessageId: z.string().min(1),
		artifactIndex: z.number().int().nonnegative(),
		artifact: ChatOpenUIArtifactPayloadSchema,
	})
	.openapi({ description: "Upsert a durable OpenUI HTML artifact" });

export const ChatOpenUIArtifactUpsertResponseSchema = z
	.object({
		artifact: PrimeAgentArtifactSchema,
		presentation: PrimeAgentSessionPresentationSchema,
	})
	.openapi({ description: "Durable OpenUI HTML artifact and presentation" });

export const ChatPresentationEventSchema = z
	.object({
		type: z.literal("presentation"),
		sessionId: SessionIdSchema,
		presentation: PrimeAgentSessionPresentationSchema,
	})
	.openapi({ description: "Immutable Prime Agent presentation snapshot" });

export const ChatRlmStreamEventSchema = z
	.object({
		type: z.literal("rlm"),
		child: PrimeAgentRlmChildSchema,
		tree: PrimeAgentRlmTreeSchema.optional(),
	})
	.openapi({ description: "Discrete RLM execution event" });

export const ChatMessageEventSchema = z
	.object({
		type: z.literal("message"),
		message: ChatMessageSchema,
	})
	.openapi({ description: "Browser-visible user or image-bearing message" });

export const ChatPayloadEventSchema = z
	.object({
		type: z.literal("payload"),
		part: ChatPayloadPartSchema,
		messageId: z.string().optional(),
	})
	.openapi({ description: "Discrete Prime Agent runtime payload" });

export const ChatReasoningEventSchema = z
	.object({
		type: z.literal("reasoning"),
		presentation: ChatReasoningPresentationSchema,
		messageId: z.string().optional(),
	})
	.openapi({ description: "Safe reasoning-summary event" });

export const ChatCompactionStartEventSchema = z
	.object({
		type: z.literal("compaction"),
		phase: z.literal("start"),
		reason: z.string(),
	})
	.openapi({ description: "Compaction start event" });

export const ChatCompactionEndEventSchema = z
	.object({
		type: z.literal("compaction"),
		phase: z.literal("end"),
		reason: z.string(),
		aborted: z.boolean(),
		willRetry: z.boolean(),
		summary: z.string().optional(),
		tokensBefore: z.number().optional(),
		firstKeptEntryId: z.string().optional(),
		errorMessage: z.string().optional(),
		error: FleetErrorEnvelopeSchema.optional(),
	})
	.openapi({ description: "Compaction end event" });

export const ChatRetryStartEventSchema = z
	.object({
		type: z.literal("retry"),
		phase: z.literal("start"),
		attempt: z.number(),
		maxAttempts: z.number(),
		delayMs: z.number(),
		errorMessage: z.string().optional(),
		error: FleetErrorEnvelopeSchema.optional(),
	})
	.openapi({ description: "Retry start event" });

export const ChatRetryEndEventSchema = z
	.object({
		type: z.literal("retry"),
		phase: z.literal("end"),
		success: z.boolean(),
		attempt: z.number(),
		finalError: z.string().optional(),
		error: FleetErrorEnvelopeSchema.optional(),
	})
	.openapi({ description: "Retry end event" });

export const ChatDoneEventSchema = z
	.object({
		type: z.literal("done"),
		runId: z.string(),
		message: ChatMessageSchema,
		sessionId: SessionIdSchema,
		requestKind: z.literal("session-command").optional(),
		sessionReset: z.boolean().optional(),
		presentation: PrimeAgentSessionPresentationSchema.optional(),
	})
	.openapi({ description: "Stream done event" });

export const ChatErrorEventSchema = z
	.object({
		type: z.literal("error"),
		message: z.string(),
		runId: z.string().optional(),
		code: FleetErrorCodeSchema.optional(),
		error: FleetErrorEnvelopeSchema.optional(),
	})
	.openapi({ description: "Stream error event" });

export const ChatStreamEventSchema = z
	.union([
		ChatStartEventSchema,
		ChatDeltaEventSchema,
		ChatToolEventSchema,
		ChatRlmStreamEventSchema,
		ChatPlanEventSchema,
		ChatStateStreamEventSchema,
		ChatQueueEventSchema,
		ChatThinkingEventSchema,
		ChatPresentationEventSchema,
		ChatMessageEventSchema,
		ChatPayloadEventSchema,
		ChatReasoningEventSchema,
		ChatCompactionStartEventSchema,
		ChatCompactionEndEventSchema,
		ChatRetryStartEventSchema,
		ChatRetryEndEventSchema,
		ChatDoneEventSchema,
		ChatErrorEventSchema,
	])
	.openapi({ description: "Chat stream event (NDJSON line)" });

export const ChatSessionResponseSchema = z
	.object({
		session: ChatSessionMetadataSchema,
		messages: z.array(ChatMessageSchema),
		planPresentations: z.array(ChatPlanPresentationSchema).default([]),
		presentation: PrimeAgentSessionPresentationSchema.default({
			revision: 0,
			userBash: [],
			rlmChildren: [],
			refinements: [],
			artifactRuns: [],
		}),
		sessionReset: z.boolean().optional(),
	})
	.openapi({ description: "Chat session response" });

export const ChatSessionInfoSchema = z
	.object({
		sessionId: SessionIdSchema,
		projectId: ProjectIdSchema.nullable().optional(),
		title: z.string(),
		createdAt: z.string(),
		updatedAt: z.string(),
		status: z.enum(["idle", "running", "interrupted", "failed"]),
		messageCount: z.number(),
		firstMessage: z.string(),
	})
	.openapi({ description: "Chat session info" });

export const ChatSessionsResponseSchema = z
	.object({
		sessions: z.array(ChatSessionInfoSchema),
	})
	.openapi({ description: "Chat sessions list response" });
