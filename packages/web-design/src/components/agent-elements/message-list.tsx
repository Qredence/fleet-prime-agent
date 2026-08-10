import React, { memo, useCallback, useEffect, useMemo, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "./utils/cn"

import { UserMessage } from "./user-message"
import { Markdown } from "./markdown"
import { ToolRowBase } from "./tools/tool-row-base"
import { ToolRenderer as DefaultToolRenderer } from "./tools/tool-renderer"
import { SpiralLoader } from "./spiral-loader"
import { useChatAutoScroll } from "./hooks/use-chat-auto-scroll"
import { AssistantTurn, UserTurn } from "./message-turns"
import { isTextPart, isV5ToolPart } from "./utils/chat-message-parts"
import type { ToolRendererProps } from "./utils/chat-message-parts"
import type { CustomToolRendererProps } from "./types"
import type { ChatMessage, ChatStatus } from "./chat-types"

export type MessageListProps = {
  messages: Array<ChatMessage>
  status: ChatStatus
  className?: string
  showCopyToolbar?: boolean
  suppressQuestionTool?: boolean
  /**
   * Where to position the scroll container on initial mount.
   * - "bottom" (default): classic chat behavior, pinned to the latest message.
   * - "top": start from the top of the conversation — useful for static demos
   *   or read-only transcripts where the user should read top-to-bottom.
   */
  initialScrollBehavior?: "bottom" | "top"
  /**
   * When true (default) clicking an attached image in a user message opens
   * the fullscreen lightbox preview. Set to false to disable previews.
   */
  enableImagePreview?: boolean
  slots?: {
    UserMessage?: React.ComponentType<{
      message: ChatMessage
      className?: string
      enableImagePreview?: boolean
    }>
    ToolRenderer?: React.ComponentType<ToolRendererProps>
    TextRenderer?: React.ComponentType<{
      content: string
      className?: string
      isStreaming?: boolean
      messageId?: string
      onOpenUIAction?: (message: string) => void
    }>
  }
  classNames?: {
    userMessage?: string
  }
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>
  onOpenUIAction?: (message: string) => void
  /** Node rendered after the last message turn, before the breathing space. */
  trailing?: React.ReactNode
}

function normalizeMessages(messages: Array<ChatMessage>): Array<ChatMessage> {
  let changed = false
  const normalized = messages.map((message) => {
    if (Array.isArray(message.parts) && message.parts.length > 0) return message
    const raw = message as { content?: string; text?: string }
    const content = raw.content ?? raw.text
    if (typeof content !== "string" || !content) return message
    changed = true
    return {
      ...message,
      parts: [{ type: "text", text: content }],
    }
  })
  return changed ? normalized : messages
}

function getLastAssistantHasContent(messages: Array<ChatMessage>) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role !== "assistant") continue
    return (msg.parts ?? []).some((part) => {
      if (isTextPart(part)) return part.text.trim().length > 0
      return isV5ToolPart(part)
    })
  }
  return false
}

function getLastUserMessageId(messages: Array<ChatMessage>) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role === "user") return msg.id
  }
  return null
}

/** Group flat messages into turns (user message + following assistant messages) */
function groupMessagesIntoTurns(messages: Array<ChatMessage>) {
  const turns: Array<{
    userMsg?: ChatMessage
    assistantMsgs: Array<ChatMessage>
  }> = []
  let current: {
    userMsg?: ChatMessage
    assistantMsgs: Array<ChatMessage>
  } | null = null

  for (const msg of messages) {
    if (msg.role === "user") {
      if (current) turns.push(current)
      current = { userMsg: msg, assistantMsgs: [] }
    } else if (msg.role === "assistant") {
      if (!current) current = { assistantMsgs: [] }
      current.assistantMsgs.push(msg)
    }
  }
  if (current) turns.push(current)
  return turns
}

