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

export type ChatToolPart = {
	type: string;
	toolCallId?: string;
	state?: string;
	input?: unknown;
	output?: unknown;
	result?: unknown;
	[key: string]: unknown;
};

export type ChatMessagePart = ChatTextPart | ChatErrorPart | ChatToolPart;

export type ChatMessage = {
	id: string;
	role: ChatMessageRole;
	parts: Array<ChatMessagePart>;
	createdAt?: Date | string | number;
	experimental_attachments?: Array<{
		contentType?: string;
		url?: string;
	}>;
	[key: string]: unknown;
};
