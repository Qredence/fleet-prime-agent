import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { startHorizontalResize } from "@/lib/horizontal-resize";
import { WORKSPACE_SPLIT_MIN_WIDTH_PX } from "@/lib/layout-constants";
import { readStoredWidth, storeStoredWidth } from "@/lib/stored-width";

const WORKSPACE_TREE_WIDTH_STORAGE_KEY = "fleet-prime:v1:workspace-tree-width";
const WORKSPACE_TREE_MIN_WIDTH = 120;
const WORKSPACE_TREE_DEFAULT_WIDTH = 200;

/** Minimum preview column width in the workspace split — shared by clamp + grid style. */
export const WORKSPACE_PREVIEW_MIN_WIDTH_PX = 160;
/** Resize handle column width — shared by clamp + grid style. */
export const WORKSPACE_SPLIT_HANDLE_WIDTH_PX = 8;

/** Clamps a workspace-tree width so the split preview retains its minimum width. */
export function clampWorkspaceTreeWidth(width: number, containerWidth: number) {
	const maxWidth = Math.max(
		WORKSPACE_TREE_MIN_WIDTH,
		containerWidth - WORKSPACE_PREVIEW_MIN_WIDTH_PX - WORKSPACE_SPLIT_HANDLE_WIDTH_PX,
	);
	return Math.min(maxWidth, Math.max(WORKSPACE_TREE_MIN_WIDTH, Math.round(width)));
}

/** Tree sits on the right of the preview: drag the handle left to grow the tree. */
export function nextWorkspaceTreeWidthFromPointer(
	clientX: number,
	startX: number,
	width: number,
	containerWidth: number,
) {
	return clampWorkspaceTreeWidth(width + (startX - clientX), containerWidth);
}

/** Returns preview-left/tree-right grid styles in split mode, or `undefined` for the default stacked flow. */
export function workspaceSplitGridStyle(isSplitLayout: boolean, treeWidth: number): CSSProperties | undefined {
	if (!isSplitLayout) return undefined;
	return {
		gridTemplateColumns: `minmax(${WORKSPACE_PREVIEW_MIN_WIDTH_PX}px, 1fr) ${WORKSPACE_SPLIT_HANDLE_WIDTH_PX}px ${treeWidth}px`,
	};
}

export function readStoredWorkspaceTreeWidth(containerWidth?: number) {
	return readStoredWidth(WORKSPACE_TREE_WIDTH_STORAGE_KEY, WORKSPACE_TREE_DEFAULT_WIDTH, (width) =>
		containerWidth === undefined
			? Math.max(WORKSPACE_TREE_MIN_WIDTH, Math.round(width))
			: clampWorkspaceTreeWidth(width, containerWidth),
	);
}

export function storeWorkspaceTreeWidth(width: number) {
	storeStoredWidth(WORKSPACE_TREE_WIDTH_STORAGE_KEY, width);
}

const subscribeWorkspaceSplit = (onChange: () => void) => {
	const media = window.matchMedia(`(min-width: ${WORKSPACE_SPLIT_MIN_WIDTH_PX}px)`);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
};
const getWorkspaceSplitSnapshot = () => window.matchMedia(`(min-width: ${WORKSPACE_SPLIT_MIN_WIDTH_PX}px)`).matches;
// Server/initial-hydration value: stacked. Keeps SSR HTML and the hydration
// render identical; the post-hydration flip carries no mismatch recovery.
const getServerWorkspaceSplitSnapshot = () => false;

/**
 * Tracks the responsive workspace split and its persisted tree width.
 *
 * @returns The split state, container ref, resize handler, and active grid style.
 */
export function useWorkspaceSplitLayout() {
	const [treeWidth, setTreeWidth] = useState(readStoredWorkspaceTreeWidth);
	const isSplitLayout = useSyncExternalStore(
		subscribeWorkspaceSplit,
		getWorkspaceSplitSnapshot,
		getServerWorkspaceSplitSnapshot,
	);
	const splitRef = useRef<HTMLDivElement | null>(null);

	const handleTreeResizeStart = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const containerWidth = splitRef.current?.clientWidth ?? 0;
			if (containerWidth === 0) return;

			const startWidth = clampWorkspaceTreeWidth(treeWidth, containerWidth);

			startHorizontalResize({
				event,
				startWidth,
				getNextWidth: (clientX, startX, width) =>
					nextWorkspaceTreeWidthFromPointer(clientX, startX, width, containerWidth),
				onWidthChange: (nextWidth) => {
					setTreeWidth(nextWidth);
					storeWorkspaceTreeWidth(nextWidth);
				},
			});
		},
		[treeWidth],
	);

	useEffect(() => {
		const split = splitRef.current;
		if (!split) return;

		const containerWidth = split.clientWidth;
		if (containerWidth < WORKSPACE_SPLIT_MIN_WIDTH_PX) return;

		setTreeWidth((currentWidth) => {
			const nextWidth = clampWorkspaceTreeWidth(currentWidth, containerWidth);
			if (nextWidth === currentWidth) return currentWidth;
			storeWorkspaceTreeWidth(nextWidth);
			return nextWidth;
		});
	}, []);

	return {
		handleTreeResizeStart,
		isSplitLayout,
		splitRef,
		splitStyle: workspaceSplitGridStyle(isSplitLayout, treeWidth),
	};
}
