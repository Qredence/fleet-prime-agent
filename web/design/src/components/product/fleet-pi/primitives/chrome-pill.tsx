import { cn } from "../../../../lib/utils"
import { Button } from "../../../ui/button"
import {
  CHROME_PILL_ACTIVE_CLASS,
  CHROME_PILL_CLASS,
  CHROME_PILL_INACTIVE_CLASS,
} from "../styles/tokens"
import type { ComponentProps } from "react"

type ChromePillButtonProps = Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "size" | "variant"
> & {
  active?: boolean
  ariaLabel: string
}

export function ChromePillButton({
  active = false,
  ariaLabel,
  className,
  title,
  ...props
}: ChromePillButtonProps) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        CHROME_PILL_CLASS,
        active ? CHROME_PILL_ACTIVE_CLASS : CHROME_PILL_INACTIVE_CLASS,
        className
      )}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
    />
  )
}
