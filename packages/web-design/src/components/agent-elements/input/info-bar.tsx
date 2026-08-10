import { IconX } from "@tabler/icons-react"
import { cn } from "../utils/cn"

export type InputInfoBarData = {
  title?: string
  description?: string
  onClose?: () => void
  position?: "top" | "bottom"
  /** Optional primary action rendered on the right (e.g. "Upgrade"). */
  action?: {
    label: string
    onClick: () => void
  }
}

export type InputInfoBarProps = {
  infoBar: InputInfoBarData
  isOpen: boolean
  position: "top" | "bottom"
  onClose: () => void
}

export function InputInfoBar({
  infoBar,
  isOpen,
  position,
  onClose,
}: InputInfoBarProps) {
  return (
    <div
      className={cn(
        "flex h-[34px] items-center justify-between gap-3 px-3",
        "overflow-hidden transition-[max-height,opacity] duration-150 ease-out",
        isOpen ? "max-h-[34px] opacity-100" : "max-h-0 opacity-0",
        position === "top"
          ? "rounded-t-an-input-border-radius"
          : "rounded-b-an-input-border-radius"
      )}
    >
      <div className="min-w-0 truncate text-xs text-an-foreground">
        {infoBar.title && <span className="font-medium">{infoBar.title}</span>}
        {infoBar.description && (
          <span className="text-an-foreground-muted/80">
            {infoBar.title ? ` ${infoBar.description}` : infoBar.description}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {infoBar.action && (
          <button
            type="button"
            onClick={infoBar.action.onClick}
            className="h-6 rounded-[4px] bg-an-primary-color px-2 text-xs font-medium text-an-send-button-color transition-[background-color,transform] duration-150 hover:bg-an-primary-color/90 active:scale-[0.96]"
          >
            {infoBar.action.label}
          </button>
        )}
        {infoBar.onClose && (
          <button
            type="button"
            onClick={onClose}
            className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-an-foreground-muted/70 transition-[background-color,color,transform] duration-150 after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2 hover:bg-an-background-secondary hover:text-an-foreground active:scale-[0.96]"
            aria-label="Close"
          >
            <IconX className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
