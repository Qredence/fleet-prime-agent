import { lazy, Suspense, useCallback } from "react";
import type { useChatWorkspaceData } from "./use-chat-workspace-data";

type WorkspaceData = ReturnType<typeof useChatWorkspaceData>;

const LazyChatCommandPalette = lazy(() =>
	import("@prime-agent/web-design/components/product/fleet-pi/chat-command-palette").then(
		({ ChatCommandPalette }) => ({ default: ChatCommandPalette }),
	),
);
const LazySettingsDialog = lazy(() =>
	import("@prime-agent/web-design/components/product/fleet-pi/pi/settings-dialog").then(
		({ SettingsDialog }) => ({ default: SettingsDialog }),
	),
);
const LazyForkPickerDialog = lazy(() =>
	import("@prime-agent/web-design/components/product/fleet-pi/chat/fork-picker-dialog").then(
		({ ForkPickerDialog }) => ({ default: ForkPickerDialog }),
	),
);

// The settings dialog reads RightPanelProvider context, so ChatWorkspaceOverlayDialogs
/**
 * Renders the command palette overlay when it is open.
 *
 * This component must be rendered inside the workspace provider.
 *
 * @returns The command palette overlay when open; otherwise an empty fragment.
 */

export function ChatCommandPaletteOverlay({
	chrome,
	conversation,
	dialogs,
	panels,
	session,
}: {
	chrome: WorkspaceData["chrome"];
	conversation: WorkspaceData["conversation"];
	dialogs: WorkspaceData["dialogs"];
	panels: WorkspaceData["panels"];
	session: WorkspaceData["session"];
}) {
	return (
		<>
			{dialogs.commandPaletteOpen ? (
				<Suspense fallback={null}>
					<LazyChatCommandPalette
						open
						onOpenChange={dialogs.setCommandPaletteOpen}
						onNewSession={() => void session.startNewSession()}
						onStop={conversation.stop}
						onResumeSession={(sessionToResume) =>
							void session.resumeSession({ sessionId: sessionToResume.sessionId })
						}
						onSetRightPanel={panels.setRightPanel}
						onThemeChange={chrome.handleThemePreferenceChange}
						sessions={session.sessions}
						isStreaming={conversation.status === "streaming"}
						themePreference={chrome.themePreference}
					/>
				</Suspense>
			) : null}
		</>
	);
}

/**
 * Renders the workspace settings and fork picker dialogs when their state indicates they are open.
 *
 * @param dialogs - Dialog state and handlers for managing settings and fork picker interactions.
 */
export function ChatWorkspaceOverlayDialogs({ dialogs }: { dialogs: WorkspaceData["dialogs"] }) {
	const {
		forkFromEntry,
		forkPickerEntries,
		setForkPickerEntries,
		setSettingsDialogOpen,
		setSettingsInitialTab,
		settingsDialogOpen,
		settingsInitialTab,
	} = dialogs;
	const handleSettingsOpenChange = useCallback(
		(open: boolean) => {
			setSettingsDialogOpen(open);
			if (!open) setSettingsInitialTab(undefined);
		},
		[setSettingsDialogOpen, setSettingsInitialTab],
	);

	return (
		<>
			{settingsDialogOpen ? (
				<Suspense fallback={null}>
					<LazySettingsDialog
						open
						onOpenChange={handleSettingsOpenChange}
						initialTab={settingsInitialTab}
					/>
				</Suspense>
			) : null}
			{forkPickerEntries ? (
				<Suspense fallback={null}>
					<LazyForkPickerDialog
						entries={forkPickerEntries}
						onOpenChange={(open) => {
							if (!open) setForkPickerEntries(null);
						}}
						onPick={forkFromEntry}
					/>
				</Suspense>
			) : null}
		</>
	);
}
