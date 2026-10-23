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

	it("aligns message indices across toolResult, hidden custom_message, and compaction boundaries", () => {
		const compactedTree = [
			{
				entry: { id: "dropped-user", type: "message", message: { role: "user", content: "old turn" } },
				children: [
					{
						entry: {
							id: "kept-user",
							type: "message",
							parentId: "dropped-user",
							message: { role: "user", content: "kept turn" },
						},
						children: [
							{
								entry: {
									id: "compaction-1",
									type: "compaction",
									parentId: "kept-user",
									firstKeptEntryId: "kept-user",
									summary: "compacted summary",
								},
								children: [
									{
										entry: {
											id: "hidden-digest",
											type: "custom_message",
											parentId: "compaction-1",
											customType: "harness_digest",
											display: false,
										},
										children: [
											{
												entry: {
													id: "assistant-tool",
													type: "message",
													parentId: "hidden-digest",
													message: {
														role: "assistant",
														content: [{ type: "toolCall", id: "tc-1", name: "bash", arguments: {} }],
													},
												},
												children: [
													{
														entry: {
															id: "tool-result",
															type: "message",
															parentId: "assistant-tool",
															message: { role: "toolResult", toolCallId: "tc-1", content: "ok" },
														},
														children: [
															{
																entry: {
																	id: "followup-user",
																	type: "message",
																	parentId: "tool-result",
																	message: { role: "user", content: "next question" },
																},
																children: [],
															},
														],
													},
												],
											},
										],
									},
								],
							},
						],
					},
				],
			},
		];

		const snapshot = mapSessionTreeSnapshot("session-2", compactedTree, "followup-user");
		// Pre-compaction dropped message has no hydrated message id
		expect(messageIdForSessionTreeEntry("session-2", snapshot, "dropped-user")).toBeUndefined();
		// Compaction summary is at index 0, kept-user at 1, hidden-digest skipped at 2,
		// assistant-tool at 3, tool-result attached to assistant-tool (3), followup-user at 5
		expect(messageIdForSessionTreeEntry("session-2", snapshot, "compaction-1")).toBe("session-2-m0");
		expect(messageIdForSessionTreeEntry("session-2", snapshot, "kept-user")).toBe("session-2-m1");
		expect(messageIdForSessionTreeEntry("session-2", snapshot, "hidden-digest")).toBeUndefined();
		expect(messageIdForSessionTreeEntry("session-2", snapshot, "assistant-tool")).toBe("session-2-m3");
		expect(messageIdForSessionTreeEntry("session-2", snapshot, "tool-result")).toBe("session-2-m3");
		expect(messageIdForSessionTreeEntry("session-2", snapshot, "followup-user")).toBe("session-2-m5");
	});
});
