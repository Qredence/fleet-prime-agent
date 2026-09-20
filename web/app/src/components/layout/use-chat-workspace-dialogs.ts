import { useState } from "react";
import type { SettingsSlashTab } from "@/components/chat/composer/slash-commands";
import type { ForkPickerEntry } from "@/components/chat/fork-picker-dialog";

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
