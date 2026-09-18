import { ComposerLoader } from "@prime-agent/web-design/components/qredence-ui/chat/composer/composer-loader";
import {
	type ComposerTriggerItem,
	ComposerTriggerPopover,
} from "@prime-agent/web-design/components/qredence-ui/chat/composer/composer-trigger-popover";
import { FileAttachment } from "@prime-agent/web-design/components/qredence-ui/chat/composer/input/file-attachment";
import { ModeSelector } from "@prime-agent/web-design/components/qredence-ui/chat/composer/input/mode-selector";
import { InputQuestionBar } from "@prime-agent/web-design/components/qredence-ui/chat/composer/input/question-bar";
import type { SuggestionItem } from "@prime-agent/web-design/components/qredence-ui/chat/composer/input/suggestions";
import { PromptInput } from "@prime-agent/web-design/components/qredence-ui/chat/composer/prompt-input";
import { ModelSelector } from "@prime-agent/web-design/components/qredence-ui/chat/model-selector";
import { Button } from "@prime-agent/web-design/components/ui/button";
import type { ChatMode, ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { FileCode2, Plus, Terminal, X } from "lucide-react";
import { type ReactNode, useCallback } from "react";
import type { ChatModelOption } from "../../../../lib/pi/chat-helpers";
import { cn } from "../../../../lib/utils";
import { CHAT_COLUMN_CLASS, COMPOSER_ADD_BUTTON_CLASS } from "../../chrome/tokens";
import { AGENT_CHAT_MODES } from "../chat-modes";
import type { QuestionBarData } from "../hooks/use-question-bar-navigation";
import type { InlineCompletion } from "./inline-completion";
import { useInputBarState } from "./input-bar-state";

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
	questionBar?: QuestionBarData;
	leftActions?: ReactNode;
	rightActions?: ReactNode;
	modelKey: string | undefined;
	models: Array<ChatModelOption>;
	infoDescription?: string | null;
	chatMode?: ChatMode;
	onChatModeChange?: (mode: ChatMode) => void;
	onModelChange: (modelKey: string) => void;
	thinkingLevel?: ChatThinkingLevel;
	onThinkingLevelChange?: (level: ChatThinkingLevel) => void;
	onLocalSlashSubmit?: (message: string) => boolean;
	/** Reports the current draft so the host can classify it ahead of submit. */
	onDraftChange?: (text: string) => void;
	/**
	 * Optional offer of a built-in command instead of sending the draft. The
	 * chip never intercepts Enter: sending always goes through `onSend` unless
	 * the user activates the chip itself.
	 */
	intentSuggestion?: {
		label: string;
		description: string;
		onAccept: () => void;
		onDismiss: () => void;
	};
	/**
	 * Ghost text offered after the caret. Tab accepts it, Escape dismisses it.
	 * `forValue` must be the draft it was computed against, so a completion for an
	 * older draft is never painted onto a newer one.
	 */
	inlineCompletion?: InlineCompletion;
	modelPickerOpen?: boolean;
	onModelPickerOpenChange?: (open: boolean) => void;
	effortPickerOpen?: boolean;
	onEffortPickerOpenChange?: (open: boolean) => void;
	workspaceReferences?: Array<WorkspaceAttachment>;
	workspaceSuggestions?: InputBarProps["slashCommands"];
	onWorkspaceReferenceSelect?: (item: SuggestionItem) => void;
	onRemoveWorkspaceReference?: (relativePath: string) => void;
};

const EMPTY_WORKSPACE_REFERENCES: Array<WorkspaceAttachment> = [];
const CHAT_MODES = [...AGENT_CHAT_MODES];

export function InputBar(props: InputBarProps) {
	return <InputBarContent {...props} />;
}

