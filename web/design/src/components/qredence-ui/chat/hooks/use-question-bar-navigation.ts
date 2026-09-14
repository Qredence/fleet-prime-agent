import { useCallback, useState } from "react";
import type { QuestionAnswer, QuestionConfig } from "../question/question-prompt";

export type QuestionBarData = {
	id: string;
	questions: Array<QuestionConfig>;
	questionIndex?: number;
	totalQuestions?: number;
	onPreviousQuestion?: () => void;
	onNextQuestion?: () => void;
	submitLabel?: string;
	skipLabel?: string;
	allowSkip?: boolean;
	onSubmit: (answer: QuestionAnswer) => void;
	onSkip?: () => void;
};

export type QuestionBarNavigation = {
	questionSet: Array<QuestionConfig>;
	totalQuestions: number;
	clampedQuestionIndex: number;
	activeQuestion: QuestionConfig | undefined;
	showQuestionNavigation: boolean;
	canGoPrev: boolean;
	canGoNext: boolean;
	goToPreviousQuestion: () => void;
	goToNextQuestion: () => void;
	advanceQuestionIndex: () => void;
};

/**
 * Owns the InputBar question flow's navigation state: the internal question
 * index, external-navigation resolution (external `questionIndex` /
 * `onPreviousQuestion` / `onNextQuestion` win over internal state), index
 * clamping, the active question, and prev/next handlers.
 *
 * Extracted from input-bar.tsx with semantics unchanged.
 */
export function useQuestionBarNavigation(questionBar: QuestionBarData | undefined): QuestionBarNavigation {
	const [questionBarIndex, setQuestionBarIndex] = useState(1);
	const questionSet = questionBar?.questions ?? [];
	const hasQuestions = questionSet.length > 0;
	const derivedTotal = hasQuestions ? questionSet.length : 1;
	const totalQuestions = questionBar?.totalQuestions ?? derivedTotal;
	const hasExternalQuestionNavigation = Boolean(questionBar?.onPreviousQuestion || questionBar?.onNextQuestion);
	const questionIndex = hasExternalQuestionNavigation ? (questionBar?.questionIndex ?? 1) : questionBarIndex;
	const clampedQuestionIndex = Math.max(1, Math.min(questionIndex, totalQuestions));
	const activeQuestion = hasQuestions ? questionSet[clampedQuestionIndex - 1] : undefined;
	const showQuestionNavigation = totalQuestions > 1;
	const canGoPrev = clampedQuestionIndex > 1;
	const canGoNext = clampedQuestionIndex < totalQuestions;

	const goToPreviousQuestion = useCallback(() => {
		if (!canGoPrev) return;
		if (questionBar?.onPreviousQuestion) {
			questionBar.onPreviousQuestion();
			return;
		}
		setQuestionBarIndex((prev) => Math.max(1, prev - 1));
	}, [canGoPrev, questionBar]);

	const goToNextQuestion = useCallback(() => {
		if (!canGoNext) return;
		if (questionBar?.onNextQuestion) {
			questionBar.onNextQuestion();
			return;
		}
		setQuestionBarIndex((prev) => Math.min(totalQuestions, prev + 1));
	}, [canGoNext, questionBar, totalQuestions]);

	// Advances the internal index after a submitted answer. Unlike
	// goToNextQuestion this never routes through an external handler, matching
	// the pre-extraction QuestionPrompt onSubmit flow.
	const advanceQuestionIndex = useCallback(() => {
		setQuestionBarIndex((prev) => Math.min(totalQuestions, prev + 1));
	}, [totalQuestions]);

	return {
		questionSet,
		totalQuestions,
		clampedQuestionIndex,
		activeQuestion,
		showQuestionNavigation,
		canGoPrev,
		canGoNext,
		goToPreviousQuestion,
		goToNextQuestion,
		advanceQuestionIndex,
	};
}