export const MessageList = memo(function MessageList({
  messages,
  status,
  className,
  showCopyToolbar = true,
  suppressQuestionTool = false,
  initialScrollBehavior = "bottom",
  enableImagePreview = true,
  slots,
  classNames,
  toolRenderers,
  onOpenUIAction,
  trailing,
}: MessageListProps) {
  const [activeCopyId, setActiveCopyId] = useState<string | null>(null)
  const [isMounted, setIsMounted] = useState(false)
  const reduceMotion = useReducedMotion()

  const CustomUserMessage = slots?.UserMessage || UserMessage
  const CustomToolRenderer = slots?.ToolRenderer || DefaultToolRenderer
  const CustomTextRenderer = slots?.TextRenderer || Markdown

  const markCopied = useCallback((id: string) => {
    setActiveCopyId(id)
  }, [])

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    const handlePointerDown = () => {
      setActiveCopyId(null)
    }
    window.addEventListener("pointerdown", handlePointerDown)
    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [])

  const isStreaming = status === "streaming" || status === "submitted"

  const normalizedMessages = useMemo(
    () => normalizeMessages(messages),
    [messages]
  )
  const lastMessage = normalizedMessages[normalizedMessages.length - 1]
  const lastMessageId = lastMessage?.id ?? null
  const lastMessageRole = lastMessage?.role ?? null
  const lastUserMessageId = useMemo(
    () => getLastUserMessageId(normalizedMessages),
    [normalizedMessages]
  )
  const turns = useMemo(
    () => groupMessagesIntoTurns(normalizedMessages),
    [normalizedMessages]
  )
  const showPlanning = useMemo(() => {
    const latestMessage = normalizedMessages[normalizedMessages.length - 1]
    if (!latestMessage) return false
    const lastTurn = turns[turns.length - 1]
    const hasAssistant = Boolean(lastTurn && lastTurn.assistantMsgs.length > 0)
    if (latestMessage.role === "user" && !hasAssistant) return true
    return isStreaming && !getLastAssistantHasContent(normalizedMessages)
  }, [isStreaming, normalizedMessages, turns])

  const {
    containerRefCallback,
    contentWrapperRef,
    handleScroll,
    assistantSpaceActiveRef,
    lastMessageIdRef,
  } = useChatAutoScroll({
    initialScrollBehavior,
    initialLastMessageId: messages[messages.length - 1]?.id ?? null,
    lastUserMessageId,
    showPlanning,
    lastMessageId,
    lastMessageRole,
  })

  const planningLabel = "Processing..."
  const isNewAssistantMessage =
    lastMessageRole === "assistant" &&
    Boolean(lastMessageId) &&
    lastMessageId !== lastMessageIdRef.current
  const showAssistantBreathingSpace =
    showPlanning || assistantSpaceActiveRef.current || isNewAssistantMessage

  return (
    <div
      ref={containerRefCallback}
      onScroll={handleScroll}
      className={cn(
        "an-message-list min-h-0 flex-1 overflow-y-auto",
        className
      )}
    >
      <div ref={contentWrapperRef} className="mx-auto max-w-an px-4 py-6">
        <div className="flex flex-col gap-2">
          {turns.map((turn, turnIndex) => {
            const isLastTurn = turnIndex === turns.length - 1
            const turnKey = turn.userMsg?.id ?? `turn-${turnIndex}`

            return (
              <motion.div
                key={turnKey}
                className="relative flex flex-col gap-2"
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.25, ease: "easeOut" }
                }
              >
                {turn.userMsg && (
                  <UserTurn
                    message={turn.userMsg}
                    UserMessageComponent={CustomUserMessage}
                    userMessageClassName={classNames?.userMessage}
                    enableImagePreview={enableImagePreview}
                    showCopyToolbar={showCopyToolbar}
                    isMounted={isMounted}
                    isCopyVisible={activeCopyId === `user-${turn.userMsg.id}`}
                    onCopied={markCopied}
                  />
                )}

                {turn.assistantMsgs.length > 0 &&
                  !(isLastTurn && showPlanning) && (
                    <AssistantTurn
                      assistantMsgs={turn.assistantMsgs}
                      turnKey={turnKey}
                      isLastTurn={isLastTurn}
                      isStreaming={isStreaming}
                      showCopyToolbar={showCopyToolbar}
                      suppressQuestionTool={suppressQuestionTool}
                      ToolRendererComponent={CustomToolRenderer}
                      TextRendererComponent={CustomTextRenderer}
                      toolRenderers={toolRenderers}
                      onOpenUIAction={onOpenUIAction}
                      isCopyVisible={
                        activeCopyId === `assistant-${turnKey}-all`
                      }
                      onCopied={markCopied}
                    />
                  )}

                {isLastTurn && showPlanning && (
                  <ToolRowBase
                    icon={<SpiralLoader size={12} />}
                    shimmerLabel={planningLabel}
                    completeLabel="Done"
                    isAnimating={true}
                  />
                )}
              </motion.div>
            )
          })}
        </div>
        {trailing}
        {showAssistantBreathingSpace && (
          <div
            aria-hidden="true"
            className="mx-auto min-h-[max(140px,24vh)] w-full max-w-an"
          />
        )}
      </div>
    </div>
  )
})
