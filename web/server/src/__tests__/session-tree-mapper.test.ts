import { describe, expect, it } from "vitest";
import { mapSessionTreeSnapshot, messageIdForSessionTreeEntry } from "../session-tree-mapper";

const tree = [
	{
		entry: { id: "root-user", type: "message", message: { role: "user", content: "first question" } },
		children: [
			{
				entry: {
					id: "root-assistant",
					type: "message",
					message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
				},
				children: [
					{
						entry: { id: "branch-user", type: "message", message: { role: "user", content: "second question" } },
						children: [
							{
								entry: {
									id: "branch-assistant",
									type: "message",
									message: { role: "assistant", content: [{ type: "text", text: "second answer" }] },
								},
								children: [],
							},
						],
					},
					{
						entry: { id: "alt-user", type: "message", message: { role: "user", content: "alternate branch" } },
						children: [
							{
								entry: {
									id: "alt-assistant",
									type: "message",
									message: { role: "assistant", content: [{ type: "text", text: "alternate answer" }] },
								},
								children: [],
							},
						],
					},
				],
			},
		],
	},
];

describe("mapSessionTreeSnapshot", () => {
	it("marks the active branch and maps message indices for transcript hydration", () => {
		const snapshot = mapSessionTreeSnapshot("session-1", tree, "branch-assistant");
		expect(snapshot.leafId).toBe("branch-assistant");
		const branchAssistant = snapshot.nodes[0]?.children[0]?.children[0]?.children[0];
		expect(branchAssistant?.isLeaf).toBe(true);
		expect(branchAssistant?.isOnActiveBranch).toBe(true);
		expect(branchAssistant?.messageIndex).toBe(3);
		const altAssistant = snapshot.nodes[0]?.children[0]?.children[1]?.children[0];
		expect(altAssistant?.isOnActiveBranch).toBe(false);
		expect(altAssistant?.messageIndex).toBeUndefined();
	});

	it("resolves hydrated transcript message ids from entry ids", () => {
		const snapshot = mapSessionTreeSnapshot("session-1", tree, "branch-assistant");
		expect(messageIdForSessionTreeEntry("session-1", snapshot, "root-user")).toBe("session-1-m0");
		expect(messageIdForSessionTreeEntry("session-1", snapshot, "branch-assistant")).toBe("session-1-m3");
		expect(messageIdForSessionTreeEntry("session-1", snapshot, "alt-assistant")).toBeUndefined();
	});
});
