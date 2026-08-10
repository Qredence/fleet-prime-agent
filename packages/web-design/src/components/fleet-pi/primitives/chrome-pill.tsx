import { cn } from "../../../lib/utils"
import {
  CHROME_PILL_ACTIVE_CLASS,
  CHROME_PILL_CLASS,
  CHROME_PILL_INACTIVE_CLASS,
} from "../styles/tokens"
import type { ReactNode } from "react"

export function ChromePillButton({
  active = false,
  ariaLabel,
  children,
  className,
  onClick,
}: {
  active?: boolean
  ariaLabel: string
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        CHROME_PILL_CLASS,
        active ? CHROME_PILL_ACTIVE_CLASS : CHROME_PILL_INACTIVE_CLASS,
        className
      )}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {children}
    </button>
  )
}
