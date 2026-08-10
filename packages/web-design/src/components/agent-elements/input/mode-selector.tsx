"use client"

import { memo, useCallback, useState } from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import { cn } from "../utils/cn"
import { Popover } from "./popover"
import type { ComponentType } from "react"

export type ModeOption = {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  description?: string
}

export type ModeSelectorProps = {
  modes: Array<ModeOption>
  value?: string
  defaultValue?: string
  onChange?: (modeId: string) => void
  className?: string
}

export const ModeSelector = memo(function ModeSelector({
  modes,
  value,
  defaultValue,
  onChange,
  className,
}: ModeSelectorProps) {
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState(defaultValue)
  const activeId = isControlled ? value : internalValue
  const activeMode = modes.find((m) => m.id === activeId) ?? modes[0]
  const [open, setOpen] = useState(false)

  const handleSelect = useCallback(
    (id: string) => {
      if (!isControlled) setInternalValue(id)
      onChange?.(id)
      setOpen(false)
    },
    [isControlled, onChange]
  )

  if (modes.length === 0) return null
  const ActiveIcon = activeMode?.icon
  const hasMultiple = modes.length > 1

  const trigger = (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2 text-[12px] leading-4 text-foreground/40 transition-[background-color,transform] duration-150 after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5 hover:bg-foreground/6 active:scale-[0.96]",
        !hasMultiple && "pointer-events-none",
        className
      )}
      aria-label="Select mode"
    >
      {ActiveIcon && <ActiveIcon className="size-3.5 shrink-0" />}
      <span className="font-medium">{activeMode?.label}</span>
      {hasMultiple && <IconChevronDown className="size-3 text-foreground/40" />}
    </button>
  )

  if (!hasMultiple) return trigger

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      trigger={trigger}
    >
      {modes.map((mode) => {
        const isActive = mode.id === activeMode?.id
        const Icon = mode.icon
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => handleSelect(mode.id)}
            className={cn(
              "flex w-full cursor-pointer items-start gap-2 rounded-[6px] px-2 py-2 text-left text-[12px] leading-4 text-foreground transition-[background-color,transform] duration-150 hover:bg-foreground/6 active:scale-[0.96]",
              isActive && "bg-foreground/6"
            )}
          >
            {Icon && <Icon className="mt-0.5 size-3.5 shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{mode.label}</span>
              {mode.description && (
                <span className="block truncate text-foreground/40">
                  {mode.description}
                </span>
              )}
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