function InputBarContent({
	modelKey,
	models,
	status,
	infoDescription,
	chatMode = "agent",
	onChatModeChange,
	onModelChange,
	thinkingLevel,
	onThinkingLevelChange,
	onStop,
	onSend,
	onSlashCommandSelect,
	onLocalSlashSubmit,
	onDraftChange,
	intentSuggestion,
	inlineCompletion,
	modelPickerOpen,
	onModelPickerOpenChange,
	effortPickerOpen,
	onEffortPickerOpenChange,
	workspaceReferences = EMPTY_WORKSPACE_REFERENCES,
	workspaceSuggestions,
	onWorkspaceReferenceSelect,
	onRemoveWorkspaceReference,
	controlled,
	disabled,
	autoFocus,
	placeholder,
	attachments,
	questionBar,
	slashCommands,
	className,
}: InputBarProps) {
	const {
		acceptIntentSuggestion,
		activeTriggerIndex,
		attachTextarea,
		combinedPickerOpen,
		commandGroups,
		closeTriggerMenu,
		files,
		ghostText,
		handleCombinedPickerOpenChange,
		handlePromptKeyDown,
		handleSelectorModelChange,
		images,
		isStreaming,
		navigation,
		openSlashMenu,
		filteredWorkspaceItems,
		selectCommand,
		selectWorkspaceReference,
		selectorModels,
		send,
		setActiveTriggerIndex,
		setDismissedQuestionId,
		setValue,
		showQuestion,
		slashQuery,
		triggerItems,
		triggerKind,
		triggerOpen,
		value,
		workspaceQuery,
	} = useInputBarState({
		models,
		status,
		thinkingLevel,
		onModelChange,
		onThinkingLevelChange,
		onSend,
		onSlashCommandSelect,
		onLocalSlashSubmit,
		onDraftChange,
		intentSuggestion,
		inlineCompletion,
		modelPickerOpen,
		onModelPickerOpenChange,
		effortPickerOpen,
		onEffortPickerOpenChange,
		workspaceReferences,
		workspaceSuggestions,
		onWorkspaceReferenceSelect,
		onRemoveWorkspaceReference,
		controlled,
		disabled,
		questionBar,
		attachments,
		slashCommands,
	});

	const handleChatModeChange = useCallback((id: string) => onChatModeChange?.(id as ChatMode), [onChatModeChange]);
	const handleEffortChange = useCallback(
		(level: string) => onThinkingLevelChange?.(level as ChatThinkingLevel),
		[onThinkingLevelChange],
	);

	return (
		<div className={cn("shrink-0 pb-3", CHAT_COLUMN_CLASS, className)}>
			<div className="relative w-full">
				<ComposerLoader label={infoDescription ?? undefined} isActive={isStreaming} />
				{intentSuggestion && !isStreaming && !disabled ? (
					<div className="mb-2 flex items-center gap-2 rounded-xl border bg-muted/40 px-2.5 py-1.5">
						<Terminal className="size-3.5 shrink-0 text-muted-foreground" />
						<button
							type="button"
							onClick={acceptIntentSuggestion}
							className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
							title={intentSuggestion.description}
						>
							<span className="font-medium">{intentSuggestion.label}</span>
							<span className="text-muted-foreground"> — {intentSuggestion.description}</span>
						</button>
						<button
							type="button"
							aria-label="Dismiss suggestion"
							onClick={intentSuggestion.onDismiss}
							className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
						>
							<X className="size-3" />
						</button>
					</div>
				) : null}
				{showQuestion ? (
					<InputQuestionBar
						questionBar={questionBar!}
						navigation={navigation}
						roundedTop
						onDismiss={setDismissedQuestionId}
					/>
				) : null}
				<ComposerTriggerPopover
					open={triggerOpen}
					kind={triggerKind ?? "slash"}
					query={triggerKind === "slash" ? slashQuery : workspaceQuery}
					items={triggerKind === "mention" ? filteredWorkspaceItems : undefined}
					groups={triggerKind === "slash" ? commandGroups : undefined}
					activeIndex={activeTriggerIndex}
					onActiveIndexChange={setActiveTriggerIndex}
					onSelect={(item: ComposerTriggerItem) => {
						if (triggerKind === "slash") selectCommand(item);
						else selectWorkspaceReference(item);
					}}
					onClose={closeTriggerMenu}
					title={triggerKind === "slash" ? "Commands" : "Workspace references"}
					listId="composer-trigger-list"
				/>
				{images.length > 0 || files.length > 0 ? (
					<div className="mb-2 flex flex-wrap gap-2 rounded-xl border bg-muted/40 p-2">
						{images.map((image) => (
							<div key={image.id} className="group relative">
								<img
									src={image.url}
									alt={image.filename}
									width={64}
									height={64}
									loading="lazy"
									className="size-16 rounded-lg border object-cover"
								/>
								<Button
									type="button"
									variant="outline"
									size="icon-xs"
									aria-label={`Remove ${image.filename}`}
									onClick={() => attachments?.onRemoveImage?.(image.id)}
									className="absolute -right-1 -top-1 size-5 rounded-full bg-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
								>
									<X data-icon="inline-start" className="size-3" />
								</Button>
							</div>
						))}
						{files.map((file) => (
							<FileAttachment
								key={file.id}
								id={file.id}
								filename={file.filename}
								size={file.size}
								onRemove={attachments?.onRemoveFile ? () => attachments.onRemoveFile?.(file.id) : undefined}
							/>
						))}
					</div>
				) : null}
				{workspaceReferences.length > 0 ? (
					<div className="mb-2 flex flex-wrap gap-1.5 rounded-xl border bg-muted/40 p-2">
						{workspaceReferences.map((attachment) => (
							<div
								key={attachment.relativePath}
								className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-xs text-foreground/75"
							>
								<FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
								<span className="max-w-[min(28rem,70vw)] truncate">@{attachment.relativePath}</span>
								<button
									type="button"
									aria-label={`Remove workspace reference ${attachment.relativePath}`}
									onClick={() => onRemoveWorkspaceReference?.(attachment.relativePath)}
									className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
				) : null}
				<PromptInput
					id="composer-prompt"
					name="prompt"
					value={value}
					onValueChange={setValue}
					onSubmit={(content) => send(content)}
					loading={isStreaming}
					submitWhileLoading
					onStop={onStop}
					disabled={disabled}
					autoFocus={autoFocus}
					placeholder={placeholder ?? "Send a message…"}
					onPaste={attachments?.onPaste}
					aria-controls={triggerOpen ? "composer-trigger-list" : undefined}
					aria-expanded={triggerOpen}
					aria-haspopup="listbox"
					aria-activedescendant={
						triggerOpen && triggerItems[activeTriggerIndex]
							? `composer-trigger-list-${triggerItems[activeTriggerIndex].id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
							: undefined
					}
					onKeyDown={handlePromptKeyDown}
					onTextareaRef={attachTextarea}
					ghostText={ghostText}
					leadingAction={
						<>
							<Button
								type="button"
								variant="outline"
								size="icon"
								disabled={disabled || isStreaming}
								aria-label="Open slash commands"
								data-slot="composer-add"
								onClick={openSlashMenu}
								className={COMPOSER_ADD_BUTTON_CLASS}
							>
								<Plus className="size-4" />
							</Button>
							<ModeSelector modes={CHAT_MODES} value={chatMode} onChange={handleChatModeChange} />
							<ModelSelector
								models={selectorModels}
								value={modelKey}
								effort={thinkingLevel}
								onModelChange={handleSelectorModelChange}
								onEffortChange={handleEffortChange}
								open={combinedPickerOpen}
								onOpenChange={handleCombinedPickerOpenChange}
								placeholder="Model"
							/>
						</>
					}
				/>
			</div>
		</div>
	);
}
