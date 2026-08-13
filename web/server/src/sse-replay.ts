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
