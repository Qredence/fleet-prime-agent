import { readStoredWidth, storeStoredWidth } from "./stored-width";

const WORKSPACE_TREE_WIDTH_STORAGE_KEY = "fleet-prime:v1:workspace-tree-width";
const WORKSPACE_TREE_MIN_WIDTH = 120;
const WORKSPACE_TREE_DEFAULT_WIDTH = 200;
const WORKSPACE_PREVIEW_MIN_WIDTH = 160;
const WORKSPACE_SPLIT_HANDLE_WIDTH_PX = 8;

export function clampWorkspaceTreeWidth(width: number, containerWidth: number) {
	const maxWidth = Math.max(
		WORKSPACE_TREE_MIN_WIDTH,
		containerWidth - WORKSPACE_PREVIEW_MIN_WIDTH - WORKSPACE_SPLIT_HANDLE_WIDTH_PX,
	);
	return Math.min(maxWidth, Math.max(WORKSPACE_TREE_MIN_WIDTH, Math.round(width)));
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
