import type { z } from "zod/v4";
import type {
	ChatBashToolInputSchema,
	ChatEditToolInputSchema,
	ChatErrorPartSchema,
	ChatImagePartSchema,
	ChatMessagePartSchema,
	ChatMessageSchema,
	ChatPayloadPartSchema,
	ChatPlanToolInputSchema,
	ChatQuestionToolInputSchema,
	ChatReasoningPartSchema,
	ChatTextPartSchema,
	ChatTodoItemSchema,
	ChatTodoStatusSchema,
	ChatToolCategorySchema,
	ChatToolPartSchema,
} from "./schemas/chat";

export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type ChatMessageRole = "user" | "assistant";

export type ChatTextPart = z.infer<typeof ChatTextPartSchema>;

/** Typed model reasoning content, kept separate from ordinary assistant text. */
export type ChatReasoningPart = z.infer<typeof ChatReasoningPartSchema>;

export type ChatErrorPart = z.infer<typeof ChatErrorPartSchema>;

export type ChatImagePart = z.infer<typeof ChatImagePartSchema>;

/** Browser-safe representation of a payload the Prime Agent TUI renders inline. */
export type ChatPayloadPart = z.infer<typeof ChatPayloadPartSchema>;

export type ChatToolCategory = z.infer<typeof ChatToolCategorySchema>;

export type ChatTodoStatus = z.infer<typeof ChatTodoStatusSchema>;

export type ChatTodoItem = z.infer<typeof ChatTodoItemSchema>;

export type ChatBashToolInput = z.infer<typeof ChatBashToolInputSchema>;

export type ChatEditToolInput = z.infer<typeof ChatEditToolInputSchema>;

export type ChatQuestionToolInput = z.infer<typeof ChatQuestionToolInputSchema>;

export type ChatPlanToolInput = z.infer<typeof ChatPlanToolInputSchema>;

export type ChatToolPart = z.infer<typeof ChatToolPartSchema>;

export type ChatMessagePart = z.infer<typeof ChatMessagePartSchema>;

export function isChatTextPart(part: ChatMessagePart): part is ChatTextPart {
	return part.type === "text";
}

export function isChatPayloadPart(part: ChatMessagePart): part is ChatPayloadPart {
	return part.type === "payload";
}

export function isChatToolPart(part: ChatMessagePart): part is ChatToolPart {
	return part.type.startsWith("tool-");
}

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
