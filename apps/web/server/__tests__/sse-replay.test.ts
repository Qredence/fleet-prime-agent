import { describe, expect, it } from "vitest"
import { shouldReplaySseEvent } from "../sse-replay"

describe("shouldReplaySseEvent", () => {
	it("replays every event when not an initial-client filter", () => {
		expect(
			shouldReplaySseEvent(
				{ type: "tool", part: { type: "tool-Question", toolCallId: "q1" } },
				null,
			),
		).toBe(true)
	})

	it("replays non-question events for first-time clients", () => {
		expect(
			shouldReplaySseEvent({ type: "delta", text: "hi" }, new Set(["q1"])),
		).toBe(true)
	})

	it("replays only still-pending questions for first-time clients", () => {
		const pending = new Set(["open"])
		expect(
			shouldReplaySseEvent(
				{ type: "tool", part: { type: "tool-Question", toolCallId: "open" } },
				pending,
			),
		).toBe(true)
		expect(
			shouldReplaySseEvent(
				{ type: "tool", part: { type: "tool-Question", toolCallId: "answered" } },
				pending,
			),
		).toBe(false)
	})
})
