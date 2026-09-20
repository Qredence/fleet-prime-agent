import type { ChatMessage, ChatStatus } from "@prime-agent/web-protocol/chat-types";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	TRANSCRIPT_SUMMARY_THROTTLE_MS,
	useThrottledTranscriptSummary,
} from "@/components/chat/transcript/use-throttled-transcript-summary";

afterEach(() => {
	vi.useRealTimers();
});

function message(id: string, role: ChatMessage["role"]): ChatMessage {
	return { id, role, parts: [{ type: "text", text: id }] };
}

describe("useThrottledTranscriptSummary", () => {
	it("keeps a stable idle snapshot when messages are unchanged across rerenders", () => {
		const messages = [message("user-1", "user")];
		const { result, rerender } = renderHook(
			({ messages, status }) => useThrottledTranscriptSummary(messages, status, "session-a"),
			{ initialProps: { messages, status: "ready" as ChatStatus } },
		);

		const firstSnapshot = result.current;
		rerender({ messages, status: "ready" });
		expect(result.current).toBe(firstSnapshot);
	});

	it("returns the live transcript immediately when the session is idle", () => {
		const { result, rerender } = renderHook(
			({ messages }) => useThrottledTranscriptSummary(messages, "ready", "session-a"),
			{ initialProps: { messages: [message("user-1", "user")] } },
		);

		expect(result.current).toEqual({
			assistantMessageCount: 0,
			openUIBlocks: [],
			userMessageCount: 1,
		});

		rerender({ messages: [message("user-1", "user"), message("asst-1", "assistant")] });
		expect(result.current.assistantMessageCount).toBe(1);
	});

	it("holds the right-rail snapshot while a live turn keeps emitting deltas", () => {
		vi.useFakeTimers();
		const first = [message("user-1", "user")];
		const { result, rerender } = renderHook(
			({ messages }) => useThrottledTranscriptSummary(messages, "streaming", "session-a"),
			{ initialProps: { messages: first } },
		);

		rerender({ messages: [...first, message("asst-1", "assistant")] });
		expect(result.current.assistantMessageCount).toBe(0);

		act(() => {
			vi.advanceTimersByTime(TRANSCRIPT_SUMMARY_THROTTLE_MS - 1);
		});
		expect(result.current.assistantMessageCount).toBe(0);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(result.current.assistantMessageCount).toBe(1);
	});

	it("snaps to the new transcript when switching between live sessions", () => {
		vi.useFakeTimers();
		const sessionA = [message("a-user", "user"), message("a-asst", "assistant")];
		const sessionB = [message("b-user", "user"), message("b-asst-1", "assistant"), message("b-asst-2", "assistant")];

		const { result, rerender } = renderHook(
			({ messages, transcriptKey }) => useThrottledTranscriptSummary(messages, "streaming", transcriptKey),
			{ initialProps: { messages: sessionA, transcriptKey: "session-a" } },
		);

		act(() => {
			vi.advanceTimersByTime(TRANSCRIPT_SUMMARY_THROTTLE_MS);
		});
		expect(result.current.assistantMessageCount).toBe(1);

		rerender({ messages: sessionB, transcriptKey: "session-b" });
		expect(result.current).toEqual({
			assistantMessageCount: 2,
			openUIBlocks: [],
			userMessageCount: 1,
		});

		rerender({
			messages: [...sessionB, message("b-asst-3", "assistant")],
			transcriptKey: "session-b",
		});
		expect(result.current.assistantMessageCount).toBe(2);
		expect(result.current.userMessageCount).toBe(1);
	});

	it("snaps to the current transcript when a turn becomes live", () => {
		const messages = [message("user-1", "user"), message("asst-1", "assistant")];
		const { result, rerender } = renderHook(
			({ status }: { status: ChatStatus }) => useThrottledTranscriptSummary(messages, status, "session-a"),
			{ initialProps: { status: "ready" as ChatStatus } },
		);

		expect(result.current.assistantMessageCount).toBe(1);
		rerender({ status: "streaming" });
		expect(result.current.assistantMessageCount).toBe(1);
	});
});
