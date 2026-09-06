import { describe, expect, it } from "vitest";
import { activityLabelFor, activitySummary } from "./chat-activity";

describe("chat activity presentation", () => {
	it("summarizes empty, single, and concurrent activity", () => {
		expect(activityLabelFor([])).toBe("Working through the run…");
		expect(activityLabelFor([{ type: "search" } as never])).toBe("Checking a source…");
		expect(activityLabelFor([{ type: "tool", action: "files" } as never])).toBe("Working with files…");
		expect(activityLabelFor([{ type: "tool" } as never, { type: "search" } as never])).toBe(
			"Coordinating 2 active actions…",
		);
	});

	it("uses stable completion summaries", () => {
		expect(activitySummary([{ type: "tool" } as never])).toBe("Completed 1 tracked action");
		expect(activitySummary([{ type: "tool" } as never, { type: "search" } as never])).toBe(
			"Completed 2 tracked actions",
		);
	});
});
