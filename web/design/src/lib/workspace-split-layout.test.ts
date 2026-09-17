import { describe, expect, it } from "vitest";
import { workspaceSplitGridStyle } from "../components/qredence-ui/panels/hooks/use-workspace-split-layout";
import { clampWorkspaceTreeWidth, nextWorkspaceTreeWidthFromPointer } from "./workspace-tree-width";

describe("workspace split layout helpers", () => {
	it("applies columns only in split mode (no stacked areas / phantom handle row)", () => {
		expect(workspaceSplitGridStyle(false, 200)).toBeUndefined();
		expect(workspaceSplitGridStyle(true, 220)).toEqual({
			gridTemplateColumns: "minmax(160px, 1fr) 8px 220px",
		});
	});

	it("grows the right-side tree when the pointer moves left", () => {
		const containerWidth = 800;
		const startWidth = 200;
		expect(nextWorkspaceTreeWidthFromPointer(100, 140, startWidth, containerWidth)).toBe(240);
		expect(nextWorkspaceTreeWidthFromPointer(180, 140, startWidth, containerWidth)).toBe(160);
	});

	it("clamps tree width so the preview keeps a minimum", () => {
		expect(clampWorkspaceTreeWidth(900, 400)).toBe(400 - 160 - 8);
		expect(clampWorkspaceTreeWidth(40, 400)).toBe(120);
	});
});
