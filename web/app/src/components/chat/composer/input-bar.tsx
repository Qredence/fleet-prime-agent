import type { ChatMode, ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol";
import { ChatModeSchema, ChatThinkingLevelSchema } from "@prime-agent/web-protocol/chat-protocol.zod";
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types";
import type { WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { Paperclip, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	type ChatModelOption,
	availableThinkingLevels,
	clampThinkingLevel,
	thinkingLevelLabel,
} from "@/lib/chat/chat-helpers";
import {
	AGENT_CHAT_MODES,
	ComposerAttachments,
	ComposerLoader,
	ModeSelector,
} from "@/components/chat/composer/composer-controls";
import { ComposerTriggerPopover, useComposerTriggers } from "@/components/chat/composer/composer-triggers";
import { type InlineCompletion, useComposerGhost } from "@/hooks/chat/inline-completion";
import { ProviderBrandIcon } from "@/components/settings/providers/provider-brand-icon";
import { formatProviderLabel } from "@/lib/settings/provider-metadata";
import { PromptInput } from "@/components/chat/composer/prompt-input";
import { type ModelSelectorModel, ModelSelector } from "@/components/chat/model-selector";
import type { InputSuggestions, SuggestionItem } from "@/lib/chat/types";
import { InputGroupButton } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

const COMPOSER_ADD_BUTTON_CLASS =
	"size-8 shrink-0 rounded-full border-border/70 bg-background text-foreground/80 shadow-sm hover:bg-muted hover:text-foreground";

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
	slashCommands?: InputSuggestions;
	onSlashCommandSelect?: (item: SuggestionItem) => boolean | void;
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
	workspaceSuggestions?: InputSuggestions;
	onWorkspaceReferenceSelect?: (item: SuggestionItem) => void;
	onRemoveWorkspaceReference?: (relativePath: string) => void;
};

const EMPTY_WORKSPACE_REFERENCES: Array<WorkspaceAttachment> = [];
const CHAT_MODES = [...AGENT_CHAT_MODES];
const DRAFT_REPORT_DEBOUNCE_MS = 300;

function selectorModelsFor(models: Array<ChatModelOption>): Array<ModelSelectorModel> {
	const selectable: Array<ModelSelectorModel> = [];
	for (const model of models) {
		if (model.available === false) continue;
		selectable.push({
			id: model.id,
			name: model.name,
			provider: model.provider,
			providerLabel: formatProviderLabel(model.provider),
			modelId: model.modelId,
			icon: <ProviderBrandIcon provider={model.provider} className="size-4" />,
			reasoning: model.reasoning,
			keywords: [model.provider, model.modelId, model.id],
			efforts: availableThinkingLevels(model).map((level) => ({
				id: level,
				name: thinkingLevelLabel(level),
			})),
		});
	}
	return selectable;
}

export function InputBar({
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
	slashCommands,
	className,
}: InputBarProps) {
	const isStreaming = status === "streaming" || status === "submitted";
	const [internalValue, setInternalValue] = useState("");
	const value = controlled?.value ?? internalValue;
	const setValue = controlled?.onChange ?? setInternalValue;

	const send = useCallback(
		(content: string, altKey = false) => {
			if (onLocalSlashSubmit?.(content) === true) {
				setValue("");
				return;
			}
			onSend({ role: "user", content, altKey });
			setValue("");
		},
		[onLocalSlashSubmit, onSend, setValue],
	);

	useEffect(() => {
		if (!onDraftChange) return;
		const timer = setTimeout(() => onDraftChange(value), DRAFT_REPORT_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [onDraftChange, value]);

	const triggers = useComposerTriggers({
		value,
		setValue,
		slashCommands,
		workspaceSuggestions,
		onSlashCommandSelect,
		onWorkspaceReferenceSelect,
		disabled,
		streaming: isStreaming,
		onOpen: () => ghost.textarea?.focus({ preventScroll: true }),
	});
	const ghost = useComposerGhost({
		value,
		setValue,
		completion: inlineCompletion,
		streaming: isStreaming,
		disabled,
		triggerOpen: triggers.open,
	});
	const selectorModels = useMemo(() => selectorModelsFor(models), [models]);

	const pickerOpen =
		modelPickerOpen === undefined && effortPickerOpen === undefined
			? undefined
			: Boolean(modelPickerOpen || effortPickerOpen);
	const handlePickerOpenChange = useCallback(
		(open: boolean) => {
			onModelPickerOpenChange?.(open);
			onEffortPickerOpenChange?.(open);
		},
		[onEffortPickerOpenChange, onModelPickerOpenChange],
	);

	const handleModelChange = useCallback(
		(nextModelKey: string) => {
			const nextModel = models.find((model) => model.id === nextModelKey);
			onModelChange(nextModelKey);
			if (nextModel) {
				onThinkingLevelChange?.(clampThinkingLevel(thinkingLevel, availableThinkingLevels(nextModel)));
			}
		},
		[models, onModelChange, onThinkingLevelChange, thinkingLevel],
	);

	const handlePromptKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "Backspace" && value.length === 0 && workspaceReferences.length > 0) {
			const lastReference = workspaceReferences[workspaceReferences.length - 1];
			if (lastReference) {
				event.preventDefault();
				onRemoveWorkspaceReference?.(lastReference.relativePath);
				return;
			}
		}
		if (triggers.open && triggers.items.length > 0) {
			if ((event.key === "Tab" || event.key === "Enter") && !event.shiftKey) {
				event.preventDefault();
				const item = triggers.items[triggers.activeIndex];
				if (item) triggers.selectItem(item);
				return;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				const step = event.key === "ArrowDown" ? 1 : -1;
				triggers.setActiveIndex((triggers.activeIndex + step + triggers.items.length) % triggers.items.length);
				return;
			}
		}
		// Escape dismisses the popover while open; otherwise it dismisses the ghost.
		if (event.key === "Tab" && !event.shiftKey && ghost.text) {
			event.preventDefault();
			ghost.accept();
			return;
		}
		if (event.key === "Escape" && !triggers.open && ghost.text) {
			event.preventDefault();
			ghost.dismiss();
			return;
		}
		if (event.key === "Enter" && event.altKey && !event.shiftKey) {
			event.preventDefault();
			const content = value.trim();
			if (content && !disabled) send(content, true);
		}
	};

	// Both pickers are parsed against the protocol rather than cast: an unknown
	// value is a no-op instead of reaching the transport as a bogus mode.
	const handleChatModeChange = useCallback(
		(id: string) => {
			const parsed = ChatModeSchema.safeParse(id);
			if (parsed.success) onChatModeChange?.(parsed.data);
		},
		[onChatModeChange],
	);
	const handleEffortChange = useCallback(
		(level: string) => {
			const parsed = ChatThinkingLevelSchema.safeParse(level);
			if (parsed.success) onThinkingLevelChange?.(parsed.data);
		},
		[onThinkingLevelChange],
	);

	const actionsDisabled = disabled || isStreaming;

	return (
		<div className={cn("chat-column shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}>
			<div className="relative flex w-full flex-col gap-3">
				<ComposerLoader label={infoDescription ?? undefined} isActive={isStreaming} />
				<ComposerAttachments
					attachments={attachments}
					workspaceReferences={workspaceReferences}
					onRemoveWorkspaceReference={onRemoveWorkspaceReference}
				/>
				<div className="relative w-full">
					<ComposerTriggerPopover
						open={triggers.open}
						kind={triggers.kind ?? "slash"}
						onOpenChange={(open) => {
							if (!open) triggers.close();
						}}
						anchor={ghost.textarea}
						query={triggers.query}
						items={triggers.items}
						groups={triggers.kind === "slash" ? triggers.commandGroups : undefined}
						activeIndex={triggers.activeIndex}
						onActiveIndexChange={triggers.setActiveIndex}
						onSelect={triggers.selectItem}
						listId={triggers.listId}
					/>
					<PromptInput
						{...ghost.editingHandlers}
						id="composer-prompt"
						name="prompt"
						value={value}
						onValueChange={setValue}
						onSubmit={send}
						loading={isStreaming}
						submitWhileLoading
						onStop={onStop}
						disabled={disabled}
						autoFocus={autoFocus}
						placeholder={placeholder ?? "Send a message…"}
						onPaste={attachments?.onPaste}
						aria-controls={triggers.open ? triggers.listId : undefined}
						aria-haspopup="listbox"
						aria-autocomplete="list"
						aria-activedescendant={triggers.open ? triggers.activeDescendant : undefined}
						onKeyDown={handlePromptKeyDown}
						onTextareaRef={ghost.attachTextarea}
						ghostText={ghost.text}
						leadingAction={
							<>
								<InputGroupButton
									type="button"
									variant="outline"
									size="icon-sm"
									disabled={actionsDisabled}
									aria-label="Open slash commands"
									data-slot="composer-add"
									onClick={triggers.openSlashMenu}
									className={COMPOSER_ADD_BUTTON_CLASS}
								>
									<Plus aria-hidden="true" className="size-4" />
								</InputGroupButton>
								{attachments?.onAttach ? (
									<InputGroupButton
										type="button"
										variant="outline"
										size="icon-sm"
										disabled={actionsDisabled}
										aria-label="Attach files"
										data-slot="composer-attach"
										onClick={attachments.onAttach}
										className={COMPOSER_ADD_BUTTON_CLASS}
									>
										<Paperclip aria-hidden="true" className="size-4" />
									</InputGroupButton>
								) : null}
								<ModeSelector modes={CHAT_MODES} value={chatMode} onChange={handleChatModeChange} />
								<ModelSelector
									models={selectorModels}
									value={modelKey}
									effort={thinkingLevel}
									onModelChange={handleModelChange}
									onEffortChange={handleEffortChange}
									open={pickerOpen}
									onOpenChange={handlePickerOpenChange}
									placeholder="Model"
								/>
							</>
						}
					/>
				</div>
			</div>
		</div>
	);
}
