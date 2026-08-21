"use client"

import { ChevronLeft, ChevronRight, Command as CommandIcon, File, Folder, Sparkles } from "lucide-react"
import { memo, useMemo, type ReactNode } from "react"
import { ComposerMenu, ComposerMenuItem } from "./composer"
import { cn } from "../../lib/utils"

export type ComposerTriggerKind = "slash" | "mention"

export type ComposerTriggerItem = {
  id: string
  label: string
  description?: string
  value?: string
  icon?: ReactNode
  disabled?: boolean
  category?: string
  keywords?: readonly string[]
  metadata?: Record<string, string | undefined>
}

export type ComposerTriggerGroup = {
  id: string
  label: string
  items: readonly ComposerTriggerItem[]
}

export type ComposerTriggerPopoverProps = {
  open: boolean
  kind: ComposerTriggerKind
  query?: string
  items?: readonly ComposerTriggerItem[]
  groups?: readonly ComposerTriggerGroup[]
  activeIndex?: number
  onActiveIndexChange?: (index: number) => void
  onSelect: (item: ComposerTriggerItem) => void
  onClose?: () => void
  onBack?: () => void
  className?: string
  emptyLabel?: string
  title?: string
  listId?: string
}

function defaultIcon(kind: ComposerTriggerKind, item: ComposerTriggerItem) {
  if (item.icon) return item.icon
  if (kind === "mention") {
    return item.metadata?.kind === "folder" ? (
      <Folder aria-hidden="true" className="size-4" />
    ) : (
      <File aria-hidden="true" className="size-4" />
    )
  }
  return <CommandIcon aria-hidden="true" className="size-4" />
}

function flattenGroups(
  groups: readonly ComposerTriggerGroup[] | undefined,
  items: readonly ComposerTriggerItem[] | undefined,
) {
  if (groups && groups.length > 0) return groups.flatMap((group) => group.items)
  return items ? [...items] : []
}

export const ComposerTriggerPopover = memo(function ComposerTriggerPopover({
  open,
  kind,
  query,
  items,
  groups,
  activeIndex = 0,
  onActiveIndexChange,
  onSelect,
  onClose,
  onBack,
  className,
  emptyLabel = "No matching items",
  title,
  listId = "fleet-composer-trigger-list",
}: ComposerTriggerPopoverProps) {
  const flatItems = useMemo(() => flattenGroups(groups, items), [groups, items])
  if (!open) return null

  const showGroups = Boolean(groups && groups.length > 0)
  const activeItem = flatItems[activeIndex]
  const renderItem = (item: ComposerTriggerItem, index: number) => {
    const selected = index === activeIndex
    const itemId = `${listId}-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`
    return (
      <ComposerMenuItem
        key={item.id}
        id={itemId}
        disabled={item.disabled}
        role="option"
        aria-selected={selected}
        data-active={selected ? "true" : undefined}
        active={selected}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => onActiveIndexChange?.(index)}
        onClick={() => {
          if (!item.disabled) onSelect(item)
        }}
        className={cn(
          "flex min-h-10 cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-left",
          selected && "bg-accent text-accent-foreground",
        )}
      >
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {defaultIcon(kind, item)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.label}</span>
          {item.description ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {item.description}
            </span>
          ) : null}
        </span>
        {selected ? (
          <ChevronRight aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </ComposerMenuItem>
    )
  }

  return open ? (
    <ComposerMenu
      open
      id={listId}
      role="listbox"
      aria-label={title ?? "Suggestions"}
      aria-activedescendant={activeItem ? `${listId}-${activeItem.id.replace(/[^a-zA-Z0-9_-]/g, "-")}` : undefined}
      data-slot="composer-trigger-popover"
      data-kind={kind}
      data-state="open"
      className={cn(
        "inset-x-0 z-50 mb-2 w-auto overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-xl",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
        {onBack ? (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="grid size-6 place-items-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        <Sparkles aria-hidden="true" className="size-3.5" />
        <span className="font-medium">{title ?? (kind === "slash" ? "Commands" : "Workspace")}</span>
        {query ? <span className="ml-auto max-w-[50%] truncate font-mono text-[11px]">{query}</span> : null}
        {onClose ? (
          <button
            type="button"
            aria-label="Close suggestions"
            onClick={onClose}
            className="sr-only"
          >
            Close suggestions
          </button>
        ) : null}
      </div>
      <div className="max-h-[min(42vh,360px)] overflow-y-auto p-1.5">
        {flatItems.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        ) : null}
        {showGroups
          ? groups?.map((group) => {
              let offset = 0
              for (const previous of groups) {
                if (previous.id === group.id) break
                offset += previous.items.length
              }
              return (
                <div key={group.id} role="group" aria-label={group.label}>
                  <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                  {group.items.map((item, index) => renderItem(item, offset + index))}
                </div>
              )
            })
          : flatItems.map(renderItem)}
      </div>
    </ComposerMenu>
  )
    : null
})
