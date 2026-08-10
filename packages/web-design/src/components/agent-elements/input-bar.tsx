"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "./utils/cn"

import { SendButton } from "./input/send-button"
import { AttachmentButton } from "./input/attachment-button"
import { FileAttachment } from "./input/file-attachment"
import { InputInfoBar } from "./input/info-bar"
import { InputQuestionBar } from "./input/question-bar"
import { useInputTyping } from "./input/input-typing"
import { Suggestions } from "./input/suggestions"
import { useQuestionBarNavigation } from "./hooks/use-question-bar-navigation"
import type { InputInfoBarData } from "./input/info-bar"
import type { SuggestionItem } from "./input/suggestions"
import type { ChatStatus } from "@prime-agent/web-protocol/chat-types"
import type { QuestionBarData } from "./hooks/use-question-bar-navigation"
import type { RefObject } from "react"

type SuggestionConfig =
  | Array<SuggestionItem>
  | {
      items: Array<SuggestionItem>
      className?: string
      itemClassName?: string
    }

const DEFAULT_PLACEHOLDER = "Send a message..."

export type AttachedImage = {
  id: string
  filename: string
  url: string
  size?: number
}

export type AttachedFile = {
  id: string
  filename: string
  size?: number
}

export type InputBarAttachmentsConfig = {
  onAttach?: () => void
  images?: Array<AttachedImage>
  files?: Array<AttachedFile>
  onRemoveImage?: (id: string) => void
  onRemoveFile?: (id: string) => void
  onPaste?: (e: React.ClipboardEvent) => void
  isDragOver?: boolean
  /**
   * When true (default) clicking a staged image attachment opens a
   * fullscreen lightbox preview. Set to false to render thumbnails as
   * plain non-interactive previews.
   */
  enableImagePreview?: boolean
  /** Toolbar position of the attachment button. Defaults to "left". */
  buttonPosition?: "left" | "right"
  /** How staged attachments render above the input. Defaults to "thumbnail". */
  previewStyle?: "thumbnail" | "chip" | "hidden"
}

export type InputBarControlledConfig = {
  value: string
  onChange: (value: string) => void
}

export type InputBarProps = {
  onSend: (message: {
    role: "user"
    content: string
    /** True when Alt/Option was held during Enter (follow-up vs steering). */
    altKey?: boolean
  }) => void
  status: ChatStatus
  onStop: () => void
  placeholder?: string
  className?: string

  // Attachment support
  attachments?: InputBarAttachmentsConfig
  /** @deprecated Pass `attachments.onAttach` instead. */
  onAttach?: () => void
  /** @deprecated Pass `attachments.images` instead. */
  attachedImages?: Array<AttachedImage>
  /** @deprecated Pass `attachments.files` instead. */
  attachedFiles?: Array<AttachedFile>
  /** @deprecated Pass `attachments.onRemoveImage` instead. */
  onRemoveImage?: (id: string) => void
  /** @deprecated Pass `attachments.onRemoveFile` instead. */
  onRemoveFile?: (id: string) => void
  /** @deprecated Pass `attachments.onPaste` instead. */
  onPaste?: (e: React.ClipboardEvent) => void
  /** @deprecated Pass `attachments.isDragOver` instead. */
  isDragOver?: boolean
  /**
   * @deprecated Pass `attachments.enableImagePreview` instead.
   *
   * When true (default) clicking a staged image attachment opens a
   * fullscreen lightbox preview. Set to false to render thumbnails as
   * plain non-interactive previews.
   */
  enableImagePreview?: boolean

  // Controlled mode
  controlled?: InputBarControlledConfig
  /** @deprecated Pass `controlled.value` instead. */
  value?: string
  /** @deprecated Pass `controlled.onChange` instead. */
  onChange?: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
  suggestions?: SuggestionConfig
  slashCommands?: SuggestionConfig
  /**
   * Called when a slash suggestion is chosen (click / Enter / Tab).
   * Return `true` to consume the selection (do not insert text into the input).
   */
  onSlashCommandSelect?: (item: SuggestionItem) => boolean | void

  // Typing animation
  typingAnimation?: {
    text: string
    duration: number
    image?: string
    isActive: boolean
    onComplete: () => void
  }

  infoBar?: InputInfoBarData

  questionBar?: QuestionBarData

  /** Content rendered on the left of the toolbar, next to the attachment button. */
  leftActions?: React.ReactNode
  /** Content rendered on the right of the toolbar, before the send button. */
  rightActions?: React.ReactNode
}

