import { memo } from "react"
import { IconPaperclip, IconPlus } from "@tabler/icons-react"
import type { ReactNode } from "react"

export type AttachmentButtonIcon = "plus" | "paperclip"

export type AttachmentButtonProps = {
  onClick?: () => void
  /**
   * Icon to render inside the button.
   * - "plus" (default): a `+` glyph, matches the generic "add something" affordance.
   * - "paperclip": a paperclip glyph, matches the more literal "attach file" affordance.
   * - Pass any ReactNode to fully override (e.g. a custom svg). The node is
   *   rendered as-is inside the button; size/color from this component's
   *   styling is only applied to the built-in presets.
   */
  icon?: AttachmentButtonIcon | ReactNode
}

function isIconName(value: unknown): value is AttachmentButtonIcon {
  return value === "plus" || value === "paperclip"
}

export const AttachmentButton = memo(function AttachmentButton({
  onClick,
  icon = "plus",
}: AttachmentButtonProps) {
  const iconClassName = "size-4 text-muted-foreground"
  let iconNode: ReactNode
  if (isIconName(icon)) {
    iconNode =
      icon === "paperclip" ? (
        <IconPaperclip className={iconClassName} strokeWidth={2} />
      ) : (
        <IconPlus className={iconClassName} strokeWidth={2} />
      )
  } else {
    iconNode = icon
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-muted"
      aria-label="Attach"
    >
      {iconNode}
    </button>
  )
})
