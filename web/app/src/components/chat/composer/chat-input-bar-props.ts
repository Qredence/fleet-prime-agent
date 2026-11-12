import type { ChatMode } from "@prime-agent/web-protocol/chat-protocol";
import type { UploadedAttachment, WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";
import type { ChatPanel } from "@/components/chat/agent-chat";
import { resolveChatApiUrl } from "@/components/chat/chat-runtime-url";
import type { useChatWorkspaceData } from "@/components/chat/use-chat-workspace-data";

/**
 * Owns composer-local mode, attachment, and picker state so session/panel
 * updates do not share those setters.
 */
export function useChatWorkspaceComposerState() {
	const [chatMode, setChatMode] = useState<ChatMode>("agent");
	const [uploadedAttachments, setUploadedAttachments] = useState<Array<UploadedAttachment>>([]);
	const [workspaceAttachments, setWorkspaceAttachments] = useState<Array<WorkspaceAttachment>>([]);
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [effortPickerOpen, setEffortPickerOpen] = useState(false);

	return {
		chatMode,
		effortPickerOpen,
		modelPickerOpen,
		setChatMode,
		setEffortPickerOpen,
		setModelPickerOpen,
		setUploadedAttachments,
		setWorkspaceAttachments,
		uploadedAttachments,
		workspaceAttachments,
	};
}

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
		() => ({
			modelKey,
			models,
			infoDescription,
			slashCommands,
			chatMode,
			onChatModeChange: setChatMode,
			onModelChange: setModelKey,
			thinkingLevel,
			onThinkingLevelChange: setThinkingLevel,
			attachments: {
				onAttach: handleAttach,
				images: uploadedAttachments.flatMap((attachment) =>
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
				files: uploadedAttachments.flatMap((attachment) =>
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
				onRemoveImage: removeUploadedAttachment,
				onRemoveFile: removeUploadedAttachment,
			},
			workspaceReferences: workspaceAttachments,
			workspaceSuggestions: workspaceReferenceSuggestions,
			onWorkspaceReferenceSelect: addWorkspaceAttachment,
			onRemoveWorkspaceReference: removeWorkspaceAttachment,
			onSlashCommandSelect: handleSlashCommandSelect,
			onLocalSlashSubmit: handleLocalSlashSubmit,
			onDraftChange: onComposerDraftChange,
			inlineCompletion,
			modelPickerOpen,
			onModelPickerOpenChange: setModelPickerOpen,
			effortPickerOpen,
			onEffortPickerOpenChange: setEffortPickerOpen,
		}),
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
