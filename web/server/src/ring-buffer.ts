/** Bounded in-memory SSE replay. Bytes estimate serialized UTF-8 payload, not total JS heap. */
export interface RingBufferEntry {
	readonly seq: number;
	readonly event: unknown;
}

export class RingBuffer {
	private readonly entries: Array<{ entry: RingBufferEntry; bytes: number }> = [];
	private readonly capacity: number;
	private readonly maxBytes: number;
	private bytes = 0;
	private nextSeq = 1;
	private generation = crypto.randomUUID();

	constructor(capacity = 500, maxBytes = 1024 * 1024) {
		this.capacity = Math.max(1, capacity);
		this.maxBytes = Math.max(1, maxBytes);
	}

	get streamGeneration(): string {
		return this.generation;
	}

	push(event: unknown, decorate?: (seq: number, generation: string) => unknown): RingBufferEntry {
		const seq = this.nextSeq++;
		const entry = { seq, event: decorate ? decorate(seq, this.generation) : event };
		let bytes: number;
		try {
			bytes = Buffer.byteLength(JSON.stringify(entry.event) ?? "", "utf8");
		} catch {
			bytes = Infinity;
		}
		if (bytes > this.maxBytes) {
			// A missing frame makes older replay unusable. Keep the sequence advancing
			// so subscribers receive an explicit resync, never an apparently complete replay.
			this.entries.length = 0;
			this.bytes = 0;
			return entry;
		}
		this.entries.push({ entry, bytes });
		this.bytes += bytes;
		while (this.entries.length > this.capacity || this.bytes > this.maxBytes) {
			this.bytes -= this.entries.shift()!.bytes;
		}
		return entry;
	}

	replaySince(lastEventId: number): {
		replayed: readonly RingBufferEntry[];
		overflowed: boolean;
		latestSequence: number;
	} {
		const latestSequence = this.latestSequence();
		const oldest = this.entries[0]?.entry.seq ?? this.nextSeq;
		const overflowed = lastEventId > latestSequence || lastEventId < oldest - 1;
		return {
			replayed: this.entries.filter(({ entry }) => overflowed || entry.seq > lastEventId).map(({ entry }) => entry),
			overflowed,
			latestSequence,
		};
	}

	size(): number {
		return this.entries.length;
	}
	retainedBytes(): number {
		return this.bytes;
	}
	latestSequence(): number {
		return this.nextSeq - 1;
	}

	clear(): void {
		this.entries.length = 0;
		this.bytes = 0;
		this.nextSeq = 1;
		this.generation = crypto.randomUUID();
	}
}
