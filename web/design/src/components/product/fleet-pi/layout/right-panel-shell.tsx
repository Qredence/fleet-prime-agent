import { Library } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useSyncExternalStore } from "react";
import { CHAT_PANEL_BREAKPOINT_PX } from "../../../../lib/layout-constants";
import { ResizableCanvas } from "../pi/resizable-canvas";
import { MobilePanel, RightPanelTabsFromContext } from "../pi/right-panel-launcher";
import { useChatPanelDataContext, useWorkspaceTreeContext } from "./right-panel-context";
import { getRightPanelDefinition } from "./right-panel-registry";

const DESKTOP_PANEL_QUERY = `(min-width: ${CHAT_PANEL_BREAKPOINT_PX}px)`;

function subscribeToDesktopPanel(onChange: () => void) {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
	const media = window.matchMedia(DESKTOP_PANEL_QUERY);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

function getDesktopPanelSnapshot() {
	return typeof window !== "undefined" && typeof window.matchMedia === "function"
		? window.matchMedia(DESKTOP_PANEL_QUERY).matches
		: false;
}

function getServerDesktopPanelSnapshot() {
	return false;
}

function useIsDesktopPanel() {
	return useSyncExternalStore(subscribeToDesktopPanel, getDesktopPanelSnapshot, getServerDesktopPanelSnapshot);
}

export type RightPanelShellProps = {
	handleResourceCanvasResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
	onClose: () => void;
	resourceCanvasWidth: number;
};

/**
 * Renders the selected right-panel content in mobile and desktop layouts.
 *
 * @param onClose - Closes the active right panel.
 * @param handleResourceCanvasResizeStart - Handles the start of desktop panel resizing.
 * @param resourceCanvasWidth - The desktop panel width.
 */
export function RightPanelShell({
	handleResourceCanvasResizeStart,
	onClose,
	resourceCanvasWidth,
}: RightPanelShellProps) {
	const chat = useChatPanelDataContext();
	const workspace = useWorkspaceTreeContext();
	const { rightPanel } = chat;
	const panelOpen = rightPanel !== null;
	const isDesktop = useIsDesktopPanel();
	const definition = rightPanel ? getRightPanelDefinition(rightPanel) : null;
	const PanelContent = definition?.component;
	const loading =
		definition?.loadingSource === "resources"
			? chat.resourcesLoading
			: definition?.loadingSource === "workspace"
				? workspace.workspaceLoading
				: false;
	const onRefresh =
		definition?.refreshSource === "resources"
			? chat.refreshResources
			: definition?.refreshSource === "workspace"
				? workspace.refreshWorkspace
				: undefined;
	return (
		<>
			{isDesktop ? (
				<ResizableCanvas
					dataTestid={definition?.dataTestid}
					headerLeading={<RightPanelTabsFromContext compact idPrefix="right-panel-desktop" />}
					loading={loading}
					onClose={onClose}
					onRefresh={onRefresh}
					onResizeStart={handleResourceCanvasResizeStart}
					open={panelOpen}
					title={definition?.title ?? ""}
					titleIcon={definition?.icon ?? Library}
					width={resourceCanvasWidth}
				>
					{PanelContent ? <PanelContent /> : null}
				</ResizableCanvas>
			) : (
				<MobilePanel
					dataTestid={definition?.mobileDataTestid}
					icon={definition?.icon}
					onClose={onClose}
					open={panelOpen}
					title={definition?.title ?? ""}
				>
					{PanelContent ? <PanelContent /> : null}
				</MobilePanel>
			)}
		</>
	);
}
