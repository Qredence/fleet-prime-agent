import type { WorkspaceTreeResponse } from "@prime-agent/web-protocol/chat-protocol";
import { describe, expect, it } from "vitest";
import { buildWorkspaceReferenceSuggestions, workspacePathFromSuggestion } from "./workspace-suggestions";

const workspace: WorkspaceTreeResponse = {
	root: "/workspace",
	diagnostics: [],
	nodes: [
		{
			name: "src",
			path: "src",
			type: "directory",
			children: [{ name: "main.ts", path: "src/main.ts", type: "file" }],
		},
	],
};

describe("workspace reference suggestions", () => {
	it("flattens folders and files with searchable context", () => {
		const suggestions = buildWorkspaceReferenceSuggestions(workspace);

		expect(suggestions).toHaveLength(2);
		expect(suggestions[0]).toMatchObject({
			id: "workspace:src",
			label: "src",
			description: "Folder",
			metadata: { kind: "folder" },
		});
		expect(suggestions[1]).toMatchObject({
			id: "workspace:src/main.ts",
			label: "src/main.ts",
			description: "Workspace file",
			metadata: { kind: "file" },
		});
	});

	it("accepts contained paths and rejects external or malformed references", () => {
		const suggestions = buildWorkspaceReferenceSuggestions(workspace);
		expect(workspacePathFromSuggestion(suggestions[1])).toBe("src/main.ts");
		expect(workspacePathFromSuggestion({ id: "workspace:../secrets.txt", label: "../secrets.txt" })).toBeNull();
		expect(workspacePathFromSuggestion({ id: "workspace:/etc/passwd", label: "/etc/passwd" })).toBeNull();
		expect(workspacePathFromSuggestion({ id: "other:src/main.ts", label: "src/main.ts" })).toBeNull();
	});
});
