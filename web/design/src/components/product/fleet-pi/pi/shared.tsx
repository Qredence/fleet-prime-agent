import type { LucideIcon } from "lucide-react"
import type { ChatResourceInfo } from "@prime-agent/web-protocol/chat-protocol"
import { getResourceChipTitle, resourceKey } from "./resource-helpers"

export function ResourceNotice({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: LucideIcon
  title: string
}) {
  return (
    <div className="my-1.5 rounded-sm bg-foreground/5 px-2.5 py-2">
      <div className="flex items-center gap-2 text-label font-medium text-foreground/65">
        <Icon className="size-3.5" />
        <span>{title}</span>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-foreground/40">
        {description}
      </p>
    </div>
  )
}

export function ResourceChipSection({
  id,
  icon: Icon,
  items,
  label,
}: {
  id: string
  icon: LucideIcon
  items: Array<ChatResourceInfo>
  label: string
}) {
  return (
    <section
      id={`resource-section-${id}`}
      className="flex min-w-0 flex-col gap-2 py-2.5"
      aria-label={`${label} resources`}
    >
      <div className="flex min-w-0 items-center text-body leading-5 text-foreground/45">
        <span className="truncate underline decoration-foreground/25 underline-offset-2">
          {label}
        </span>
        <span className="ml-1 shrink-0 text-[11px] leading-4 text-foreground/30 tabular-nums no-underline">
          {items.length}
        </span>
      </div>
      <ul
        className="flex min-w-0 flex-col items-stretch gap-1.5"
        data-testid={`resource-chip-section-${label.toLowerCase()}`}
      >
        {items.length === 0 ? (
          <li className="inline-flex h-7.5 items-center rounded-lg border border-border/60 bg-background px-3 text-body leading-5 text-foreground/35 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.06)]">
            Empty
          </li>
        ) : (
          items.map((item) => (
            <ResourceChip
              key={resourceKey(item)}
              icon={Icon}
              item={item}
              stacked
            />
          ))
        )}
      </ul>
    </section>
  )
}

function ResourceChip({
  icon,
  item,
  stacked = false,
}: {
  icon: LucideIcon
  item: ChatResourceInfo
  stacked?: boolean
}) {
  const title = getResourceChipTitle(item)

  return (
    <li
      className={`max-w-full rounded-lg border border-border/70 bg-background px-2.5 text-body leading-5 text-foreground/80 shadow-[0_1px_4px_-1px_rgba(0,0,0,0.06)] ${
        stacked
          ? "flex min-h-9 w-full min-w-0 items-center gap-2 py-1.5"
          : "inline-flex h-7.5 items-center gap-1"
      }`}
      aria-label={title}
      data-testid="resource-chip"
      title={title}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ResourceChipIcon icon={icon} />
        <span className="min-w-0 truncate">{item.name}</span>
      </div>
      {item.source && (
        <span className="max-w-20 shrink-0 truncate rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] leading-3 text-foreground/35">
          {item.source}
        </span>
      )}
      {item.activationStatus && (
        <span className="max-w-24 shrink-0 truncate rounded-[5px] bg-foreground/5 px-1.5 py-0.5 text-[10px] leading-3 text-foreground/35">
          {item.activationStatus}
        </span>
      )}
    </li>
  )
}

function ResourceChipIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/4 text-foreground/45">
      <Icon className="size-3.5" />
    </span>
  )
}
