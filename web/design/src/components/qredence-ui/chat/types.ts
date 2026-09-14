import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type React from "react";
import type { SuggestionItem } from "./input/suggestions";
import type { QuestionAnswer, QuestionConfig } from "./question/question-prompt";

export type InputSuggestions =
	| Array<SuggestionItem>
	| {
			items: Array<SuggestionItem>;
			className?: string;
			itemClassName?: string;
	  };

/** Per-element CSS class overrides */
export type ChatClassNames = {
	root: string;
	userMessage: string;
	inputBar: string;
};

/** Props passed to custom tool renderer components */
export type CustomToolRendererProps = {
	name: string;
	input: Record<string, unknown>;
	output: unknown | undefined;
	status: "pending" | "streaming" | "success" | "error";
};

/** Component slot overrides */
export type ChatSlots = {
	InputBar: React.ComponentType<{
		onSend: (message: { role: "user"; content: string; altKey?: boolean }) => void;
		status: ChatStatus;
		onStop: () => void;
		[key: string]: unknown;
	}>;
	UserMessage: React.ComponentType<{
		message: ChatMessage;
		className?: string;
	}>;
	ToolRenderer: React.ComponentType<{
		part: {
			type: string;
			toolCallId?: string;
			state?: string;
			input?: unknown;
			output?: unknown;
			result?: unknown;
		};
		nestedTools?: Array<{
			type: string;
			toolCallId?: string;
			state?: string;
			input?: unknown;
			output?: unknown;
			result?: unknown;
		}>;
		chatStatus?: string;
		toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
	}>;
	TextRenderer?: React.ComponentType<{
		content: string;
		className?: string;
		isStreaming?: boolean;
		messageId?: string;
		onOpenUIAction?: (message: string) => void;
	}>;
};

/** A model option for the model selector */
export type ModelOption = {
	id: string;
	name: string;
	version?: string;
};

/** Props for the <AgentChat> drop-in component */
export type AgentChatProps = {
	messages: Array<ChatMessage>;
	onSend: (message: { role: "user"; content: string; altKey?: boolean }) => void;
	status: ChatStatus;
	onStop: () => void;
	error?: Error;

	classNames?: Partial<ChatClassNames>;
	slots?: Partial<ChatSlots>;
	toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
	onOpenUIAction?: (message: string) => void;

	/** Attachment configuration */
	attachments?: {
		onAttach?: () => void;
		images?: Array<{ id: string; filename: string; url: string; size?: number }>;
		files?: Array<{ id: string; filename: string; size?: number }>;
		onRemoveImage?: (id: string) => void;
		onRemoveFile?: (id: string) => void;
		onPaste?: (e: React.ClipboardEvent) => void;
		isDragOver?: boolean;
	};

	/** Show copy toolbar on text turns */
	showCopyToolbar?: boolean;

	/**
	 * Where to position the scroll container on initial mount.
	 * - "bottom" (default): classic chat behavior, pinned to the latest message.
	 * - "top": start from the top of the conversation — useful for static demos
	 *   or read-only transcripts where the user should read top-to-bottom.
	 */
	initialScrollBehavior?: "bottom" | "top";

	/**
	 * When true (default) clicking an attached image opens a fullscreen
	 * lightbox preview. Set to false to render images as plain thumbnails
	 * (no click handler, no portal). Applies to both staged input attachments
	 * and images inside user messages.
	 */
	enableImagePreview?: boolean;

	suggestions?: InputSuggestions;

	emptyStatePosition?: "default" | "center";
	emptySuggestionsPlacement?: "input" | "empty" | "both";
	emptySuggestionsPosition?: "top" | "bottom";

	questionTool?: {
		submitLabel?: string;
		skipLabel?: string;
		allowSkip?: boolean;
		onAnswer?: (payload: { toolCallId?: string; question: QuestionConfig; answer: QuestionAnswer }) => void;
	};

	/**
	 * When true, `tool-Question` parts are hidden from the inline message list.
	 * Use alongside the InputBar `questionBar` prop to avoid rendering the same
	 * question in both the message stream and the composer.
	 */
	suppressQuestionTool?: boolean;

	className?: string;
	style?: React.CSSProperties;
};
