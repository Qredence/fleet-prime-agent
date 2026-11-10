import { describe, expect, it, vi } from "vitest";
import { PresentationPersistenceQueue } from "../prime-agent-presentation";
import type { PrimeAgentSessionPresentation } from "@prime-agent/web-protocol";

function presentation(revision: number): PrimeAgentSessionPresentation {
	return {
		revision,
		userBash: [],
		rlmChildren: [],
		refinements: [],
		artifactRuns: [],
	};
}

function queueWith(written: number[]) {
	return new PresentationPersistenceQueue({
		writePresentation: vi.fn(async ({ sessionPath }, value) => {
			written.push(value.revision);
			return sessionPath;
		}) as never,
		isCurrentSessionPath: () => true,
		onWriteWarning: () => undefined,
	});
}

describe("PresentationPersistenceQueue", () => {
	it("writes a persist issued while the previous drain is finishing", async () => {
		const written: number[] = [];
		const queue = queueWith(written);

		await queue.persist("session", "/tmp/session.jsonl", presentation(1));
		// The drain has finished writing but its finally-registered cleanup runs
		// one microtask later. A persist in that window must still be written.
		queue.persist("session", "/tmp/session.jsonl", presentation(2));
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(written).toEqual([1, 2]);
	});

	it("writes the latest presentation after an earlier write completes", async () => {
		const written: number[] = [];
		const queue = queueWith(written);

		const first = queue.persist("session", "/tmp/session.jsonl", presentation(1));
		queue.persist("session", "/tmp/session.jsonl", presentation(2));
		queue.persist("session", "/tmp/session.jsonl", presentation(3));
		await first;

		expect(written).toEqual([1, 3]);
	});

	it("writes a persist issued right after a drain that skipped its work", async () => {
		const written: number[] = [];
		let current = true;
		const queue = new PresentationPersistenceQueue({
			writePresentation: vi.fn(async ({ sessionPath }, value) => {
				written.push(value.revision);
				return sessionPath;
			}) as never,
			isCurrentSessionPath: () => current,
			onWriteWarning: () => undefined,
		});

		// This drain skips the write without awaiting, so it settles synchronously
		// and its cleanup reaction is still queued when the next persist arrives.
		current = false;
		queue.persist("session", "/tmp/session.jsonl", presentation(1));
		current = true;
		queue.persist("session", "/tmp/session.jsonl", presentation(2));
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(written).toEqual([2]);
	});

	it("drops a queued write once cancelAndDrain bumps the generation", async () => {
		const written: number[] = [];
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const queue = new PresentationPersistenceQueue({
			writePresentation: vi.fn(async ({ sessionPath }, value) => {
				written.push(value.revision);
				await gate;
				return sessionPath;
			}) as never,
			isCurrentSessionPath: () => true,
			onWriteWarning: () => undefined,
		});

		void queue.persist("session", "/tmp/session.jsonl", presentation(1));
		queue.persist("session", "/tmp/session.jsonl", presentation(2));
		const draining = queue.cancelAndDrain("session");
		release();
		await draining;

		expect(written).toEqual([1]);
	});
});
