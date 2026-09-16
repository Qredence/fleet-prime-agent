import { describe, expect, it } from "vitest";
import {
	SessionTreeNavigateRequestSchema,
	SessionTreeNavigateResponseSchema,
	SessionTreeSnapshotResponseSchema,
	SessionTreeSnapshotSchema,
} from "../schemas/session-tree";

describe("session tree schemas", () => {
	it("accepts a nested browser-safe snapshot", () => {
		const parsed = SessionTreeSnapshotSchema.safeParse({
			sessionId: "session-1",
			leafId: "entry-2",
			nodes: [
				{
					id: "entry-1",
					kind: "message",
					role: "user",
					label: "message",
					preview: "user: hello",
					isLeaf: false,
					isOnActiveBranch: true,
					messageIndex: 0,
					children: [
						{
							id: "entry-2",
							kind: "message",
							role: "assistant",
							label: "message",
							preview: "assistant: hi",
							isLeaf: true,
							isOnActiveBranch: true,
							messageIndex: 1,
							children: [],
						},
					],
				},
			],
		});
		expect(parsed.success).toBe(true);
	});

	it("validates read and navigate wire envelopes", () => {
		const snapshot = {
			sessionId: "session-1",
			leafId: null,
			nodes: [],
		};
		expect(SessionTreeSnapshotResponseSchema.safeParse({ snapshot }).success).toBe(true);
		expect(
			SessionTreeNavigateRequestSchema.safeParse({
				sessionId: "session-1",
				targetEntryId: "entry-1",
			}).success,
		).toBe(true);
		expect(SessionTreeNavigateResponseSchema.safeParse({ snapshot }).success).toBe(true);
	});
});
