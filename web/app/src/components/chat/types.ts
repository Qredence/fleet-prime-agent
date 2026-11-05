import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ReactNode } from "react";

export type SuggestionItem = {
	id: string;
	label: string;
	value?: string;
	icon?: ReactNode;
	description?: string;
	category?: string;
	keywords?: readonly string[];
	disabled?: boolean;
	metadata?: Record<string, string | undefined>;
	className?: string;
};

export type InputSuggestions =
	| Array<SuggestionItem>
	| {
			items: Array<SuggestionItem>;
			className?: string;
			itemClassName?: string;
	  };

/** Props passed to custom tool renderer components */
export type CustomToolRendererProps = {
	name: string;
	input: Record<string, unknown>;
	output: unknown | undefined;
	status: "pending" | "streaming" | "success" | "error";
};

/** A model option for the model selector */
export type ModelOption = {
	id: string;
	name: string;
	version?: string;
};

/** Props for the <AgentChat> component */
export type AgentChatProps = {
	messages: Array<ChatMessage>;
	highlightedMessageId?: string;
	onSend: (message: { role: "user"; content: string; altKey?: boolean }) => void;
	status: ChatStatus;
	onStop: () => void;
	error?: Error;
	toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>;
	onOpenUIAction?: (message: string) => void;
	suggestions?: InputSuggestions;
	className?: string;
};
