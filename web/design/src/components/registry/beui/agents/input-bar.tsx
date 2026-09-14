import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { ReactNode } from "react";
import type { QuestionBarData } from "./hooks/use-question-bar-navigation";
import type { InputInfoBarData } from "./input/info-bar";
import type { SuggestionItem } from "./input/suggestions";

type SuggestionConfig =
	| Array<SuggestionItem>
	| {
			items: Array<SuggestionItem>;
			className?: string;
			itemClassName?: string;
	  };

export type AttachedImage = {
	id: string;
	filename: string;
	url: string;
	size?: number;
};

export type AttachedFile = {
	id: string;
	filename: string;
	size?: number;
};

export type InputBarAttachmentsConfig = {
	onAttach?: () => void;
	images?: Array<AttachedImage>;
	files?: Array<AttachedFile>;
	onRemoveImage?: (id: string) => void;
	onRemoveFile?: (id: string) => void;
	onPaste?: (e: React.ClipboardEvent) => void;
	isDragOver?: boolean;
	enableImagePreview?: boolean;
	buttonPosition?: "left" | "right";
	previewStyle?: "thumbnail" | "chip" | "hidden";
};

export type InputBarControlledConfig = {
	value: string;
	onChange: (value: string) => void;
};

export type InputBarProps = {
	onSend: (message: { role: "user"; content: string; altKey?: boolean }) => void;
	status: ChatStatus;
	onStop: () => void;
	placeholder?: string;
	className?: string;
	attachments?: InputBarAttachmentsConfig;
	controlled?: InputBarControlledConfig;
	disabled?: boolean;
	autoFocus?: boolean;
	suggestions?: SuggestionConfig;
	slashCommands?: SuggestionConfig;
	onSlashCommandSelect?: (item: SuggestionItem) => boolean | void;
	typingAnimation?: {
		text: string;
		duration: number;
		image?: string;
		isActive: boolean;
		onComplete: () => void;
	};
	infoBar?: InputInfoBarData;
	questionBar?: QuestionBarData;
	leftActions?: ReactNode;
	rightActions?: ReactNode;
};
