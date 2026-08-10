"use client"

import { useEffect, useRef } from "react"
import { cn } from "../utils/cn"
import type { ReactNode, RefObject } from "react"

export type SuggestionItem = {
  id: string
  label: string
  value?: string
  icon?: ReactNode
  className?: string
}

export type SuggestionsProps = {
  items: Array<SuggestionItem>
  onSelect: (item: SuggestionItem) => void
  disabled?: boolean
  className?: string
  itemClassName?: string
  activeIndex?: number
  onActiveIndexChange?: (index: number) => void
  listRef?: RefObject<HTMLDivElement | null>
}

export function Suggestions({
  items,
  onSelect,
  disabled,
  className,
  itemClassName,
  activeIndex,
  onActiveIndexChange,
  listRef,
}: SuggestionsProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (activeIndex === undefined || activeIndex < 0) return
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    })
  }, [activeIndex, items])

  if (items.length === 0) {
    return null
  }

  const isKeyboardNavigable = activeIndex !== undefined

  return (
    <div
      ref={listRef}
      role={isKeyboardNavigable ? "listbox" : undefined}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {items.map((item, index) => {
        const isActive = activeIndex === index
        return (
          <button
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node
            }}
            type="button"
            role={isKeyboardNavigable ? "option" : undefined}
            aria-selected={isKeyboardNavigable ? isActive : undefined}
            disabled={disabled}
            onMouseEnter={() => onActiveIndexChange?.(index)}
            onClick={() => onSelect(item)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border border-border bg-transparent px-2 text-sm text-an-foreground-muted transition-colors hover:bg-an-background-secondary/40 hover:text-an-foreground disabled:pointer-events-none disabled:opacity-50",
              isActive && "bg-an-background-secondary/50 text-an-foreground",
              itemClassName,
              item.className
            )}
          >
            {item.icon && (
              <span className="inline-flex shrink-0">{item.icon}</span>
            )}
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
