import { describe, expect, it, vi } from "vitest";
import { CoalescingRefreshQueue } from "../coalescing-refresh-queue";

describe("CoalescingRefreshQueue", () => {
	it("coalesces concurrent requests and reruns once when requested during a refresh", async () => {
		let release!: () => void;
		const first = new Promise<void>((resolve) => {
			release = resolve;
		});
		const refresh = vi.fn(async () => {
			if (refresh.mock.calls.length === 1) await first;
		});
		const queue = new CoalescingRefreshQueue();
		queue.request("session-1", refresh);
		queue.request("session-1", refresh);
		await Promise.resolve();
		expect(refresh).toHaveBeenCalledTimes(1);

		queue.request("session-1", refresh);
		release();
		await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
	});
});
