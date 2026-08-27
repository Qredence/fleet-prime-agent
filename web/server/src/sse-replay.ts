/**
 * First-time SSE clients replay from cursor 0. Answered questions stay in the
 * ring buffer without a terminal frame, so only still-pending tool-Question
 * events should be replayed for those clients.
 */
export function shouldReplaySseEvent(event: unknown, pendingQuestionIds: ReadonlySet<string> | null): boolean {
	if (!pendingQuestionIds) return true;
	if (!event || typeof event !== "object") return true;
	const frame = event as {
		type?: string;
		part?: { type?: string; toolCallId?: string };
	};
	if (frame.type !== "tool" || frame.part?.type !== "tool-Question") return true;
	const toolCallId = frame.part.toolCallId;
	return typeof toolCallId === "string" && pendingQuestionIds.has(toolCallId);
}

/**
 * Accept ring entries written by the pre-fix bridge while the process is
 * hot-reloaded. New entries are ChatStreamEvents directly; older entries were
 * wrapped with session metadata before being sent to the SSE route.
 */
export function normalizeSseReplayEvent(event: unknown): unknown {
	if (!event || typeof event !== "object" || !("frame" in event)) return event;
	const frame = (event as { frame?: unknown }).frame;
	return frame ?? event;
}
