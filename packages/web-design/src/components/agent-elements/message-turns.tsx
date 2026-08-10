import React, { memo, useMemo } from "react"

import { ErrorMessage } from "./error-message"
import { normalizeAssistantToolParts } from "./utils/tool-part-normalizer"
import { MessageToolbar, formatTimestamp } from "./message-toolbar"
import {
  getTextFromParts,
  isErrorPart,
  isTextPart,
  isV5ToolPart,
} from "./utils/chat-message-parts"
import type {
  ToolPartBase,
  ToolRendererProps,
} from "./utils/chat-message-parts"
import type { CustomToolRendererProps } from "./types"
import type { ChatMessage } from "./chat-types"

type UserMessageComponentProps = {
  message: ChatMessage
  className?: string
  enableImagePreview?: boolean
}

type TextRendererComponentProps = {
  content: string
  className?: string
  isStreaming?: boolean
  messageId?: string
  onOpenUIAction?: (message: string) => void
}

/** One user message bubble plus its hover copy/timestamp toolbar. */
export const UserTurn = memo(function UserTurn({
  message,
  UserMessageComponent,
  userMessageClassName,
  enableImagePreview,
  showCopyToolbar,
  isMounted,
  isCopyVisible,
  onCopied,
}: {
  message: ChatMessage
  UserMessageComponent: React.ComponentType<UserMessageComponentProps>
  userMessageClassName?: string
  enableImagePreview: boolean
  showCopyToolbar: boolean
  isMounted: boolean
  isCopyVisible: boolean
  onCopied: (copyKey: string) => void
}) {
  const text = getTextFromParts(message.parts ?? [], "")
  const hasParts = (message.parts ?? []).length > 0
  if (!text && !hasParts) return null
  const userCreatedAt = (message as { createdAt?: Date | string })?.createdAt
  const userCopyKey = `user-${message.id}`
  const userTimestamp =
    isMounted && userCreatedAt
      ? formatTimestamp(new Date(userCreatedAt))
      : undefined
  // Only render the toolbar when it has content — copy
  // button (gated by showCopyToolbar) or a timestamp.
  // Otherwise a 28px-tall empty row inflates the gap to the
  // assistant reply.
  const showUserToolbar =
    (showCopyToolbar && Boolean(text)) || Boolean(userTimestamp)
  return (
    <div className="group/user-message">
      <UserMessageComponent
        message={message}
        className={userMessageClassName}
        enableImagePreview={enableImagePreview}
      />
      {showUserToolbar && (
        <MessageToolbar
          text={showCopyToolbar ? text : ""}
          timestamp={userTimestamp}
          heightClass="h-[28px]"
          hoverClass="group-hover/user-message:opacity-100 group-hover/user-message:pointer-events-auto"
          isVisible={isCopyVisible}
          alignClass="justify-end"
          onCopied={() => onCopied(userCopyKey)}
        />
      )}
    </div>
  )
})

/** All assistant messages of a turn plus the single shared copy toolbar. */
export const AssistantTurn = memo(function AssistantTurn({
  assistantMsgs,
  turnKey,
  isLastTurn,
  isStreaming,
  showCopyToolbar,
  suppressQuestionTool,
  ToolRendererComponent,
  TextRendererComponent,
  toolRenderers,
  onOpenUIAction,
  isCopyVisible,
  onCopied,
}: {
  assistantMsgs: Array<ChatMessage>
  turnKey: string
  isLastTurn: boolean
  isStreaming: boolean
  showCopyToolbar: boolean
  suppressQuestionTool: boolean
  ToolRendererComponent: React.ComponentType<ToolRendererProps>
  TextRendererComponent: React.ComponentType<TextRendererComponentProps>
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>
  onOpenUIAction?: (message: string) => void
  isCopyVisible: boolean
  onCopied: (copyKey: string) => void
}) {
  const assistantText = getTextFromParts(
    assistantMsgs.flatMap((msg) => msg.parts ?? []),
    "\n\n"
  )
  const isTurnStreaming = isStreaming && isLastTurn
  // Only reserve toolbar height when there's actually
  // something to show in it. With showCopyToolbar=false the
  // toolbar would otherwise render as a 48px-tall empty box,
  // creating large gaps between assistant turns. The toolbar
  // also stays mounted (invisible) while its copy state is
  // active so the copied checkmark does not vanish mid-feedback.
  const showToolbar =
    showCopyToolbar && Boolean(assistantText.trim()) && !isTurnStreaming
  const copyKey = `assistant-${turnKey}-all`
  const toolbarText = showCopyToolbar ? assistantText : ""

  return (
    <div className="group/assistant-turn">
      <div className="flex flex-col gap-3">
        {assistantMsgs.map((msg, i) => {
          const isLastMsg = isLastTurn && i === assistantMsgs.length - 1
          return (
            <AssistantParts
              key={msg.id}
              msg={msg}
              isLast={isLastMsg}
              isStreaming={isStreaming}
              suppressQuestionTool={suppressQuestionTool}
              ToolRendererComponent={ToolRendererComponent}
              TextRendererComponent={TextRendererComponent}
              toolRenderers={toolRenderers}
              onOpenUIAction={onOpenUIAction}
            />
          )
        })}
      </div>
      {(showToolbar || isCopyVisible) && (
        <MessageToolbar
          text={toolbarText}
          heightClass="h-[48px] flex items-start w-full"
          hoverClass="group-hover/assistant-turn:opacity-100 group-hover/assistant-turn:pointer-events-auto"
          isVisible={isCopyVisible}
          alignClass="justify-start"
          onCopied={() => onCopied(copyKey)}
        />
      )}
    </div>
  )
})

