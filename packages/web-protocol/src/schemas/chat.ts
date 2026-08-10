import { ChatModeSchema, ChatPlanActionSchema, ChatThinkingLevelSchema, z } from "./shared";

export const ChatModelSelectionSchema = z
	.union([
		z.string().openapi({ description: "Model key string" }),
		z
			.object({
				provider: z.string(),
				id: z.string(),
				thinkingLevel: ChatThinkingLevelSchema.optional(),
			})
			.openapi({ description: "Model selection object" }),
	])
	.openapi({ description: "Selected model" });

export const ChatSessionMetadataSchema = z
	.object({
		sessionFile: z.string().optional().openapi({ description: "Session file path" }),
		sessionId: z.string().optional().openapi({ description: "Session ID" }),
	})
	.openapi({ description: "Chat session metadata" });

export const ChatRequestSchema = z
	.object({
		sessionFile: z.string().optional(),
		sessionId: z.string().optional(),
		message: z.string().optional().openapi({ description: "User message" }),
		model: ChatModelSelectionSchema.optional(),
		mode: ChatModeSchema.optional(),
		planAction: ChatPlanActionSchema.optional(),
		streamingBehavior: z.enum(["steer", "followUp"]).optional().openapi({ description: "Streaming behavior" }),
		userId: z.string().optional().openapi({ description: "Authenticated user ID (server-injected)" }),
		userEmail: z.string().optional().openapi({ description: "Authenticated user email (server-injected)" }),
	})
	.openapi({ description: "Chat request body" });

export const ChatQuestionAnswerSchema = z
	.object({
		kind: z.enum(["single", "multi", "text", "skip"]),
		questionId: z.string().optional(),
		selectedIds: z.array(z.string()).optional(),
		text: z.string().optional(),
	})
	.openapi({ description: "Question answer" });

export const ChatQuestionAnswerRequestSchema = z
	.object({
		sessionFile: z.string().optional(),
		sessionId: z.string().optional(),
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

export const ChatToolPartSchema = z
	.object({
		type: z.string(),
		toolCallId: z.string().optional(),
		state: z.string().optional(),
		input: z.unknown().optional(),
		output: z.unknown().optional(),
		result: z.unknown().optional(),
	})
	.passthrough()
	.openapi({ description: "Tool message part" });

export const ChatMessagePartSchema = z
	.union([ChatTextPartSchema, ChatErrorPartSchema, ChatToolPartSchema])
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
		sessionFile: z.string().optional(),
		sessionId: z.string(),
		sessionReset: z.boolean().optional(),
		diagnostics: z.array(z.string()).optional(),
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
		text: z.string(),
		messageId: z.string().optional(),
	})
	.openapi({ description: "Stream thinking event" });

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
		errorMessage: z.string().optional(),
	})
	.openapi({ description: "Compaction end event" });

export const ChatRetryStartEventSchema = z
	.object({
		type: z.literal("retry"),
		phase: z.literal("start"),
		attempt: z.number(),
		maxAttempts: z.number(),
		delayMs: z.number(),
		errorMessage: z.string(),
	})
	.openapi({ description: "Retry start event" });

export const ChatRetryEndEventSchema = z
	.object({
		type: z.literal("retry"),
		phase: z.literal("end"),
		success: z.boolean(),
		attempt: z.number(),
		finalError: z.string().optional(),
	})
	.openapi({ description: "Retry end event" });

export const ChatDoneEventSchema = z
	.object({
		type: z.literal("done"),
		runId: z.string(),
		message: ChatMessageSchema,
		sessionFile: z.string().optional(),
		sessionId: z.string(),
		sessionReset: z.boolean().optional(),
	})
	.openapi({ description: "Stream done event" });

export const ChatErrorEventSchema = z
	.object({
		type: z.literal("error"),
		message: z.string(),
		runId: z.string().optional(),
	})
	.openapi({ description: "Stream error event" });

export const ChatStreamEventSchema = z
	.union([
		ChatStartEventSchema,
		ChatDeltaEventSchema,
		ChatToolEventSchema,
		ChatPlanEventSchema,
		ChatStateStreamEventSchema,
		ChatQueueEventSchema,
		ChatThinkingEventSchema,
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
		sessionReset: z.boolean().optional(),
	})
	.openapi({ description: "Chat session response" });

export const ChatSessionInfoSchema = z
	.object({
		path: z.string(),
		id: z.string(),
		cwd: z.string(),
		name: z.string().optional(),
		created: z.string(),
		modified: z.string(),
		messageCount: z.number(),
		firstMessage: z.string(),
	})
	.openapi({ description: "Chat session info" });

export const ChatSessionsResponseSchema = z
	.object({
		sessions: z.array(ChatSessionInfoSchema),
	})
	.openapi({ description: "Chat sessions list response" });
