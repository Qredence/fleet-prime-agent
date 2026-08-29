export type ChatStatus = "ready" | "submitted" | "streaming" | "error";

export type ChatMessageRole = "user" | "assistant";

export type ChatTextPart = {
	type: "text";
	text: string;
};

export type ChatErrorPart = {
	type: "error";
	title?: string;
	message: string;
};

export type ChatImagePart = {
	type: "image";
	url: string;
	mimeType?: string;
	alt?: string;
};

/** Browser-safe representation of a payload the Prime Agent TUI renders inline. */
export type ChatPayloadPart = {
	type: "payload";
	id?: string;
	kind: string;
	title: string;
	text?: string;
	payload?: unknown;
};

export type ChatToolCategory = "kernel" | "system" | "mcp" | "rlm" | "plan" | "question" | "custom";

export type ChatToolPart = {
	type: string;
	category?: ChatToolCategory;
	toolName?: string;
	serverName?: string;
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	result?: unknown;
	durationMs?: number;
	error?: unknown;
	[key: string]: unknown;
};

export type ChatMessagePart = ChatTextPart | ChatErrorPart | ChatImagePart | ChatPayloadPart | ChatToolPart;

export type ChatMessage = {
	id: string;
	role: ChatMessageRole;
	parts: Array<ChatMessagePart>;
	createdAt?: Date | string | number;
	/** Web-only echo from slash handlers; never persisted or sent to the agent. */
	source?: "local";
	experimental_attachments?: Array<{
		contentType?: string;
		url?: string;
	}>;
	[key: string]: unknown;
};
