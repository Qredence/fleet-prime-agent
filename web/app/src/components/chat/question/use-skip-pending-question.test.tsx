import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSkipPendingQuestion } from "@/components/chat/question/use-skip-pending-question";

const pendingQuestion = (state = "input-available") =>
	[
		{
			id: "assistant-1",
			role: "assistant",
			parts: [{ type: "tool-Question", toolCallId: "question-1", state }],
		},
	] as unknown as Array<ChatMessage>;

const liveQuestion = () =>
	[
		{ id: "user-1", role: "user", parts: [{ type: "text", text: "Current request" }] },
		...pendingQuestion(),
	] as unknown as Array<ChatMessage>;

describe("useSkipPendingQuestion", () => {
	it("does not answer a questionnaire restored from a historical transcript", () => {
		const answerQuestion = vi.fn().mockResolvedValue({ ok: true });
		const onAnswerError = vi.fn();

		renderHook(() => useSkipPendingQuestion(pendingQuestion(), "ready", answerQuestion, onAnswerError));

		expect(answerQuestion).not.toHaveBeenCalled();
		expect(onAnswerError).not.toHaveBeenCalled();
	});

	it("skips a live pending questionnaire once and reports a failed response", async () => {
		const answerQuestion = vi.fn().mockRejectedValue(new Error("answer failed"));
		const onAnswerError = vi.fn();

		const { rerender } = renderHook(
			({ messages }) => useSkipPendingQuestion(messages, "streaming", answerQuestion, onAnswerError),
			{ initialProps: { messages: liveQuestion() } },
		);
		await waitFor(() => expect(answerQuestion).toHaveBeenCalledTimes(1));
		expect(answerQuestion).toHaveBeenCalledWith({ toolCallId: "question-1", answer: { kind: "skip" } });
		await waitFor(() => expect(onAnswerError).toHaveBeenCalledWith(expect.any(Error)));

		rerender({ messages: liveQuestion() });
		expect(answerQuestion).toHaveBeenCalledTimes(1);
	});

	it("does not answer an older pending part when a newer user turn streams", () => {
		const answerQuestion = vi.fn().mockResolvedValue({ ok: true });
		const messages = [
			...pendingQuestion(),
			{ id: "user-2", role: "user", parts: [{ type: "text", text: "New request" }] },
		] as unknown as Array<ChatMessage>;

		renderHook(() => useSkipPendingQuestion(messages, "streaming", answerQuestion, vi.fn()));

		expect(answerQuestion).not.toHaveBeenCalled();
	});

	it("waits for streamed question input to finish before skipping", () => {
		const answerQuestion = vi.fn().mockResolvedValue({ ok: true });

		renderHook(() =>
			useSkipPendingQuestion(
				[
					{ id: "user-1", role: "user", parts: [] },
					...pendingQuestion("input-streaming"),
				] as unknown as Array<ChatMessage>,
				"streaming",
				answerQuestion,
				vi.fn(),
			),
		);

		expect(answerQuestion).not.toHaveBeenCalled();
	});
});
