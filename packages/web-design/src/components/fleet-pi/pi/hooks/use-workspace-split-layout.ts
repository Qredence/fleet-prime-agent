import type { WorkspaceTreeResponse } from "@prime-agent/web-protocol/chat-protocol";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { startHorizontalResize } from "../../../../lib/horizontal-resize";
import { WORKSPACE_SPLIT_MIN_WIDTH_PX } from "../../../../lib/layout-constants";
import {
	clampWorkspaceTreeWidth,
	readStoredWorkspaceTreeWidth,
	storeWorkspaceTreeWidth,
} from "../../../../lib/workspace-tree-width";

export function useWorkspaceSplitLayout(_workspace: WorkspaceTreeResponse | null) {
	const [treeWidth, setTreeWidth] = useState(readStoredWorkspaceTreeWidth);
	const [isSplitLayout, setIsSplitLayout] = useState(
		() =>
			typeof window !== "undefined" && window.matchMedia(`(min-width: ${WORKSPACE_SPLIT_MIN_WIDTH_PX}px)`).matches,
	);
	const splitRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const media = window.matchMedia(`(min-width: ${WORKSPACE_SPLIT_MIN_WIDTH_PX}px)`);
		const update = () => setIsSplitLayout(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	const handleTreeResizeStart = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const containerWidth = splitRef.current?.clientWidth ?? 0;
			if (containerWidth === 0) return;

			const startWidth = clampWorkspaceTreeWidth(treeWidth, containerWidth);

			startHorizontalResize({
				event,
				startWidth,
				getNextWidth: (clientX, startX, width) =>
					clampWorkspaceTreeWidth(width + (clientX - startX), containerWidth),
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

	const splitStyle = isSplitLayout
		? ({
				gridTemplateColumns: `${treeWidth}px 8px minmax(160px, 1fr)`,
			} satisfies CSSProperties)
		: undefined;

	return {
		handleTreeResizeStart,
		isSplitLayout,
		splitRef,
		splitStyle,
	};
}
