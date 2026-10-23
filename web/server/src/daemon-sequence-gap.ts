/**
 * Per-session `meta.sequence` gap detection for raw daemon frames.
 *
 * The v0.10.1 Rust daemon can drop session events emitted between an attach
 * snapshot and the subscriber registration, and a reconnect with a resume
 * cursor replays nothing (`replay.status: "unavailable"`). The only sign of
 * lost events is a jump in `meta.sequence` within one cursor generation.
 *
 * Sequence rule (prime-agent v0.10.1, tag 8aac8692):
 *  - Only streaming `message_update` deltas are parked for batching. Each
 *    parked delta consumes a sequence number and the merged frame carries the
 *    newest parked sequence (crates/pa-daemon/src/worker/turn.rs:754-768,
 *    streaming.rs:82-89,155-157). So a jump that lands on a `message_update`
 *    is batching, not loss: no gap.
 *  - `start` and `*_end` flush parked updates first and then go out directly;
 *    every other frame consumes exactly one sequence. A jump that lands on any
 *    other frame type (tool_execution_end, turn_end, message_end, …) is real
 *    loss: gap → resync.
 *  - When a turn closes, parked updates are dropped (streaming.rs:126-133), so
 *    the jump after an abort is benign, but it lands on a non-update frame and
 *    is reported like any other gap. A resync there is harmless; deliberately
 *    not special-cased.
 *
 * The stock DaemonAgentConnection strips `meta` before events reach the event
 * mapper, so detection runs on the raw frame channel (daemon-runtime's
 * `onFrame`). Surfacing a gap reuses the existing resync path: the bridge
 * fetches `connection.getInitialSnapshot()` and maps
 * `{ type: "session_resynced", snapshot }`, which emits a presentation update
 * and a `done` frame with `sessionReset: true` (no new ChatStreamEvent).
 * See `resyncAfterSequenceGap` in event-mapper.ts.
 *
 * Wiring: daemon-runtime.ts subscribes one tracker per daemon socket (before
 * attach) and exposes `onSequenceGap` next to `onSessionBinding`, filtered to
 * the active session; prime-bridge.ts resyncs on each gap.
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
			// A new worker generation restarts the counter (not a gap). Generation
			// comes from `meta.cursor.generation` (protocol 7 captures) or a
			// top-level `meta.generation`.
			const fromCursor = cursorOf(meta.cursor);
			const metaGeneration = typeof meta.generation === "string" ? meta.generation : undefined;
			const current: Position | undefined = fromCursor
				? { ...fromCursor, generation: fromCursor.generation ?? metaGeneration }
				: typeof meta.sequence === "number"
					? { generation: metaGeneration, sequence: meta.sequence }
					: undefined;
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
			// Batching: parked deltas consumed the skipped sequences (see rule above).
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
