import { isValidElement, useId, useState } from "react"
import {
  Popover as PopoverRoot,
  PopoverContent,
  PopoverTrigger,
} from "@prime-agent/web-design/components/ui/popover"
import { Button } from "@prime-agent/web-design/components/ui/button"
import { cn } from "../utils/cn"
import type { ReactNode } from "react"

export type PopoverSide = "top" | "bottom" | "left" | "right"
export type PopoverAlign = "start" | "center" | "end"

export type PopoverProps = {
  trigger: ReactNode
  children: ReactNode
  contentId?: string
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  side?: PopoverSide
  align?: PopoverAlign
  sideOffset?: number
  className?: string
  overlay?: boolean
}

export function Popover({
  trigger,
  children,
  contentId,
  open,
  defaultOpen,
  onOpenChange,
  side = "top",
  align = "start",
  sideOffset = 6,
  className,
  overlay = false,
}: PopoverProps) {
  const generatedPopupId = useId()
  const popupId = contentId ?? generatedPopupId
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false)
  const resolvedOpen = open ?? uncontrolledOpen

  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  return (
    <PopoverRoot
      open={resolvedOpen}
      onOpenChange={handleOpenChange}
    >
      {isValidElement(trigger) ? (
        <PopoverTrigger
          render={trigger}
          aria-controls={popupId}
          className="inline-flex"
        />
      ) : (
        <PopoverTrigger
          render={
            <Button type="button" variant="ghost">
              {trigger}
            </Button>
          }
          aria-controls={popupId}
          className="inline-flex"
        />
      )}
      {overlay && resolvedOpen ? (
        <div className="fixed inset-0 z-40 bg-black/20" aria-hidden="true" />
      ) : null}
      <PopoverContent
        id={popupId}
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "max-h-[min(320px,var(--available-height,320px))] max-w-[calc(100vw-16px)] min-w-[180px] overflow-y-auto overscroll-contain p-1",
          className
        )}
      >
        {children}
      </PopoverContent>
    </PopoverRoot>
  )
}
