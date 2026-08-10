type ToolQuestionPart = {
  type?: string
  state?: string
  output?: {
    answer?: unknown
    answers?: Array<unknown>
    content?: string
    details?: unknown
  }
}

type ChatMessageLike = {
  role?: string
  parts?: Array<{ type?: string; [key: string]: unknown }>
}

export function isQuestionToolPartPending(part: ToolQuestionPart): boolean {
  if (part.type !== "tool-Question") return false
  if (part.state === "output-available" || part.state === "output-error")
    return false

  const output = part.output
  if (!output) return true
  if (output.answer !== undefined && output.answer !== null) return false
  if (Array.isArray(output.answers) && output.answers.length > 0) return false
  if (typeof output.content === "string" && output.content.length > 0)
    return false

  return true
}

export function assistantMessageHasPendingQuestion(
  message: ChatMessageLike | undefined
): boolean {
  if (
    !message ||
    message.role !== "assistant" ||
    !Array.isArray(message.parts)
  ) {
    return false
  }

  return message.parts.some((part) => isQuestionToolPartPending(part))
}
