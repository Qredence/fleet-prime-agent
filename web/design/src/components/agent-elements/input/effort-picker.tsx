import { memo, useCallback, useState } from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import type { ChatThinkingLevel } from "@prime-agent/web-protocol/chat-protocol"
import {
  THINKING_LEVEL_DESCRIPTIONS,
  thinkingLevelLabel,
} from "../../../lib/pi/chat-helpers"
import { cn } from "../utils/cn"
import { Popover } from "./popover"

export type EffortPickerProps = {
  levels: Array<ChatThinkingLevel>
  value?: ChatThinkingLevel
  onChange?: (level: ChatThinkingLevel) => void
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const EffortPicker = memo(function EffortPicker({
  levels,
  value,
  onChange,
  className,
  open: controlledOpen,
  onOpenChange,
}: EffortPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpenControlled = controlledOpen !== undefined
  const open = isOpenControlled ? controlledOpen : uncontrolledOpen
  const activeLevel = value && levels.includes(value) ? value : levels[0]
  const effortLabel = activeLevel ? thinkingLevelLabel(activeLevel) : "Effort"

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isOpenControlled) setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [isOpenControlled, onOpenChange]
  )

  const handleSelect = useCallback(
    (level: ChatThinkingLevel) => {
      onChange?.(level)
      handleOpenChange(false)
    },
    [handleOpenChange, onChange]
  )

  if (levels.length === 0) return null

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      side="top"
      align="start"
      className="w-[220px]"
      trigger={
        <button
          type="button"
          className={cn(
            "relative inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-2 text-[12px] leading-4 text-foreground/40 transition-[background-color,transform] duration-150 after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5 hover:bg-foreground/6 active:scale-[0.96]",
            className
          )}
          aria-label="Select effort"
        >
          <span className="font-medium">{effortLabel}</span>
          <IconChevronDown className="size-3 shrink-0 text-foreground/40" />
        </button>
      }
    >
      {levels.map((level) => {
        const isActive = level === activeLevel
        const label = thinkingLevelLabel(level)
        return (
          <button
            key={level}
            type="button"
            aria-current={isActive ? "true" : undefined}
            onClick={() => handleSelect(level)}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2 rounded-[6px] px-2 py-2 text-left text-[12px] leading-4 text-an-foreground transition-[background-color,transform] duration-150 hover:bg-foreground/6 active:scale-[0.96]",
              isActive && "bg-foreground/6"
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{label}</span>
              <span className="block truncate text-foreground/40">
                {THINKING_LEVEL_DESCRIPTIONS[level]}
              </span>
            </span>
            {isActive && (
              <IconCheck className="mt-0.5 size-3.5 shrink-0 text-foreground/60" />
            )}
          </button>
        )
      })}
    </Popover>
  )
})
