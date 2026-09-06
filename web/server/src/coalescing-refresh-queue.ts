/**
 * Coalesces repeated refresh requests for the same key while guaranteeing a
 * request received during an active refresh runs once more before settling.
 */
export class CoalescingRefreshQueue {
	readonly #inFlight = new Map<string, Promise<void>>();
	readonly #pending = new Set<string>();

	request(key: string, refresh: () => Promise<void>): void {
		this.#pending.add(key);
		if (this.#inFlight.has(key)) return;
		const run = (async () => {
			while (this.#pending.delete(key)) {
				try {
					await refresh();
				} catch {
					// Keep draining requests queued while a refresh was in flight.
				}
			}
		})();
		this.#inFlight.set(key, run);
		void run
			.finally(() => {
				if (this.#inFlight.get(key) === run) this.#inFlight.delete(key);
			})
			.catch(() => undefined);
	}

	clear(): void {
		this.#inFlight.clear();
		this.#pending.clear();
	}
}
