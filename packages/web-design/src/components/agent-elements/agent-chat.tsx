"use client"

import { useMemo, useRef, useState } from "react"
import { MessageList } from "./message-list"
import { createAssistantMessage } from "./message-factories"
import { InputBar } from "./input-bar"
import { Suggestions } from "./input/suggestions"
import { cn } from "./utils/cn"
import type { QuestionAnswer, QuestionConfig } from "./question/question-prompt"
import type { SuggestionItem } from "./input/suggestions"
import type { AgentChatProps } from "./types"

export function AgentChat({
  messages,
  onSend,
  status,
  onStop,
  error,
  classNames,
  slots,
  toolRenderers,
  onOpenUIAction,
  attachments,
  showCopyToolbar,
  initialScrollBehavior,
  enableImagePreview,
  suggestions,
  emptyStatePosition = "default",
  emptySuggestionsPlacement = "input",
  emptySuggestionsPosition = "top",
  questionTool,
  suppressQuestionTool = false,
  className,
  style,
}: AgentChatProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState("")

  const ResolvedInputBar = slots?.InputBar ?? InputBar
  const isEmpty = !error && messages.length === 0
  const isCenteredEmptyState = isEmpty && emptyStatePosition === "center"

  const messagesWithQuestionTool = useMemo(
    () => enhanceQuestionToolMessages(messages, questionTool),
    [messages, questionTool]
  )
  const suggestionConfig = resolveSuggestions(suggestions)
  const showInputSuggestions =
    emptySuggestionsPlacement === "input" ||
    emptySuggestionsPlacement === "both"
  const showEmptySuggestions =
    isCenteredEmptyState &&
    (emptySuggestionsPlacement === "empty" ||
      emptySuggestionsPlacement === "both") &&
    suggestionConfig.items.length > 0

  const handleEmptySuggestionSelect = (item: SuggestionItem) => {
    setDraft(item.value ?? item.label)
  }

  const emptySuggestionsNode = showEmptySuggestions ? (
    <Suggestions
      items={suggestionConfig.items}
      onSelect={handleEmptySuggestionSelect}
      disabled={status === "streaming" || status === "submitted"}
      className={cn(
        "w-full justify-center",
        emptySuggestionsPosition === "top" ? "mb-3" : "mt-3",
        suggestionConfig.className
      )}
      itemClassName={cn(
        "h-8 rounded-full px-3",
        suggestionConfig.itemClassName
      )}
    />
  ) : null

  // When there are messages (non-empty state), suggestions render as trailing
  // content inside the MessageList scroll area rather than above the InputBar.
  const conversationSuggestionsNode =
    !isCenteredEmptyState &&
    showInputSuggestions &&
    suggestionConfig.items.length > 0 ? (
      <Suggestions
        items={suggestionConfig.items}
        onSelect={handleEmptySuggestionSelect}
        disabled={status === "streaming" || status === "submitted"}
        className={cn("mt-3 px-0", suggestionConfig.className)}
        itemClassName={suggestionConfig.itemClassName}
      />
    ) : null

  const inputBarNode = (
    <ResolvedInputBar
      onSend={onSend}
      status={status}
      onStop={onStop}
      controlled={{ value: draft, onChange: setDraft }}
      placeholder="Send a message..."
      className={cn(classNames?.inputBar, isCenteredEmptyState && "px-0 pb-0")}
      attachments={attachments}
      suggestions={
        isCenteredEmptyState && showInputSuggestions ? suggestions : []
      }
    />
  )

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex h-full min-h-0 flex-col",
        classNames?.root,
        className
      )}
      style={style}
    >
      {isCenteredEmptyState ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-4">
          <div className="w-full max-w-an">
            {emptySuggestionsPosition === "top" ? emptySuggestionsNode : null}
            {inputBarNode}
            {emptySuggestionsPosition === "bottom"
              ? emptySuggestionsNode
              : null}
          </div>
        </div>
      ) : (
        <MessageList
          messages={
            error
              ? [
                  ...messagesWithQuestionTool,
                  createAssistantMessage("agent-chat-error", [
                    {
                      type: "error",
                      title: "Request failed",
                      message: error.message,
                    },
                  ]),
                ]
              : messagesWithQuestionTool
          }
          status={status}
          classNames={classNames}
          slots={slots}
          toolRenderers={toolRenderers}
          onOpenUIAction={onOpenUIAction}
          showCopyToolbar={showCopyToolbar}
          initialScrollBehavior={initialScrollBehavior}
          enableImagePreview={enableImagePreview}
          suppressQuestionTool={suppressQuestionTool}
          trailing={conversationSuggestionsNode}
        />
      )}
      {!isCenteredEmptyState ? inputBarNode : null}
    </div>
  )
}

function resolveSuggestions(suggestions: AgentChatProps["suggestions"]) {
  if (Array.isArray(suggestions)) {
    return {
      items: suggestions,
      className: undefined,
      itemClassName: undefined,
    }
  }
  return {
    items: suggestions?.items ?? [],
    className: suggestions?.className,
    itemClassName: suggestions?.itemClassName,
  }
}

function enhanceQuestionToolMessages(
  messages: AgentChatProps["messages"],
  questionTool: AgentChatProps["questionTool"]
) {
  if (!questionTool?.onAnswer) return messages

  let changed = false
  const nextMessages = messages.map((message) => {
    if (message?.role !== "assistant" || !Array.isArray(message.parts)) {
      return message
    }

    const nextParts = message.parts.map((rawPart) => {
      const part = rawPart as {
        type?: string
        toolCallId?: string
        input?: {
          questions?: Array<QuestionConfig>
          question?: QuestionConfig
          questionIndex?: number
          totalQuestions?: number
          onPreviousQuestion?: () => void
          onNextQuestion?: () => void
          submitLabel?: string
          skipLabel?: string
          allowSkip?: boolean
          onSubmitAnswer?: (answer: QuestionAnswer) => void
        }
      }

      if (part?.type !== "tool-Question") return rawPart

      const input = part.input ?? {}
      const questions = input.questions ?? []
      const activeQuestion =
        questions[Math.max(0, (input.questionIndex ?? 1) - 1)] ??
        questions[0] ??
        input.question

      if (!activeQuestion) return rawPart

      changed = true
      return {
        ...part,
        input: {
          ...input,
          submitLabel: questionTool.submitLabel ?? input.submitLabel,
          skipLabel: questionTool.skipLabel ?? input.skipLabel,
          allowSkip: questionTool.allowSkip ?? input.allowSkip,
          onSubmitAnswer: (answer: QuestionAnswer) => {
            questionTool.onAnswer?.({
              toolCallId: part.toolCallId,
              question: activeQuestion,
              answer,
            })
          },
        },
      } as typeof rawPart
    })

    return changed ? { ...message, parts: nextParts } : message
  })

  return changed ? nextMessages : messages
}
