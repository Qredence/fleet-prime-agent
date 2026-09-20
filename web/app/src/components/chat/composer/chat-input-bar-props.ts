import type { ComponentProps } from "react";
import { useMemo } from "react";
import type { ChatPanel } from "@/components/chat/chat-panel";
import { resolveChatApiUrl } from "@/components/chat/chat-runtime-url";
import type { useChatWorkspaceData } from "@/components/chat/use-chat-workspace-data";

type WorkspaceData = ReturnType<typeof useChatWorkspaceData>;
type ChatInputBarComposer = Pick<
	WorkspaceData["composer"],
	| "addWorkspaceAttachment"
	| "chatMode"
	| "effortPickerOpen"
	| "handleAttach"
	| "handleLocalSlashSubmit"
	| "handleSlashCommandSelect"
	| "infoDescription"
	| "inlineCompletion"
	| "onComposerDraftChange"
	| "modelKey"
	| "modelPickerOpen"
	| "models"
	| "pendingQuestionBar"
	| "removeUploadedAttachment"
	| "removeWorkspaceAttachment"
	| "setChatMode"
	| "setEffortPickerOpen"
	| "setModelKey"
	| "setModelPickerOpen"
	| "setThinkingLevel"
	| "slashCommands"
	| "thinkingLevel"
	| "uploadedAttachments"
	| "workspaceAttachments"
	| "workspaceReferenceSuggestions"
>;

/**
 * Builds input-bar properties from the composer state and active chat session.
 *
 * @param composer - The composer state and handlers used to configure the input bar
 * @param activeSessionId - The active chat session identifier used to build image attachment URLs
 * @returns The input-bar properties for the chat panel
 */
export function buildChatInputBarProps(
	composer: ChatInputBarComposer,
	activeSessionId: string | undefined,
): ComponentProps<typeof ChatPanel>["inputBar"] {
	return {
		modelKey: composer.modelKey,
		models: composer.models,
		infoDescription: composer.infoDescription,
		slashCommands: composer.slashCommands,
		questionBar: composer.pendingQuestionBar,
		chatMode: composer.chatMode,
		onChatModeChange: composer.setChatMode,
		onModelChange: composer.setModelKey,
		thinkingLevel: composer.thinkingLevel,
		onThinkingLevelChange: composer.setThinkingLevel,
		attachments: {
			onAttach: composer.handleAttach,
			images: composer.uploadedAttachments.flatMap((attachment) =>
				attachment.mimeType.startsWith("image/")
					? [
							{
								id: attachment.attachmentId,
								filename: attachment.name,
								size: attachment.size,
								url: resolveChatApiUrl(
									`/api/chat/session?sessionId=${encodeURIComponent(
										activeSessionId ?? "",
									)}&attachmentId=${encodeURIComponent(attachment.attachmentId)}`,
								),
							},
						]
					: [],
			),
			files: composer.uploadedAttachments.flatMap((attachment) =>
				attachment.mimeType.startsWith("image/")
					? []
					: [
							{
								id: attachment.attachmentId,
								filename: attachment.name,
								size: attachment.size,
							},
						],
			),
			onRemoveImage: composer.removeUploadedAttachment,
			onRemoveFile: composer.removeUploadedAttachment,
		},
		workspaceReferences: composer.workspaceAttachments,
		workspaceSuggestions: composer.workspaceReferenceSuggestions,
		onWorkspaceReferenceSelect: composer.addWorkspaceAttachment,
		onRemoveWorkspaceReference: composer.removeWorkspaceAttachment,
		onSlashCommandSelect: composer.handleSlashCommandSelect,
		onLocalSlashSubmit: composer.handleLocalSlashSubmit,
		onDraftChange: composer.onComposerDraftChange,
		inlineCompletion: composer.inlineCompletion,
		modelPickerOpen: composer.modelPickerOpen,
		onModelPickerOpenChange: composer.setModelPickerOpen,
		effortPickerOpen: composer.effortPickerOpen,
		onEffortPickerOpenChange: composer.setEffortPickerOpen,
	};
}

/**
 * Memoizes composer props so streaming transcript tokens do not rebuild the
 * input-bar object and break ChatComposerHost isolation.
 */
export function useChatInputBarProps(
	composer: ChatInputBarComposer,
	activeSessionId: string | undefined,
): ComponentProps<typeof ChatPanel>["inputBar"] {
	const {
		addWorkspaceAttachment,
		chatMode,
		effortPickerOpen,
		handleAttach,
		handleLocalSlashSubmit,
		handleSlashCommandSelect,
		infoDescription,
		inlineCompletion,
		modelKey,
		modelPickerOpen,
		models,
		onComposerDraftChange,
		pendingQuestionBar,
		removeUploadedAttachment,
		removeWorkspaceAttachment,
		setChatMode,
		setEffortPickerOpen,
		setModelKey,
		setModelPickerOpen,
		setThinkingLevel,
		slashCommands,
		thinkingLevel,
		uploadedAttachments,
		workspaceAttachments,
		workspaceReferenceSuggestions,
	} = composer;

	return useMemo(
		() =>
			buildChatInputBarProps(
				{
					addWorkspaceAttachment,
					chatMode,
					effortPickerOpen,
					handleAttach,
					handleLocalSlashSubmit,
					handleSlashCommandSelect,
					infoDescription,
					inlineCompletion,
					modelKey,
					modelPickerOpen,
					models,
					onComposerDraftChange,
					pendingQuestionBar,
					removeUploadedAttachment,
					removeWorkspaceAttachment,
					setChatMode,
					setEffortPickerOpen,
					setModelKey,
					setModelPickerOpen,
					setThinkingLevel,
					slashCommands,
					thinkingLevel,
					uploadedAttachments,
					workspaceAttachments,
					workspaceReferenceSuggestions,
				},
				activeSessionId,
			),
		[
			activeSessionId,
			addWorkspaceAttachment,
			chatMode,
			effortPickerOpen,
			handleAttach,
			handleLocalSlashSubmit,
			handleSlashCommandSelect,
			infoDescription,
			inlineCompletion,
			modelKey,
			modelPickerOpen,
			models,
			onComposerDraftChange,
			pendingQuestionBar,
			removeUploadedAttachment,
			removeWorkspaceAttachment,
			setChatMode,
			setEffortPickerOpen,
			setModelKey,
			setModelPickerOpen,
			setThinkingLevel,
			slashCommands,
			thinkingLevel,
			uploadedAttachments,
			workspaceAttachments,
			workspaceReferenceSuggestions,
		],
	);
}
