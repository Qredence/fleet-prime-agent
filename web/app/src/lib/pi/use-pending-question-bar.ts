import type {
	QuestionAnswer,
	QuestionConfig,
	QuestionOption,
} from "@prime-agent/web-design/components/registry/beui/agents/question/question-prompt";
import type { ChatQuestionAnswer } from "@prime-agent/web-protocol/chat-protocol";
import { useMemo, useRef } from "react";
import { isQuestionToolPartPending } from "./question-pending";

type ToolQuestionPart = {
	type: "tool-Question";
	toolCallId?: string;
	state?: string;
	input?: {
		questions?: Array<{
			id?: string;
			question?: string;
			prompt?: string;
			title?: string;
			options?: Array<{
				value?: string;
				label?: string;
				description?: string;
			}>;
			allowOther?: boolean;
			allowCustom?: boolean;
			kind?: "single" | "multi" | "text";
		}>;
	};
	output?: {
		answer?: unknown;
		answers?: Array<unknown>;
		content?: string;
		details?: unknown;
	};
};

type ChatMessageLike = {
	role: string;
	parts?: Array<{ type?: string; [key: string]: unknown }>;
};

type PendingQuestionBarResult = {
	id: string;
	questions: Array<QuestionConfig>;
	submitLabel: string;
	allowSkip: boolean;
	onSubmit: (answer: QuestionAnswer) => void;
};

type QuestionAnswerPayload = {
	toolCallId?: string;
	answer: ChatQuestionAnswer;
};

type AnswerBuckets = Map<string, Map<string, string | Array<string>>>;

/**
 * Scans the message list for the last unanswered `tool-Question` part and
 * returns a shaped `questionBar` prop for the InputBar, or `undefined` if
 * no question is pending.
 *
 * The question bar submits one answer per question. For multi-question
 * dialogs, answers are bucketed locally and sent as a single
 * `{ kind: "questions", answers }` payload once every question has been
 * answered; skip resolves the dialog immediately.
 */
export function usePendingQuestionBar({
	messages,
	answerQuestion,
}: {
	messages: Array<ChatMessageLike>;
	answerQuestion: (payload: QuestionAnswerPayload) => void;
}): PendingQuestionBarResult | undefined {
	const bucketsRef = useRef<AnswerBuckets>(new Map());

	return useMemo(() => {
		const pending = findPendingQuestionPart(messages);
		if (!pending) {
			bucketsRef.current.clear();
			return undefined;
		}

		const { part } = pending;
		const rawQuestions = part.input?.questions ?? [];
		if (rawQuestions.length === 0) {
			bucketsRef.current.clear();
			return undefined;
		}

		const questions = rawQuestions.map((raw, index) => mapToQuestionConfig(raw, index));
		const toolCallId = part.toolCallId;
		const barId = toolCallId ?? "pending-question";

		// Drop stale answer buckets left over from other dialogs.
		for (const key of Array.from(bucketsRef.current.keys())) {
			if (key !== barId) bucketsRef.current.delete(key);
		}

		const questionIds = questions.map((question, index) => question.id ?? `question-${index + 1}`);

		const onSubmit = (answer: QuestionAnswer) => {
			if (answer.kind === "skip") {
				bucketsRef.current.delete(barId);
				answerQuestion({
					toolCallId,
					answer: { kind: "skip", ...(answer.questionId ? { questionId: answer.questionId } : {}) },
				});
				return;
			}

			const existing = bucketsRef.current.get(barId);
			const bucket = existing ?? new Map<string, string | Array<string>>();
			if (!existing) bucketsRef.current.set(barId, bucket);

			const questionId =
				typeof answer.questionId === "string" && answer.questionId
					? answer.questionId
					: questionIds.find((id) => !bucket.has(id));

			if (!questionId) {
				// Defensive passthrough: never silently drop an answer.
				answerQuestion({ toolCallId, answer });
				return;
			}

			bucket.set(questionId, answerToRecordValue(answer));

			if (!questionIds.every((id) => bucket.has(id))) return;

			const answers: Record<string, string | Array<string>> = {};
			for (const id of questionIds) {
				const value = bucket.get(id);
				if (value !== undefined) answers[id] = value;
			}
			bucketsRef.current.delete(barId);
			answerQuestion({ toolCallId, answer: { kind: "questions", answers } });
		};

		return {
			id: barId,
			questions,
			submitLabel: "Continue",
			allowSkip: true,
			onSubmit,
		};
	}, [messages, answerQuestion]);
}

function findPendingQuestionPart(messages: Array<ChatMessageLike>) {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant" || !Array.isArray(msg.parts)) continue;

		for (let j = msg.parts.length - 1; j >= 0; j--) {
			const part = msg.parts[j] as ToolQuestionPart | undefined;
			if (part?.type !== "tool-Question") continue;
			if (isQuestionToolPartPending(part)) return { part };
		}
	}
	return undefined;
}

type RawQuestion = {
	id?: string;
	question?: string;
	prompt?: string;
	title?: string;
	options?: Array<{
		value?: string;
		label?: string;
		description?: string;
	}>;
	allowOther?: boolean;
	allowCustom?: boolean;
	kind?: "single" | "multi" | "text";
};

function mapToQuestionConfig(raw: RawQuestion, index: number): QuestionConfig {
	const options: Array<QuestionOption> = (raw.options ?? [])
		.map((opt): QuestionOption | undefined => {
			const value = opt.value ?? opt.label;
			if (typeof value !== "string") return undefined;
			return {
				id: value,
				value,
				label: opt.label ?? value,
				description: opt.description,
			};
		})
		.filter((opt): opt is QuestionOption => opt !== undefined);

	const kind: QuestionConfig["kind"] = raw.kind ?? (options.length > 0 ? "single" : "text");

	return {
		// InputQuestionBar reports the active question's id verbatim, so a
		// stable fallback id keeps multi-question answers attributable.
		id: typeof raw.id === "string" && raw.id.trim() ? raw.id : `question-${index + 1}`,
		kind,
		title: raw.question ?? raw.prompt ?? raw.title ?? "",
		options: options.length > 0 ? options : undefined,
		allowCustom: raw.allowOther ?? raw.allowCustom,
	};
}

function answerToRecordValue(answer: QuestionAnswer): string | Array<string> {
	if (answer.kind === "multi") {
		const values = Array.isArray(answer.selectedIds) ? [...answer.selectedIds] : [];
		if (typeof answer.text === "string" && answer.text.trim()) values.push(answer.text.trim());
		return values;
	}
	if (answer.kind === "text") {
		return typeof answer.text === "string" ? answer.text : "";
	}
	return answer.selectedIds?.[0] ?? answer.text ?? "";
}
