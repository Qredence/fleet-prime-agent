import { useState } from "react";
import type { ForkPickerEntry } from "@/components/qredence-ui/chat/fork-picker-dialog";
import type { SettingsSlashTab } from "@/lib/pi/slash-commands";

/**
 * Owns settings and fork-picker dialog state for the chat workspace.
 */
export function useChatWorkspaceDialogs() {
	const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
	const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsSlashTab | undefined>(undefined);
	const [forkPickerEntries, setForkPickerEntries] = useState<Array<ForkPickerEntry> | null>(null);

	return {
		forkPickerEntries,
		setForkPickerEntries,
		setSettingsDialogOpen,
		setSettingsInitialTab,
		settingsDialogOpen,
		settingsInitialTab,
	};
}