export const InputBar = memo(function InputBar(props: InputBarProps) {
  const {
    onSend,
    status,
    onStop,
    placeholder,
    className,
    attachments,
    // Deprecated flat aliases — mapped into the grouped shapes below.
    onAttach: legacyOnAttach,
    attachedImages: legacyAttachedImages,
    attachedFiles: legacyAttachedFiles,
    onRemoveImage: legacyOnRemoveImage,
    onRemoveFile: legacyOnRemoveFile,
    onPaste: legacyOnPaste,
    isDragOver: legacyIsDragOver,
    enableImagePreview: legacyEnableImagePreview,
    controlled,
    value: legacyValue,
    onChange: legacyOnChange,
    disabled,
    autoFocus,
    suggestions = [],
    typingAnimation,
    infoBar,
    questionBar,
    leftActions,
    rightActions,
    slashCommands = [],
    onSlashCommandSelect,
  } = props

  if (
    legacyOnAttach !== undefined ||
    legacyAttachedImages !== undefined ||
    legacyAttachedFiles !== undefined ||
    legacyOnRemoveImage !== undefined ||
    legacyOnRemoveFile !== undefined ||
    legacyOnPaste !== undefined ||
    legacyIsDragOver !== undefined ||
    legacyEnableImagePreview !== undefined ||
    legacyValue !== undefined ||
    legacyOnChange !== undefined
  ) {
    console.warn(
      "[InputBar] The flat props `onAttach`, `attachedImages`, `attachedFiles`, `onRemoveImage`, `onRemoveFile`, `onPaste`, `isDragOver`, `enableImagePreview`, `value` and `onChange` are deprecated. Pass the `attachments` and `controlled` config objects instead."
    )
  }

  const onAttach = attachments?.onAttach ?? legacyOnAttach
  const attachedImages = attachments?.images ?? legacyAttachedImages ?? []
  const attachedFiles = attachments?.files ?? legacyAttachedFiles ?? []
  const onRemoveImage = attachments?.onRemoveImage ?? legacyOnRemoveImage
  const onRemoveFile = attachments?.onRemoveFile ?? legacyOnRemoveFile
  const onPaste = attachments?.onPaste ?? legacyOnPaste
  const isDragOver = attachments?.isDragOver ?? legacyIsDragOver
  const enableImagePreview =
    attachments?.enableImagePreview ?? legacyEnableImagePreview ?? true
  const attachRight = (attachments?.buttonPosition ?? "left") === "right"
  const previewStyle = attachments?.previewStyle ?? "thumbnail"

  const isControlled = controlled !== undefined || legacyValue !== undefined
  const controlledValue = controlled ? controlled.value : legacyValue
  const controlledOnChange = controlled ? controlled.onChange : legacyOnChange

  const [internalInput, setInternalInput] = useState("")
  const [isInfoBarOpen, setIsInfoBarOpen] = useState(true)
  const [dismissedQuestionId, setDismissedQuestionId] = useState<string | null>(
    null
  )
  const input = isControlled ? (controlledValue ?? "") : internalInput
  const setInput = useCallback(
    (v: string) => {
      if (isControlled) {
        controlledOnChange?.(v)
      } else {
        setInternalInput(v)
      }
    },
    [isControlled, controlledOnChange]
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isStreaming = status === "streaming" || status === "submitted"
  const isTyping = typingAnimation?.isActive ?? false

  const { displayedText, showImage } = useInputTyping(
    typingAnimation?.text ?? "",
    typingAnimation?.duration ?? 2000,
    isTyping,
    typingAnimation?.onComplete ?? (() => {})
  )

  const effectivePlaceholder = placeholder ?? DEFAULT_PLACEHOLDER

  const showAttach = Boolean(onAttach)

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "0"
    const nextHeight = Math.min(el.scrollHeight, 120)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > 120 ? "auto" : "hidden"
    el.style.overflowX = "hidden"
  }, [input])

  useEffect(() => {
    if (!autoFocus) return
    textareaRef.current?.focus()
  }, [autoFocus])

  const handleSubmit = useCallback(
    (opts?: { altKey?: boolean }) => {
      const trimmed = input.trim()
      if (!trimmed || isStreaming || disabled) return
      onSend({ role: "user", content: trimmed, altKey: opts?.altKey })
      setInput("")
    },
    [input, isStreaming, disabled, onSend, setInput]
  )

  const handleInfoBarClose = useCallback(() => {
    setIsInfoBarOpen(false)
    infoBar?.onClose?.()
  }, [infoBar])

  const infoBarPosition = infoBar?.position ?? "top"
  const shouldShowInfoBar = Boolean(
    infoBar && (infoBar.title || infoBar.description)
  )

  const infoBarNode =
    shouldShowInfoBar && infoBar ? (
      <InputInfoBar
        infoBar={infoBar}
        isOpen={isInfoBarOpen}
        position={infoBarPosition}
        onClose={handleInfoBarClose}
      />
    ) : null

  const shouldShowQuestionBar = Boolean(
    questionBar && questionBar.id !== dismissedQuestionId
  )
  const questionBarNavigation = useQuestionBarNavigation(questionBar)

  const questionBarNode =
    shouldShowQuestionBar && questionBar ? (
      <InputQuestionBar
        questionBar={questionBar}
        navigation={questionBarNavigation}
        roundedTop={!shouldShowInfoBar || infoBarPosition === "bottom"}
        onDismiss={setDismissedQuestionId}
      />
    ) : null

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSubmit({ altKey: e.altKey })
      }
    },
    [handleSubmit]
  )

  const hasInput = input.trim().length > 0
  const hasContextItems = attachedImages.length > 0 || attachedFiles.length > 0
  const showContextItems = hasContextItems && previewStyle !== "hidden"
  const imageDisplayMode = previewStyle === "thumbnail" ? "image-only" : "chip"

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (
      e.target === e.currentTarget ||
      !(e.target as HTMLElement).closest("button, textarea")
    ) {
      textareaRef.current?.focus()
    }
  }, [])

  return (
    <div className={cn("shrink-0 px-3 pb-3", className)}>
      <div className="relative mx-auto max-w-an">
        <InputSuggestionsOverlay
          disabled={disabled}
          input={input}
          isStreaming={isStreaming}
          onSlashCommandSelect={onSlashCommandSelect}
          setInput={setInput}
          slashCommands={slashCommands}
          suggestions={suggestions}
          textareaRef={textareaRef}
        />
        <div
          className={cn(
            "flex flex-col gap-0",
            shouldShowInfoBar
              ? "rounded-an-input-border-radius bg-an-background-tertiary"
              : null
          )}
        >
          {infoBarPosition === "top" && infoBarNode}
          {questionBarNode}
          <div
            className={cn(
              "relative cursor-text rounded-an-input-border-radius bg-an-input-background shadow-2xs ring-1 ring-foreground/10",
              isDragOver && "ring-2 ring-an-primary-color"
            )}
            onClick={handleContainerClick}
          >
            {/* Context items (attached images/files) */}
            <div
              className={cn(
                "grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out",
                showContextItems && "grid-rows-[1fr]"
              )}
            >
              <div className="overflow-hidden">
                {showContextItems && (
                  <div className="flex flex-wrap items-center gap-[6px] px-an-context-padding pt-an-context-padding pb-0.5">
                    {attachedImages.map((img) => (
                      <FileAttachment
                        key={img.id}
                        id={img.id}
                        filename={img.filename}
                        size={img.size}
                        isImage
                        url={img.url}
                        display={imageDisplayMode}
                        enableImagePreview={enableImagePreview}
                        onRemove={
                          onRemoveImage
                            ? () => onRemoveImage(img.id)
                            : undefined
                        }
                      />
                    ))}
                    {attachedFiles.map((file) => (
                      <FileAttachment
                        key={file.id}
                        id={file.id}
                        filename={file.filename}
                        size={file.size}
                        onRemove={
                          onRemoveFile ? () => onRemoveFile(file.id) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Typing animation image */}
            {isTyping && typingAnimation?.image && showImage && (
              <div className="flex flex-wrap gap-2 px-3 pt-3">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
                  <img
                    src={typingAnimation.image}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
              </div>
            )}

            {/* Text input or typing animation text */}
            <div className="min-h-[44px] pt-3 pr-3 pb-0 pl-3.5">
              {isTyping ? (
                <div className="w-full text-[14px] leading-[1.6] text-an-foreground-muted">
                  <span>{displayedText}</span>
                  <span className="animate-an-blink ml-px inline-block h-[1em] w-[2px] bg-an-foreground align-text-bottom" />
                </div>
              ) : (
                <>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={onPaste}
                    placeholder={effectivePlaceholder}
                    disabled={disabled}
                    rows={1}
                    className={cn(
                      "peer w-full resize-none border-0 bg-transparent text-[14px] leading-[1.6] text-an-foreground outline-none placeholder:text-an-input-placeholder-color",
                      "overflow-hidden",
                      disabled && "cursor-not-allowed opacity-50"
                    )}
                  />
                  <div className="pointer-events-none absolute inset-0 z-20 rounded-an-input-border-radius opacity-0 outline-2 outline-an-input-focus-outline transition-opacity duration-75 ease-in-out peer-focus:opacity-100 peer-focus-visible:opacity-100" />
                </>
              )}
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-2">
              <div className="flex min-w-0 items-center gap-1">
                {!attachRight && showAttach && onAttach && (
                  <AttachmentButton onClick={onAttach} />
                )}
                {leftActions}
              </div>
              <div className="flex items-center gap-1">
                {rightActions}
                {attachRight && showAttach && onAttach && (
                  <AttachmentButton onClick={onAttach} />
                )}
                {/* Send / Stop button */}
                <SendButton
                  state={
                    isStreaming
                      ? "streaming"
                      : hasInput && !disabled
                        ? "typing"
                        : "idle"
                  }
                  onClick={() => {
                    if (isStreaming) {
                      onStop()
                    } else if (hasInput) {
                      handleSubmit()
                    }
                  }}
                />
              </div>
            </div>
          </div>
          {infoBarPosition === "bottom" && infoBarNode}
        </div>
      </div>
    </div>
  )
})

function InputSuggestionsOverlay({
  disabled,
  input,
  isStreaming,
  onSlashCommandSelect,
  setInput,
  slashCommands,
  suggestions,
  textareaRef,
}: {
  disabled?: boolean
  input: string
  isStreaming: boolean
  onSlashCommandSelect?: (item: SuggestionItem) => boolean | void
  setInput: (value: string) => void
  slashCommands: SuggestionConfig
  suggestions: SuggestionConfig
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  const suggestionConfig = resolveSuggestionConfig(suggestions)
  const slashCommandConfig = resolveSuggestionConfig(slashCommands)
  const slashQuery = input.match(/^\/([^\s/]*)$/)?.[1]?.toLowerCase()
  const [activeIndex, setActiveIndex] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const filteredSlashCommands = useMemo(() => {
    if (slashQuery === undefined) return []
    return slashCommandConfig.items.filter((item) =>
      `${item.id} ${item.label} ${item.value ?? ""}`
        .toLowerCase()
        .includes(slashQuery)
    )
  }, [slashCommandConfig.items, slashQuery])
  const interactionsDisabled = disabled || isStreaming
  const showSlashCommands =
    filteredSlashCommands.length > 0 && !interactionsDisabled && !slashDismissed

  useEffect(() => {
    setSlashDismissed(false)
  }, [slashQuery])

  useEffect(() => {
    setActiveIndex(0)
  }, [slashQuery, filteredSlashCommands.length])

  const focusEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      el.setSelectionRange(end, end)
    })
  }, [textareaRef])

  const handleSuggestionSelect = useCallback(
    (item: SuggestionItem) => {
      if (interactionsDisabled) return
      setInput(item.value ?? item.label)
      focusEnd()
    },
    [focusEnd, interactionsDisabled, setInput]
  )

  const handleSlashCommandSelect = useCallback(
    (item: SuggestionItem) => {
      if (interactionsDisabled) return
      if (onSlashCommandSelect?.(item) === true) {
        setInput("")
        setSlashDismissed(true)
        return
      }
      const command = item.value ?? item.label
      setInput(command.endsWith(" ") ? command : `${command} `)
      focusEnd()
    },
    [focusEnd, interactionsDisabled, onSlashCommandSelect, setInput]
  )

  useEffect(() => {
    const el = textareaRef.current
    if (!el || !showSlashCommands) return

    const onKeyDown = (event: KeyboardEvent) => {
      const count = filteredSlashCommands.length
      if (count === 0) return

      if (event.key === "ArrowDown") {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((prev) => (prev + 1) % count)
        return
      }

      if (event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        setActiveIndex((prev) => (prev - 1 + count) % count)
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setSlashDismissed(true)
        return
      }

      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        const item = filteredSlashCommands[activeIndex]
        if (!item) return
        event.preventDefault()
        event.stopPropagation()
        handleSlashCommandSelect(item)
      }
    }

    el.addEventListener("keydown", onKeyDown, true)
    return () => el.removeEventListener("keydown", onKeyDown, true)
  }, [
    activeIndex,
    filteredSlashCommands,
    handleSlashCommandSelect,
    showSlashCommands,
    textareaRef,
  ])

  if (showSlashCommands) {
    return (
      <SuggestionsPopover
        activeIndex={activeIndex}
        className={cn(
          "max-h-[min(40vh,280px)] flex-col flex-nowrap items-stretch gap-1 overflow-y-auto overscroll-contain rounded-an-input-border-radius border border-border/70 bg-an-input-background p-1 shadow-lg",
          slashCommandConfig.className
        )}
        disabled={interactionsDisabled}
        itemClassName={cn(
          "h-8 shrink-0 justify-start rounded-[6px] border-transparent px-2 text-left font-mono text-[12px]",
          slashCommandConfig.itemClassName
        )}
        items={filteredSlashCommands}
        onActiveIndexChange={setActiveIndex}
        onSelect={handleSlashCommandSelect}
      />
    )
  }

  if (suggestionConfig.items.length === 0) return null

  return (
    <SuggestionsPopover
      className={cn("px-0", suggestionConfig.className)}
      disabled={interactionsDisabled}
      itemClassName={suggestionConfig.itemClassName}
      items={suggestionConfig.items}
      onSelect={handleSuggestionSelect}
    />
  )
}

function SuggestionsPopover({
  activeIndex,
  className,
  disabled,
  itemClassName,
  items,
  onActiveIndexChange,
  onSelect,
}: {
  activeIndex?: number
  className?: string
  disabled?: boolean
  itemClassName?: string
  items: Array<SuggestionItem>
  onActiveIndexChange?: (index: number) => void
  onSelect: (item: SuggestionItem) => void
}) {
  return (
    <div className="absolute right-0 bottom-full left-0 pb-2">
      <Suggestions
        activeIndex={activeIndex}
        className={className}
        disabled={disabled}
        itemClassName={itemClassName}
        items={items}
        onActiveIndexChange={onActiveIndexChange}
        onSelect={onSelect}
      />
    </div>
  )
}

function resolveSuggestionConfig(config: SuggestionConfig) {
  return Array.isArray(config)
    ? { items: config }
    : {
        items: config.items,
        className: config.className,
        itemClassName: config.itemClassName,
      }
}