type BuildAssistantElementsOptions = {
  messageId: string
  isLast: boolean
  isStreaming: boolean
  suppressQuestionTool: boolean
  ToolRendererComponent: React.ComponentType<ToolRendererProps>
  TextRendererComponent: React.ComponentType<TextRendererComponentProps>
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>
  onOpenUIAction?: (message: string) => void
}

/**
 * Pure walk over (normalized) assistant parts producing the rendered element
 * list. Nested Task/Agent child tools (toolCallId "parent:child") are grouped
 * onto their parent card, tool-TaskOutput parts are suppressed, error parts
 * become <ErrorMessage>, and all text parts are joined into one trailing
 * markdown block.
 */
export function buildAssistantElements(
  parts: Array<unknown>,
  opts: BuildAssistantElementsOptions
): Array<React.ReactNode> {
  const {
    messageId,
    isLast,
    isStreaming,
    suppressQuestionTool,
    ToolRendererComponent,
    TextRendererComponent,
    toolRenderers,
    onOpenUIAction,
  } = opts

  const elems: Array<React.ReactNode> = []
  const textChunks: Array<string> = []
  const taskPartIds = new Set(
    parts
      .filter(
        (p): p is ToolPartBase =>
          isV5ToolPart(p) &&
          (p.type === "tool-Task" || p.type === "tool-Agent") &&
          typeof p.toolCallId === "string"
      )
      .map((p) => p.toolCallId!)
  )
  const nestedToolsMap = new Map<string, Array<ToolPartBase>>()
  const nestedToolIds = new Set<string>()

  for (const part of parts) {
    if (!isV5ToolPart(part)) continue
    if (part.type === "tool-TaskOutput") continue
    if (!part.toolCallId || !part.toolCallId.includes(":")) continue
    const parentId = part.toolCallId.split(":")[0]
    if (!taskPartIds.has(parentId)) continue
    if (!nestedToolsMap.has(parentId)) {
      nestedToolsMap.set(parentId, [])
    }
    nestedToolsMap.get(parentId)!.push(part)
    nestedToolIds.add(part.toolCallId)
  }

  let i = 0
  while (i < parts.length) {
    const part = parts[i]!

    if (isV5ToolPart(part) && part.type === "tool-TaskOutput") {
      i++
      continue
    }

    if (isTextPart(part)) {
      const text = part.text
      if (text) textChunks.push(text)
      i++
      continue
    }

    if (isErrorPart(part)) {
      elems.push(
        <ErrorMessage
          key={`${messageId}-error-${i}`}
          title={part.title}
          message={part.message}
        />
      )
      i++
      continue
    }

    if (isV5ToolPart(part)) {
      if (suppressQuestionTool && part.type === "tool-Question") {
        i++
        continue
      }
      if (part.toolCallId && nestedToolIds.has(part.toolCallId)) {
        i++
        continue
      }

      const chatStreamingStatus =
        isLast && isStreaming ? "streaming" : undefined
      const toolCallId = part.toolCallId
      const nestedTools =
        (part.type === "tool-Task" || part.type === "tool-Agent") && toolCallId
          ? nestedToolsMap.get(toolCallId) || []
          : undefined
      elems.push(
        <ToolRendererComponent
          key={part.toolCallId ?? `${messageId}-tool-${i}`}
          part={part}
          nestedTools={nestedTools}
          chatStatus={chatStreamingStatus}
          toolRenderers={toolRenderers}
        />
      )
      i++
      continue
    }

    i++
  }

  const text = textChunks.join("\n\n")
  if (text) {
    elems.push(
      <div
        key={`${messageId}-text-final`}
        className="group/assistant-text text-[14px]"
      >
        <TextRendererComponent
          content={text}
          isStreaming={isStreaming}
          messageId={messageId}
          onOpenUIAction={onOpenUIAction}
          className="leading-relaxed [&_p]:leading-relaxed"
        />
      </div>
    )
  }

  return elems
}

function AssistantParts({
  msg,
  isLast,
  isStreaming,
  suppressQuestionTool,
  ToolRendererComponent,
  TextRendererComponent,
  toolRenderers,
  onOpenUIAction,
}: {
  msg: ChatMessage
  isLast: boolean
  isStreaming: boolean
  suppressQuestionTool: boolean
  ToolRendererComponent: React.ComponentType<ToolRendererProps>
  TextRendererComponent: React.ComponentType<TextRendererComponentProps>
  toolRenderers?: Record<string, React.ComponentType<CustomToolRendererProps>>
  onOpenUIAction?: (message: string) => void
}) {
  const parts = useMemo(
    () => normalizeAssistantToolParts(msg.parts ?? []),
    [msg.parts]
  )

  const elements = useMemo(
    () =>
      buildAssistantElements(parts, {
        messageId: msg.id,
        isLast,
        isStreaming,
        suppressQuestionTool,
        ToolRendererComponent,
        TextRendererComponent,
        toolRenderers,
        onOpenUIAction,
      }),
    [
      parts,
      msg.id,
      isLast,
      isStreaming,
      suppressQuestionTool,
      ToolRendererComponent,
      TextRendererComponent,
      toolRenderers,
      onOpenUIAction,
    ]
  )

  if (elements.length > 1) {
    return (
      <div className="group/assistant-turn flex flex-col gap-3">{elements}</div>
    )
  }

  return <div className="group/assistant-turn">{elements}</div>
}
