import { describe, expect, it } from "vitest";
import {
	clampWorkspaceTreeWidth,
	nextWorkspaceTreeWidthFromPointer,
	WORKSPACE_PREVIEW_MIN_WIDTH_PX,
	WORKSPACE_SPLIT_HANDLE_WIDTH_PX,
	workspaceSplitGridStyle,
} from "./workspace-tree-width";

describe("workspace split layout helpers", () => {
	it("applies columns and areas only in split mode (stable DOM, no stacked phantom handle)", () => {
		expect(workspaceSplitGridStyle(false, 200)).toBeUndefined();
		expect(workspaceSplitGridStyle(true, 220)).toEqual({
			gridTemplateColumns: `minmax(${WORKSPACE_PREVIEW_MIN_WIDTH_PX}px, 1fr) ${WORKSPACE_SPLIT_HANDLE_WIDTH_PX}px 220px`,
			gridTemplateAreas: `"preview handle tree"`,
		});
	});

	it("grows the right-side tree when the pointer moves left", () => {
		const containerWidth = 800;
		const startWidth = 200;
		expect(nextWorkspaceTreeWidthFromPointer(100, 140, startWidth, containerWidth)).toBe(240);
		expect(nextWorkspaceTreeWidthFromPointer(180, 140, startWidth, containerWidth)).toBe(160);
	});

	it("clamps tree width so the preview keeps a minimum", () => {
		expect(clampWorkspaceTreeWidth(900, 400)).toBe(
			400 - WORKSPACE_PREVIEW_MIN_WIDTH_PX - WORKSPACE_SPLIT_HANDLE_WIDTH_PX,
		);
		expect(clampWorkspaceTreeWidth(40, 400)).toBe(120);
	});
});
