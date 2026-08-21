import { Popover as BasePopover } from "@base-ui/react/popover"
import { cloneElement, isValidElement, useId } from "react"
import { cn } from "../utils/cn"
import type { ReactNode } from "react"
import type { PopoverPositionerProps } from "@base-ui/react/popover"

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
  collisionAvoidance?: PopoverPositionerProps["collisionAvoidance"]
  collisionPadding?: PopoverPositionerProps["collisionPadding"]
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
  collisionAvoidance = {
    side: "flip",
    align: "shift",
    fallbackAxisSide: "none",
  },
  collisionPadding = 8,
  className,
  overlay = false,
}: PopoverProps) {
  const generatedPopupId = useId()
  const popupId = contentId ?? generatedPopupId

  return (
    <BasePopover.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
    >
      <BasePopover.Trigger
        render={(props) => {
          if (isValidElement<{ className?: string; "aria-controls"?: string }>(trigger)) {
            return cloneElement(trigger, {
              ...props,
              "aria-controls": popupId,
              className: cn(
                "inline-flex",
                trigger.props.className,
                props.className
              ),
            })
          }

          return (
            <button
              {...props}
              type="button"
              aria-controls={popupId}
              className={cn("inline-flex", props.className)}
            >
              {trigger}
            </button>
          )
        }}
      />
      <BasePopover.Portal>
        {overlay && (
          <div className="fixed inset-0 z-40 bg-black/20" aria-hidden="true" />
        )}
        <BasePopover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionAvoidance={collisionAvoidance}
          collisionPadding={collisionPadding}
          className="z-[99]"
        >
          <BasePopover.Popup
            id={popupId}
            className={cn(
              "max-h-[min(320px,var(--available-height,320px))] max-w-[calc(100vw-16px)] min-w-[180px] overflow-y-auto overscroll-contain rounded-[10px] border border-an-border-color bg-an-background p-1 shadow-lg outline-none",
              "text-an-foreground",
              className
            )}
          >
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}
