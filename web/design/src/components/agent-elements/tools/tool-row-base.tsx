import { Collapsible } from "@base-ui/react/collapsible"
import { IconChevronRight } from "@tabler/icons-react"
import { TextShimmer } from "../text-shimmer"
import { cn } from "../utils/cn"
import type { ReactNode } from "react"

export type ToolRowBaseProps = {
  icon?: ReactNode
  shimmerLabel?: string
  completeLabel: string
  isAnimating: boolean
  detail?: string
  onDetailClick?: () => void
  trailingContent?: ReactNode
  expandable?: boolean
  expanded?: boolean
  defaultOpen?: boolean
  onToggleExpand?: () => void
  children?: ReactNode
}

export function ToolRowBase({
  icon,
  shimmerLabel,
  completeLabel,
  isAnimating,
  detail,
  onDetailClick,
  trailingContent,
  expandable = false,
  expanded,
  defaultOpen = false,
  onToggleExpand,
  children,
}: ToolRowBaseProps) {
  const isComplete = !isAnimating
  const isExpanded = expanded ?? false
  const canToggle = expandable && (isComplete || isExpanded || isAnimating)

  const row = (
    <div
      className={cn(
        "flex max-w-full items-center gap-1 rounded-an-tool-border-radius select-none",
        canToggle ? "cursor-pointer" : "cursor-default"
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {icon && (
          <span className="flex size-3 shrink-0 items-center justify-center">
            {icon}
          </span>
        )}
        <span className="shrink-0 font-[450] whitespace-nowrap">
          {isAnimating && shimmerLabel ? (
            <TextShimmer
              as="span"
              duration={1.2}
              className="m-0 inline-flex h-4 items-center leading-none"
            >
              {shimmerLabel}
            </TextShimmer>
          ) : (
            completeLabel
          )}
        </span>
        {detail &&
          (onDetailClick ? (
            <button
              type="button"
              onClick={onDetailClick}
              className="min-w-0 flex-1 truncate text-left font-normal text-an-foreground-muted/60 underline-offset-2 hover:text-an-foreground-muted hover:underline"
            >
              {detail}
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate font-normal text-an-foreground-muted/60">
              {detail}
            </span>
          ))}
        {trailingContent}
      </div>
      {expandable && (isComplete || isExpanded || isAnimating) && (
        <div>
          <IconChevronRight
            className={cn(
              "shrink-0 text-muted-foreground transition-transform duration-150 ease-out",
              "size-3",
              "rotate-0 group-data-panel-open:rotate-90"
            )}
          />
        </div>
      )}
    </div>
  )

  if (!expandable) {
    return <div className="flex flex-col gap-1">{row}</div>
  }

  const rootProps =
    expanded === undefined
      ? { defaultOpen }
      : { open: expanded, onOpenChange: onToggleExpand }

  return (
    <Collapsible.Root className="flex w-full flex-col gap-2" {...rootProps}>
      <Collapsible.Trigger
        className="group flex"
        disabled={!canToggle}
        aria-disabled={!canToggle}
      >
        {row}
      </Collapsible.Trigger>
      <Collapsible.Panel
        className={cn(
          "overflow-hidden",
          "h-[var(--collapsible-panel-height)] transition-all duration-150 ease-out",
          "data-ending-style:h-0 data-starting-style:h-0",
          "[&[hidden]:not([hidden='until-found'])]:hidden"
        )}
      >
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
