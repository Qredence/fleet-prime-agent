type RetainedSession = { lastUsed: number; holds: number; revision: number };

export type SessionRetentionOptions = {
	maxRetainedSessions?: number;
	idleSessionTtlMs?: number;
	sessionSweepIntervalMs?: number;
};

/** Idle LRU bookkeeping. Busy sessions may exceed the target; work is never evicted to enforce a hard cap. */
export class SessionRetention {
	readonly #entries = new Map<string, RetainedSession>();
	readonly #detaching = new Map<string, Promise<boolean>>();
	readonly #max: number;
	readonly #ttl: number;
	readonly #interval: number;
	readonly #detach: (id: string, stillIdle: () => boolean) => Promise<boolean>;
	#timer?: ReturnType<typeof setInterval>;
	#sweep?: Promise<void>;

	constructor(options: SessionRetentionOptions, detach: (id: string, stillIdle: () => boolean) => Promise<boolean>) {
		this.#max = Math.max(1, options.maxRetainedSessions ?? 64);
		this.#ttl = Math.max(1, options.idleSessionTtlMs ?? 30 * 60_000);
		this.#interval = Math.max(1, options.sessionSweepIntervalMs ?? 60_000);
		if (![this.#max, this.#ttl, this.#interval].every((value) => Number.isFinite(value) && Number.isInteger(value))) {
			throw new RangeError("Session retention limits must be finite integers");
		}
		this.#detach = detach;
	}

	register(id: string): void {
		this.#entries.set(id, { lastUsed: Date.now(), holds: 0, revision: 0 });
		if (!this.#timer) {
			this.#timer = setInterval(() => {
				void this.sweep();
			}, this.#interval);
			this.#timer.unref();
		}
	}

	touch(id: string): void {
		const entry = this.#entries.get(id);
		if (entry) {
			entry.lastUsed = Date.now();
			entry.revision++;
		}
	}

	retain(id: string): () => void {
		const entry = this.#entries.get(id);
		if (!entry) return () => {};
		this.touch(id);
		entry.holds++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			entry.holds--;
			if (this.#entries.get(id) === entry) this.touch(id);
		};
	}

	async waitForDetach(id: string): Promise<void> {
		await this.#detaching.get(id);
	}

	forget(id: string): void {
		this.#entries.delete(id);
		if (this.#entries.size === 0 && this.#timer) {
			clearInterval(this.#timer);
			this.#timer = undefined;
		}
	}

	sweep(): Promise<void> {
		if (this.#sweep) return this.#sweep;
		const sweep = this.#runSweep();
		this.#sweep = sweep;
		void sweep.finally(() => {
			if (this.#sweep === sweep) this.#sweep = undefined;
		});
		return sweep;
	}

	async #runSweep(): Promise<void> {
		const candidates = [...this.#entries].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
		for (const [id, entry] of candidates) {
			if (entry.holds || (this.#entries.size <= this.#max && Date.now() - entry.lastUsed < this.#ttl)) continue;
			const revision = entry.revision;
			const stillIdle = () => this.#entries.get(id) === entry && entry.holds === 0 && entry.revision === revision;
			const detaching = Promise.resolve()
				.then(() => this.#detach(id, stillIdle))
				.catch(() => false);
			this.#detaching.set(id, detaching);
			try {
				if ((await detaching) && this.#entries.get(id) === entry) this.forget(id);
			} finally {
				if (this.#detaching.get(id) === detaching) this.#detaching.delete(id);
			}
		}
	}

	clear(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = undefined;
		this.#entries.clear();
	}
}
