import { afterEach, expect, it, vi } from "vitest";
import { SessionRetention } from "../session-retention";
import { retainSessionInScope, withSessionLeaseScope } from "../session-lease-scope";

let retention: SessionRetention | undefined;
afterEach(() => {
	retention?.clear();
	vi.useRealTimers();
});

it("releases request holds on errors and does not reacquire them from late stream tasks", async () => {
	const release = vi.fn();
	const retain = vi.fn(() => release);
	let startLater!: () => void;
	let later!: Promise<void>;
	const gate = new Promise<void>((resolve) => {
		startLater = resolve;
	});
	await expect(
		withSessionLeaseScope(async () => {
			retainSessionInScope("one", retain);
			retainSessionInScope("one", retain);
			later = gate.then(() => retainSessionInScope("one", retain));
			throw new Error("invalid request");
		}),
	).rejects.toThrow("invalid request");
	startLater();
	await later;
	expect(retain).toHaveBeenCalledOnce();
	expect(release).toHaveBeenCalledOnce();
});

it("runs unref'd periodic maintenance and stops after the last idle record is detached", async () => {
	vi.useFakeTimers();
	const detach = vi.fn(async (_id: string, stillIdle: () => boolean) => stillIdle());
	retention = new SessionRetention({ idleSessionTtlMs: 100, sessionSweepIntervalMs: 100 }, detach);
	retention.register("one");
	await vi.advanceTimersByTimeAsync(100);
	expect(detach).toHaveBeenCalledOnce();
	await vi.advanceTimersByTimeAsync(1000);
	expect(detach).toHaveBeenCalledOnce();
});

it("allows protected sessions to exceed the target rather than evicting work", async () => {
	const detach = vi.fn(async () => true);
	retention = new SessionRetention({ maxRetainedSessions: 1 }, detach);
	retention.register("one");
	retention.register("two");
	const a = retention.retain("one");
	const b = retention.retain("two");
	await retention.sweep();
	expect(detach).not.toHaveBeenCalled();
	a();
	a();
	b();
});

it("coalesces maintenance and rejects a candidate touched while its state is inspected", async () => {
	let resume!: () => void;
	const inspect = new Promise<void>((resolve) => {
		resume = resolve;
	});
	const detach = vi.fn(async (_id: string, stillIdle: () => boolean) => {
		await inspect;
		return stillIdle();
	});
	retention = new SessionRetention({ maxRetainedSessions: 1 }, detach);
	retention.register("one");
	retention.register("two");
	const sweep = retention.sweep();
	expect(retention.sweep()).toBe(sweep);
	const release = retention.retain("one");
	resume();
	await sweep;
	expect(detach).toHaveBeenCalledTimes(2);
	release();
});
