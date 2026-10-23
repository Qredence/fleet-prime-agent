/**
 * Ring buffer for SSE replay.
 *
 * Each frame is stored with a monotonically increasing `seq` chosen by the
 * owning session. Clients reconnect with `Last-Event-ID: <last seq>` and we
 * replay everything strictly greater than that. Overflow (oldest evicted)
 * triggers an `agent_settled` notification so the client refetches `/session`.
 */
export interface RingBufferEntry {
	readonly seq: number;
	readonly event: unknown;
}

export class RingBuffer {
	private readonly entries: RingBufferEntry[] = [];
	private readonly capacity: number;
	private nextSeq = 1;
	private generation = crypto.randomUUID();

	constructor(capacity = 500) {
		this.capacity = Math.max(1, capacity);
	}

	get streamGeneration(): string {
		return this.generation;
	}

	push(event: unknown): RingBufferEntry {
		const entry: RingBufferEntry = { seq: this.nextSeq++, event };
		this.entries.push(entry);
		if (this.entries.length > this.capacity) {
			this.entries.splice(0, this.entries.length - this.capacity);
		}
		return entry;
	}

	/**
	 * Replay entries with seq > `lastEventId`. If `lastEventId` is behind the
	 * oldest retained entry or ahead of the current sequence (for example after a
	 * process restart), return `{ replayed, overflowed: true }` so the caller
	 * emits a resync frame and instructs the client to rehydrate.
	 */
	replaySince(lastEventId: number): {
		replayed: readonly RingBufferEntry[];
		overflowed: boolean;
	} {
		const latest = this.latestSequence();
		if (lastEventId > latest) {
			return { replayed: [...this.entries], overflowed: true };
		}
		const oldest = this.entries[0];
		if (!oldest) return { replayed: [], overflowed: false };
		if (lastEventId < oldest.seq - 1) {
			return { replayed: [...this.entries], overflowed: true };
		}
		return {
			replayed: this.entries.filter((entry) => entry.seq > lastEventId),
			overflowed: false,
		};
	}

	size(): number {
		return this.entries.length;
	}

	latestSequence(): number {
		return this.entries.at(-1)?.seq ?? 0;
	}

	clear(): void {
		this.entries.length = 0;
		this.nextSeq = 1;
		this.generation = crypto.randomUUID();
	}
}
