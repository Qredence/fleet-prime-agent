"use client"

import { memo, useCallback, useState } from "react"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import { cn } from "../utils/cn"
import { Popover } from "./popover"
import type { ModelOption } from "../types"

export type ModelPickerProps = {
  models: Array<ModelOption>
  value?: string
  defaultValue?: string
  onChange?: (modelId: string) => void
  placeholder?: string
  className?: string
  /** Controlled open state for the model popover. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const ModelPicker = memo(function ModelPicker({
  models,
  value,
  defaultValue,
  onChange,
  placeholder = "Auto",
  className,
  open: controlledOpen,
  onOpenChange,
}: ModelPickerProps) {
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = useState(defaultValue)
  const activeId = isControlled ? value : internalValue
  const activeModel = models.find((m) => m.id === activeId) ?? models[0]
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpenControlled = controlledOpen !== undefined
  const open = isOpenControlled ? controlledOpen : uncontrolledOpen

  const scrollActiveModelIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = document.querySelector<HTMLElement>(
          '[data-agent-model-picker-active="true"]'
        )
        const popup = node?.closest<HTMLElement>('[role="dialog"]')
        if (!node || !popup) return

        popup.scrollTop = Math.max(
          0,
          node.offsetTop - popup.clientHeight / 2 + node.clientHeight / 2
        )
      })
    })
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!isOpenControlled) setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
      if (nextOpen) scrollActiveModelIntoView()
    },
    [isOpenControlled, onOpenChange, scrollActiveModelIntoView]
  )

  const handleSelect = useCallback(
    (id: string) => {
      if (!isControlled) setInternalValue(id)
      onChange?.(id)
      handleOpenChange(false)
    },
    [handleOpenChange, isControlled, onChange]
  )

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      side="top"
      align="start"
      className="w-[260px]"
      trigger={
        <button
          type="button"
          className={cn(
            "relative inline-flex h-7 max-w-full cursor-pointer items-center gap-1 rounded-full px-2 text-[12px] leading-4 text-foreground/40 transition-[background-color,transform] duration-150 after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5 hover:bg-foreground/6 active:scale-[0.96]",
            className
          )}
          aria-label="Select model"
        >
          <span className="min-w-0 truncate font-medium">
            {activeModel?.name ?? placeholder}
          </span>
          {activeModel?.version && (
            <span className="shrink-0 font-normal text-foreground/25">
              {activeModel.version}
            </span>
          )}
          <IconChevronDown className="size-3 shrink-0 text-foreground/40" />
        </button>
      }
    >
      {models.map((model) => {
        const isActive = model.id === activeModel?.id
        return (
          <button
            key={model.id}
            type="button"
            aria-current={isActive ? "true" : undefined}
            data-agent-model-picker-active={isActive ? "true" : undefined}
            onClick={() => handleSelect(model.id)}
            className={cn(
              "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-[6px] px-2 py-2 text-left text-[12px] leading-4 text-an-foreground transition-[background-color,transform] duration-150 hover:bg-foreground/6 active:scale-[0.96]",
              isActive && "bg-foreground/6"
            )}
          >
            <span className="min-w-0 flex-1 truncate">
              {model.name}
              {model.version && (
                <span className="ml-1 text-foreground/40">{model.version}</span>
              )}
            </span>
            {isActive && (
              <IconCheck className="size-3.5 shrink-0 text-foreground/60" />
            )}
          </button>
        )
      })}
    </Popover>
  )
})

export type ModelBadgeProps = {
  models: Array<ModelOption>
  value?: string
  placeholder?: string
  className?: string
}

export const ModelBadge = memo(function ModelBadge({
  models,
  value,
  placeholder = "Auto",
  className,
}: ModelBadgeProps) {
  const activeModel = models.find((m) => m.id === value) ?? models[0]
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center px-2 text-[12px] leading-4 text-foreground/30",
        className
      )}
    >
      <span className="font-medium">{activeModel?.name ?? placeholder}</span>
      {activeModel?.version && (
        <span className="ml-0.5 font-normal text-foreground/20">
          {activeModel.version}
        </span>
      )}
    </div>
  )
})
