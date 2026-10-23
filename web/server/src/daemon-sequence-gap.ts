/**
 * Per-session `meta.sequence` gap detection for raw daemon frames.
 *
 * The v0.10.1 Rust daemon can drop session events emitted between an attach
 * snapshot and the subscriber registration, and a reconnect with a resume
 * cursor replays nothing (`replay.status: "unavailable"`). The only sign of
 * lost events is a jump in `meta.sequence` within one cursor generation.
 *
 * Coalesced streaming deltas also consume sequence numbers: in the live
 * capture (real-turn-python-repl) every `message_update` lands after a jump
 * (5→8, 8→18, …) because the daemon batches deltas (≤1 per 50 ms) and the
 * merged update carries the full partial message. A jump that lands on a
 * `message_update` is therefore treated as coalescing, not loss.
 *
 * The stock DaemonAgentConnection strips `meta` before events reach the event
 * mapper, so detection runs on the raw frame channel (daemon-runtime's
 * `onFrame`). Surfacing a gap reuses the existing resync path: the bridge
 * fetches `connection.getInitialSnapshot()` and maps
 * `{ type: "session_resynced", snapshot }`, which emits a presentation update
 * and a `done` frame with `sessionReset: true` (no new ChatStreamEvent).
 * See `resyncAfterSequenceGap` in event-mapper.ts.
 *
 * TODO(R1 bridge): subscribe a tracker to each daemon connection's raw frames
 * (createReconfigurableConnection `onFrame` in daemon-runtime.ts), expose an
 * `onSequenceGap` callback next to `onSessionBinding`, and in prime-bridge.ts
 * call `resyncAfterSequenceGap` + dispatch the frames on a gap.
 */
import { isRecord } from "./transcript-hydrator";

export type DaemonSequenceGap = {
	activeSessionId: string;
	generation: string | undefined;
	/** Last sequence seen (event, snapshot, or attach baseline). */
	lastSequence: number;
	/** First sequence received after the gap. */
	receivedSequence: number;
	/** Number of sequences missing between the two. */
	missing: number;
};

type Position = { generation: string | undefined; sequence: number };

export type DaemonSequenceGapTracker = {
	/** Feed one raw daemon frame; returns a gap when this frame skipped sequences. */
	observe(frame: unknown): DaemonSequenceGap | undefined;
	/** Forget a session (closed, or re-bound to a new active id). */
	reset(activeSessionId?: string): void;
	/** Last position per session, for diagnostics and tests. */
	position(activeSessionId: string): Readonly<Position> | undefined;
};

function cursorOf(value: unknown): Position | undefined {
	if (!isRecord(value) || typeof value.sequence !== "number") return undefined;
	return { generation: typeof value.generation === "string" ? value.generation : undefined, sequence: value.sequence };
}

export function createDaemonSequenceGapTracker(onGap?: (gap: DaemonSequenceGap) => void): DaemonSequenceGapTracker {
	const positions = new Map<string, Position>();

	/** A snapshot or attach response sets the baseline; it never reports a gap. */
	const setBaseline = (activeSessionId: unknown, sequence: unknown, cursor: unknown) => {
		if (typeof activeSessionId !== "string") return;
		const fromCursor = cursorOf(cursor);
		const baseline: Position | undefined =
			fromCursor ?? (typeof sequence === "number" ? { generation: undefined, sequence } : undefined);
		if (baseline) positions.set(activeSessionId, baseline);
	};

	return {
		observe(frame) {
			if (!isRecord(frame)) return undefined;
			switch (frame.type) {
				case "session_binding":
					if (typeof frame.previousActiveSessionId === "string") positions.delete(frame.previousActiveSessionId);
					return undefined;
				case "session_snapshot_end":
					setBaseline(frame.activeSessionId, frame.lastEventSequence, frame.lastEventCursor);
					return undefined;
				case "response": {
					if (frame.command !== "attach" || frame.success !== true || !isRecord(frame.data)) return undefined;
					const data = frame.data;
					const snapshot = isRecord(data.snapshot) ? data.snapshot : {};
					setBaseline(
						data.activeSessionId,
						data.lastEventSequence ?? snapshot.lastEventSequence,
						data.lastEventCursor ?? snapshot.lastEventCursor,
					);
					return undefined;
				}
				default:
					break;
			}
			const meta = isRecord(frame.meta) ? frame.meta : undefined;
			if (!meta) return undefined;
			const activeSessionId =
				typeof frame.activeSessionId === "string"
					? frame.activeSessionId
					: typeof meta.activeSessionId === "string"
						? meta.activeSessionId
						: undefined;
			const current =
				cursorOf(meta.cursor) ??
				(typeof meta.sequence === "number" ? { generation: undefined, sequence: meta.sequence } : undefined);
			if (!activeSessionId || !current) return undefined;
			const previous = positions.get(activeSessionId);
			const sameGeneration =
				previous !== undefined &&
				(previous.generation === undefined ||
					current.generation === undefined ||
					previous.generation === current.generation);
			if (frame.type === "session_closed") positions.delete(activeSessionId);
			else if (!previous || !sameGeneration || current.sequence > previous.sequence)
				positions.set(activeSessionId, current);
			if (!previous || !sameGeneration || current.sequence <= previous.sequence + 1) return undefined;
			if (frame.type === "session_event" && isRecord(frame.event) && frame.event.type === "message_update") {
				return undefined;
			}
			const gap: DaemonSequenceGap = {
				activeSessionId,
				generation: current.generation ?? previous.generation,
				lastSequence: previous.sequence,
				receivedSequence: current.sequence,
				missing: current.sequence - previous.sequence - 1,
			};
			onGap?.(gap);
			return gap;
		},
		reset(activeSessionId) {
			if (activeSessionId === undefined) positions.clear();
			else positions.delete(activeSessionId);
		},
		position(activeSessionId) {
			return positions.get(activeSessionId);
		},
	};
}
