import {
  ChevronDown,
  ChevronUp,
  MessageCircleQuestion,
} from "lucide-react"
import { ApprovalCard } from "../approval-card/index"
import { cn } from "../utils/cn"
import type {
  ApprovalCardAnswers,
  ApprovalCardQuestion,
} from "../approval-card/index"
import type {
  QuestionBarData,
  QuestionBarNavigation,
} from "../hooks/use-question-bar-navigation"
import type { QuestionAnswer } from "../question/question-prompt"

export type InputQuestionBarProps = {
  questionBar: QuestionBarData
  navigation: QuestionBarNavigation
  /** Mirrors the pre-extraction rounding rule: round the bar's top corners
   *  when there is no info bar or the info bar sits at the bottom. */
  roundedTop: boolean
  onDismiss: (id: string) => void
}

export function InputQuestionBar({
  questionBar,
  navigation,
  roundedTop,
  onDismiss,
}: InputQuestionBarProps) {
  const {
    totalQuestions,
    clampedQuestionIndex,
    activeQuestion,
    showQuestionNavigation,
    canGoPrev,
    canGoNext,
    goToPreviousQuestion,
    goToNextQuestion,
    advanceQuestionIndex,
  } = navigation

  if (!activeQuestion) return null

  const approvalQuestion: ApprovalCardQuestion = {
    id: activeQuestion.id ?? `question-${clampedQuestionIndex}`,
    title: activeQuestion.title,
    description: activeQuestion.description,
    multiple: activeQuestion.kind === "multi",
    allowCustom: activeQuestion.kind === "text" || activeQuestion.allowCustom,
    customPlaceholder:
      activeQuestion.customPlaceholder ?? activeQuestion.placeholder,
    options: activeQuestion.options?.map((option) => ({
      value: option.id ?? option.value ?? option.label,
      label: option.label,
    })),
  }

  const handleApprovalSubmit = (answers: ApprovalCardAnswers) => {
    const answer = answers[approvalQuestion.id]
    if (!answer) return

    const custom = answer.custom?.trim() || undefined
    const selectedIds = answer.selected.filter((id) => id !== "__custom__")
    const questionAnswer: QuestionAnswer =
      activeQuestion.kind === "text"
        ? {
            kind: "text",
            questionId: activeQuestion.id,
            text: custom,
          }
        : {
            kind: activeQuestion.kind,
            questionId: activeQuestion.id,
            selectedIds,
            text: custom,
          }

    questionBar.onSubmit(questionAnswer)
    if (clampedQuestionIndex >= totalQuestions) {
      onDismiss(questionBar.id)
    } else {
      advanceQuestionIndex()
    }
  }

  const handleSkip = () => {
    questionBar.onSkip?.()
    questionBar.onSubmit({
      kind: "skip",
      questionId: activeQuestion.id,
    })
    onDismiss(questionBar.id)
  }

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[calc(100%-24px)] border-x border-t border-border",
        roundedTop ? "rounded-t-an-input-border-radius" : null
      )}
    >
      <div className="flex h-7 items-center justify-between border-b border-border px-3 text-xs text-an-tool-color-muted">
        <div className="inline-flex items-center gap-1.5">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          Question
        </div>
        {showQuestionNavigation && (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={goToPreviousQuestion}
              disabled={!canGoPrev}
              className="relative inline-flex size-5 items-center justify-center rounded-[4px] transition-[background-color,transform] duration-150 after:absolute after:inset-x-0 after:-top-2.5 after:-bottom-2.5 hover:bg-an-background-secondary active:scale-[0.96] disabled:opacity-40 disabled:active:scale-100"
              aria-label="Previous question"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <span className="tabular-nums">
              {clampedQuestionIndex} of {totalQuestions}
            </span>
            <button
              type="button"
              onClick={goToNextQuestion}
              disabled={!canGoNext}
              className="relative inline-flex size-5 items-center justify-center rounded-[4px] transition-[background-color,transform] duration-150 after:absolute after:inset-x-0 after:-top-2.5 after:-bottom-2.5 hover:bg-an-background-secondary active:scale-[0.96] disabled:opacity-40 disabled:active:scale-100"
              aria-label="Next question"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <ApprovalCard
        key={`${clampedQuestionIndex}-${activeQuestion.title}`}
        title="Fleet Prime question"
        questions={[approvalQuestion]}
        submitLabel={questionBar.submitLabel ?? "Continue"}
        status="pending"
        onSubmit={handleApprovalSubmit}
        className="rounded-none bg-background p-0"
      />
      {questionBar.allowSkip ? (
        <div className="border-t border-border bg-background px-3 py-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {questionBar.skipLabel ?? "Skip"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
