import { AttachmentButton } from "./attachment-button"
import { FileAttachment } from "./file-attachment"
import { SendButton } from "./send-button"
import { cn } from "../utils/cn"
import type { AttachedFile, AttachedImage } from "../input-bar"
import type {
  ClipboardEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
} from "react"

type InputBarSurfaceAttachments = {
  attachedFiles: Array<AttachedFile>
  attachedImages: Array<AttachedImage>
  enableImagePreview: boolean
  imageDisplayMode: "image-only" | "chip"
  onRemoveFile?: (id: string) => void
  onRemoveImage?: (id: string) => void
  showContextItems: boolean
}

type InputBarSurfaceEditor = {
  disabled?: boolean
  displayedText: string
  effectivePlaceholder: string
  input: string
  isTyping: boolean
  onInputChange: (value: string) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  showImage: boolean
  textareaRef: RefObject<HTMLTextAreaElement | null>
  typingImage?: string
}

type InputBarSurfaceLayout = {
  infoBar: ReactNode
  infoBarPosition: "top" | "bottom"
  isDragOver?: boolean
  onContainerClick: (event: MouseEvent) => void
  questionBar: ReactNode
  showInfoBar: boolean
}

type InputBarSurfaceToolbar = {
  attachRight: boolean
  hasInput: boolean
  isStreaming: boolean
  leftActions?: ReactNode
  onAttach?: () => void
  onStop: () => void
  onSubmit: () => void
  rightActions?: ReactNode
  showAttach: boolean
}

export type InputBarSurfaceProps = {
  attachments: InputBarSurfaceAttachments
  editor: InputBarSurfaceEditor
  layout: InputBarSurfaceLayout
  toolbar: InputBarSurfaceToolbar
}

export function InputBarSurface({
  attachments,
  editor,
  layout,
  toolbar,
}: InputBarSurfaceProps) {
  const {
    attachedFiles,
    attachedImages,
    enableImagePreview,
    imageDisplayMode,
    onRemoveFile,
    onRemoveImage,
    showContextItems,
  } = attachments
  const {
    disabled,
    displayedText,
    effectivePlaceholder,
    input,
    isTyping,
    onInputChange,
    onPaste,
    onTextareaKeyDown,
    showImage,
    textareaRef,
    typingImage,
  } = editor
  const {
    infoBar,
    infoBarPosition,
    isDragOver,
    onContainerClick,
    questionBar,
    showInfoBar,
  } = layout
  const {
    attachRight,
    hasInput,
    isStreaming,
    leftActions,
    onAttach,
    onStop,
    onSubmit,
    rightActions,
    showAttach,
  } = toolbar

  return (
    <div
      className={cn(
        "flex flex-col gap-0",
        showInfoBar ? "rounded-an-input-border-radius bg-an-background-tertiary" : null
      )}
    >
      {infoBarPosition === "top" && infoBar}
      {questionBar}
      <div
        className={cn(
          "relative cursor-text rounded-an-input-border-radius bg-an-input-background shadow-2xs ring-1 ring-foreground/10",
          isDragOver && "ring-2 ring-an-primary-color"
        )}
        onClick={onContainerClick}
        role="presentation"
      >
        <div
          className={cn(
            "grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out",
            showContextItems && "grid-rows-[1fr]"
          )}
        >
          <div className="overflow-hidden">
            {showContextItems ? (
              <div className="flex flex-wrap items-center gap-[6px] px-an-context-padding pt-an-context-padding pb-0.5">
                {attachedImages.map((image) => (
                  <FileAttachment
                    key={image.id}
                    id={image.id}
                    filename={image.filename}
                    size={image.size}
                    isImage
                    url={image.url}
                    display={imageDisplayMode}
                    enableImagePreview={enableImagePreview}
                    onRemove={
                      onRemoveImage
                        ? () => onRemoveImage(image.id)
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
            ) : null}
          </div>
        </div>

        {isTyping && typingImage && showImage ? (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
              <img src={typingImage} alt="" className="h-full w-full object-cover" />
            </div>
          </div>
        ) : null}

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
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={onTextareaKeyDown}
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

        <div className="flex items-center justify-between gap-3 px-2 pt-1 pb-2">
          <div className="flex min-w-0 items-center gap-1">
            {!attachRight && showAttach && onAttach ? (
              <AttachmentButton onClick={onAttach} />
            ) : null}
            {leftActions}
          </div>
          <div className="flex items-center gap-1">
            {rightActions}
            {attachRight && showAttach && onAttach ? (
              <AttachmentButton onClick={onAttach} />
            ) : null}
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
                  onSubmit()
                }
              }}
            />
          </div>
        </div>
      </div>
      {infoBarPosition === "bottom" && infoBar}
    </div>
  )
}
