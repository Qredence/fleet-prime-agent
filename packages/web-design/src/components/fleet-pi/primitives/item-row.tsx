import { cn } from "../../../lib/utils"
import { RowSurface } from "./surface"
import type { ReactNode } from "react"

/**
 * Compact settings row: optional icon, title (+ subtitle), trailing control.
 * Use for toggles, selects, and list entries across Settings panes.
 */
export function ItemRow({
  icon,
  title,
  subtitle,
  trailing,
  className,
  interactive = true,
  tone = "default",
}: {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  className?: string
  interactive?: boolean
  tone?: "default" | "muted" | "inset" | "dashed"
}) {
  return (
    <RowSurface
      tone={tone}
      padding="md"
      interactive={interactive}
      className={cn("items-center gap-3", className)}
    >
      {icon ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/60 text-foreground/70">
          {icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>
      ) : null}
    </RowSurface>
  )
}
