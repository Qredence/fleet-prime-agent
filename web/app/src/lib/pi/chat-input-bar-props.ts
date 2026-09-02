import type { ComponentProps } from "react";
import type { ChatPanel } from "./chat-panel";
import { resolveChatApiUrl } from "./chat-runtime-url";
import type { useChatWorkspaceData } from "./use-chat-workspace-data";

type WorkspaceData = ReturnType<typeof useChatWorkspaceData>;

/**
 * Builds input-bar properties from the composer state and active chat session.
 *
 * @param composer - The composer state and handlers used to configure the input bar
 * @param activeSessionId - The active chat session identifier used to build image attachment URLs
 * @returns The input-bar properties for the chat panel
 */
export function buildChatInputBarProps(
	composer: WorkspaceData["composer"],
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
		modelPickerOpen: composer.modelPickerOpen,
		onModelPickerOpenChange: composer.setModelPickerOpen,
		effortPickerOpen: composer.effortPickerOpen,
		onEffortPickerOpenChange: composer.setEffortPickerOpen,
	};
}
