import type { CSSProperties } from "react";
import { readStoredWidth, storeStoredWidth } from "./stored-width";

const WORKSPACE_TREE_WIDTH_STORAGE_KEY = "fleet-prime:v1:workspace-tree-width";
const WORKSPACE_TREE_MIN_WIDTH = 120;
const WORKSPACE_TREE_DEFAULT_WIDTH = 200;

/** Minimum preview column width in the workspace split — shared by clamp + grid style. */
export const WORKSPACE_PREVIEW_MIN_WIDTH_PX = 160;
/** Resize handle column width — shared by clamp + grid style. */
export const WORKSPACE_SPLIT_HANDLE_WIDTH_PX = 8;

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

/**
 * Split mode places preview | handle | tree via areas while DOM stays
 * tree → handle → preview (stable identity across the 640px breakpoint).
 * Stacked leaves style undefined so auto-flow + gap apply without a phantom handle row.
 */
export function workspaceSplitGridStyle(isSplitLayout: boolean, treeWidth: number): CSSProperties | undefined {
	if (!isSplitLayout) return undefined;
	return {
		gridTemplateColumns: `minmax(${WORKSPACE_PREVIEW_MIN_WIDTH_PX}px, 1fr) ${WORKSPACE_SPLIT_HANDLE_WIDTH_PX}px ${treeWidth}px`,
		gridTemplateAreas: `"preview handle tree"`,
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
