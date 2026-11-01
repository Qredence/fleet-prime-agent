import { Library } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useMemo, useSyncExternalStore } from "react";
import { ResizableCanvas } from "@/components/layout/resizable-canvas";
import { useChatPanelDataContext, useWorkspaceTreeContext } from "@/components/layout/right-panel-context";
import { MobilePanel, RightPanelTabsFromContext } from "@/components/layout/right-panel-launcher";
import {
	type ActiveRightPanel,
	getRightPanelDefinition,
	getRightPanelGroup,
} from "@/components/layout/right-panel-registry";
import { TabStrip } from "@/components/layout/tab-strip";
import { CHAT_PANEL_BREAKPOINT_PX } from "@/lib/layout-constants";

const DESKTOP_PANEL_QUERY = `(min-width: ${CHAT_PANEL_BREAKPOINT_PX}px)`;

/** Short labels for the in-panel view switcher. */
const GROUP_VIEW_LABELS: Record<ActiveRightPanel, string> = {
	resources: "Skills",
	workspace: "Files",
	artifacts: "Artifacts",
	repl: "REPL",
	subagents: "Subagents",
	"session-insights": "Insights",
	"session-tree": "Tree",
};

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
	onResourceCanvasWidthChange?: (width: number) => void;
};

/**
 * Renders the selected right-panel content in mobile and desktop layouts.
 *
 * @param onClose - Closes the active right panel.
 * @param handleResourceCanvasResizeStart - Handles the start of desktop panel resizing.
 * @param resourceCanvasWidth - The desktop panel width.
 * @param onResourceCanvasWidthChange - Updates the desktop panel width (for keyboard resizing).
 */
export function RightPanelShell({
	handleResourceCanvasResizeStart,
	onClose,
	resourceCanvasWidth,
	onResourceCanvasWidthChange,
}: RightPanelShellProps) {
	const chat = useChatPanelDataContext();
	const workspace = useWorkspaceTreeContext();
	const { rightPanel, setRightPanel } = chat;
	const panelOpen = rightPanel !== null;
	const isDesktop = useIsDesktopPanel();
	const definition = rightPanel ? getRightPanelDefinition(rightPanel) : null;
	const PanelContent = definition?.component;
	const panelGroup = rightPanel ? getRightPanelGroup(rightPanel) : undefined;
	const groupTabs = useMemo(
		() =>
			panelGroup && panelGroup.panels.length > 1
				? panelGroup.panels.map((panel) => ({ id: panel, label: GROUP_VIEW_LABELS[panel] }))
				: [],
		[panelGroup],
	);
	const content = (
		<>
			{groupTabs.length > 0 ? (
				<TabStrip
					ariaLabel={`${panelGroup?.title ?? "Panel"} views`}
					className="mb-3 w-fit"
					onValueChange={(nextPanel) => {
						const next = groupTabs.find((tab) => tab.id === nextPanel)?.id;
						if (next) setRightPanel(next);
					}}
					tabs={groupTabs}
					value={rightPanel}
					width="fit"
				/>
			) : null}
			{PanelContent ? <PanelContent /> : null}
		</>
	);
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
					onWidthChange={onResourceCanvasWidthChange}
					open={panelOpen}
					title={definition?.title ?? ""}
					titleIcon={definition?.icon ?? Library}
					width={resourceCanvasWidth}
				>
					{content}
				</ResizableCanvas>
			) : (
				<MobilePanel
					dataTestid={definition?.mobileDataTestid}
					icon={definition?.icon}
					onClose={onClose}
					open={panelOpen}
					title={definition?.title ?? ""}
				>
					{content}
				</MobilePanel>
			)}
		</>
	);
}
