import type { ChatMode } from "@prime-agent/web-protocol/chat-protocol";
import type { UploadedAttachment, WorkspaceAttachment } from "@prime-agent/web-protocol/fleet-contract";
import { useState } from "react";

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
