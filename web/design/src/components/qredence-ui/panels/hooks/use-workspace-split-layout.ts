import type { WorkspaceTreeResponse } from "@prime-agent/web-protocol/chat-protocol";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { startHorizontalResize } from "../../../../lib/horizontal-resize";
import { WORKSPACE_SPLIT_MIN_WIDTH_PX } from "../../../../lib/layout-constants";
import {
	clampWorkspaceTreeWidth,
	nextWorkspaceTreeWidthFromPointer,
	readStoredWorkspaceTreeWidth,
	storeWorkspaceTreeWidth,
} from "../../../../lib/workspace-tree-width";

const subscribeWorkspaceSplit = (onChange: () => void) => {
	const media = window.matchMedia(`(min-width: ${WORKSPACE_SPLIT_MIN_WIDTH_PX}px)`);
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
};
const getWorkspaceSplitSnapshot = () => window.matchMedia(`(min-width: ${WORKSPACE_SPLIT_MIN_WIDTH_PX}px)`).matches;
// Server/initial-hydration value: stacked. Keeps SSR HTML and the hydration
// render identical; the post-hydration flip carries no mismatch recovery.
const getServerWorkspaceSplitSnapshot = () => false;

/** Columns for split mode. Stacked leaves style undefined so DOM order drives layout. */
export function workspaceSplitGridStyle(isSplitLayout: boolean, treeWidth: number): CSSProperties | undefined {
	if (!isSplitLayout) return undefined;
	return {
		gridTemplateColumns: `minmax(160px, 1fr) 8px ${treeWidth}px`,
	};
}

export function useWorkspaceSplitLayout(_workspace: WorkspaceTreeResponse | null) {
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
