import type { ChatStreamEvent } from "@prime-agent/web-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingDialogRegistry } from "../pending-dialogs";
import { RingBuffer } from "../ring-buffer";

describe("RingBuffer", () => {
	it("stores entries in seq order", () => {
		const buf = new RingBuffer(10);
		buf.push({ a: 1 });
		buf.push({ a: 2 });
		expect(buf.size()).toBe(2);
	});

	it("evicts oldest on overflow", () => {
		const buf = new RingBuffer(2);
		buf.push({ a: 1 });
		buf.push({ a: 2 });
		buf.push({ a: 3 });
		expect(buf.size()).toBe(2);
		const { replayed, overflowed } = buf.replaySince(0);
		expect(overflowed).toBe(true);
		expect(replayed.map((e) => e.seq)).toEqual([2, 3]);
	});

	it("replays only entries strictly greater than lastEventId", () => {
		const buf = new RingBuffer(10);
		buf.push({ a: 1 });
		buf.push({ a: 2 });
		buf.push({ a: 3 });
		const { replayed } = buf.replaySince(1);
		expect(replayed.map((e) => e.seq)).toEqual([2, 3]);
	});

	it("reset clears nextSeq", () => {
		const buf = new RingBuffer(10);
		buf.push({ a: 1 });
		buf.clear();
		buf.push({ a: 2 });
		const { replayed } = buf.replaySince(0);
		expect(replayed[0]?.seq).toBe(1);
	});
});

describe("PendingDialogRegistry", () => {
	let registry: PendingDialogRegistry;
	let emitted: { sessionId: string; frame: ChatStreamEvent }[];

	beforeEach(() => {
		emitted = [];
		registry = new PendingDialogRegistry({
			defaultTimeoutMs: 25,
			emitFrame: (sessionId, frame) => emitted.push({ sessionId, frame }),
		});
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens a dialog and resolves on answer()", async () => {
		const promise = registry.open<{ choice: string }>({
			sessionId: "s1",
			toolCallId: "t1",
			kind: "select",
			title: "Pick",
			message: "",
			signalFrame: {
				type: "tool-Question",
				toolCallId: "t1",
				state: "input-streaming",
			},
		});
		expect(emitted).toHaveLength(1);

		const answered = registry.answer("s1", "t1", { choice: "alpha" });
		expect(answered).toBe(true);
		await expect(promise).resolves.toEqual({ choice: "alpha" });
	});

	it("auto-cancels after timeout", async () => {
		const promise = registry.open({
			sessionId: "s1",
			toolCallId: "t1",
			kind: "confirm",
			title: "Confirm?",
			message: "fire the laser?",
			signalFrame: {
				type: "tool-Question",
				toolCallId: "t1",
				state: "input-streaming",
			},
		});
		// Attach a resilient catch handler *before* advancing timers so the
		// rejection is accounted for when the timer fires.
		const assertion = expect(promise).rejects.toThrow(/timeout|cancelled/i);
		await vi.advanceTimersByTimeAsync(50);
		await assertion;
		// After timeout, answer() returns false so the route can 404.
		expect(registry.answer("s1", "t1", true)).toBe(false);
	});

	it("cancel() emits a tool-Question output-error frame", async () => {
		const promise = registry.open({
			sessionId: "s1",
			toolCallId: "t1",
			kind: "input",
			title: "Token",
			message: "",
			signalFrame: {
				type: "tool-Question",
				toolCallId: "t1",
				state: "input-streaming",
			},
		});
		registry.cancel("s1", "t1", "user-abort");
		await expect(promise).rejects.toThrow(/cancelled/i);
		expect(emitted.length).toBeGreaterThanOrEqual(2);
		const frame = emitted[1]!.frame;
		expect(frame.type).toBe("tool");
		if (frame.type === "tool") {
			expect(frame.part.type).toBe("tool-Question");
			expect(frame.part.state).toBe("output-error");
		}
	});

	it("handles interactive multi-question clarification dialogs and snapshot serialization", async () => {
		const questions = [
			{
				id: "q1",
				question: "Select database engine",
				options: ["PostgreSQL", "SQLite", "DuckDB"],
				isMultiSelect: false,
			},
			{
				id: "q2",
				question: "Select features to enable",
				options: ["Auth", "Telemetry", "Backups"],
				isMultiSelect: true,
			},
		];

		const promise = registry.open<{ answers: Record<string, unknown> }>({
			sessionId: "s1",
			toolCallId: "tool-q-1",
			kind: "questions",
			title: "Database Configuration",
			message: "Please specify database and optional components",
			questions,
			signalFrame: {
				type: "tool-Question",
				toolCallId: "tool-q-1",
				state: "input-streaming",
			},
		});

		const snap = registry.snapshot("s1");
		expect(snap).toHaveLength(1);
		expect(snap[0]).toMatchObject({
			sessionId: "s1",
			toolCallId: "tool-q-1",
			kind: "questions",
			title: "Database Configuration",
			questions,
		});

		const answerPayload = {
			answers: {
				q1: "PostgreSQL",
				q2: ["Auth", "Backups"],
			},
		};

		const answered = registry.answer("s1", "tool-q-1", answerPayload);
		expect(answered).toBe(true);
		await expect(promise).resolves.toEqual(answerPayload);
		expect(registry.snapshot("s1")).toHaveLength(0);
	});
});
