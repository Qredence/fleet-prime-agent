import { describe, expect, it } from "vitest";
import { RingBuffer } from "../ring-buffer";

describe("byte-bounded replay", () => {
	it("enforces both frame count and UTF-8 serialized size including decoration", () => {
		const buffer = new RingBuffer(2, 100);
		for (let index = 0; index < 10; index++)
			buffer.push({ text: "🙂".repeat(5) }, (sequence) => ({ text: "🙂".repeat(5), sequence }));
		const { replayed, overflowed } = buffer.replaySince(0);
		expect(buffer.size()).toBeLessThanOrEqual(2);
		expect(buffer.retainedBytes()).toBeLessThanOrEqual(100);
		expect(buffer.retainedBytes()).toBe(
			replayed.reduce((size, entry) => size + Buffer.byteLength(JSON.stringify(entry.event), "utf8"), 0),
		);
		expect(overflowed).toBe(true);
		expect(buffer.latestSequence()).toBe(10);
	});

	it("drops an oversized frame, invalidates older replay, and preserves the high-water mark", () => {
		const buffer = new RingBuffer(500, 50);
		buffer.push({ text: "before" });
		buffer.push({ text: "x".repeat(100) });
		expect(buffer.size()).toBe(0);
		expect(buffer.retainedBytes()).toBe(0);
		expect(buffer.replaySince(0)).toEqual({ replayed: [], overflowed: true, latestSequence: 2 });
		expect(buffer.replaySince(2).overflowed).toBe(false);
		buffer.push({ text: "after" });
		expect(buffer.replaySince(0).overflowed).toBe(true);
		expect(buffer.replaySince(2)).toEqual({
			replayed: [{ seq: 3, event: { text: "after" } }],
			overflowed: false,
			latestSequence: 3,
		});
	});

	it("resets byte accounting, sequence and generation together", () => {
		const buffer = new RingBuffer(2, 100);
		const generation = buffer.streamGeneration;
		buffer.push({ text: "hello" });
		buffer.clear();
		expect(buffer.retainedBytes()).toBe(0);
		expect(buffer.latestSequence()).toBe(0);
		expect(buffer.streamGeneration).not.toBe(generation);
		expect(buffer.replaySince(0).overflowed).toBe(false);
	});
});
