import {
  IconChevronDown,
  IconChevronUp,
  IconMessageCircleQuestion,
} from "@tabler/icons-react"
import { cn } from "../utils/cn"
import { QuestionPrompt } from "../question/question-prompt"
import type {
  QuestionBarData,
  QuestionBarNavigation,
} from "../hooks/use-question-bar-navigation"

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
  } = navigation

  if (!activeQuestion) return null

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[calc(100%-24px)] border-x border-t border-border",
        roundedTop ? "rounded-t-an-input-border-radius" : null
      )}
    >
      <div className="flex h-7 items-center justify-between border-b border-border px-3 text-xs text-an-tool-color-muted">
        <div className="inline-flex items-center gap-1.5">
          <IconMessageCircleQuestion className="h-3.5 w-3.5" />
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
              <IconChevronUp className="h-3.5 w-3.5" />
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
              <IconChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <QuestionPrompt
        key={`${clampedQuestionIndex}-${activeQuestion?.title ?? "question"}`}
        questions={questionSet}
        questionIndex={clampedQuestionIndex}
        totalQuestions={totalQuestions}
        submitLabel={questionBar.submitLabel}
        skipLabel={questionBar.skipLabel}
        allowSkip={questionBar.allowSkip}
        onSubmit={(answer) => {
          questionBar.onSubmit(answer)
          if (clampedQuestionIndex >= totalQuestions) {
            onDismiss(questionBar.id)
          } else {
            advanceQuestionIndex()
          }
        }}
        onSkip={() => {
          questionBar.onSkip?.()
        }}
      />
    </div>
  )
}
