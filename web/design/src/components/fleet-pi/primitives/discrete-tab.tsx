import { cva } from "class-variance-authority"
import * as React from "react"
import { cn } from "../../../lib/utils"
import {
  CHROME_PILL_CLASS,
  DISCRETE_TAB_ACTIVE_CLASS,
  DISCRETE_TAB_INACTIVE_CLASS,
  HIT_AREA_EXPAND_DENSE_CLASS,
} from "../styles/tokens"
import type { ComponentType, SVGProps } from "react"

const discreteTabTriggerVariants = cva(
  cn(
    CHROME_PILL_CLASS,
    HIT_AREA_EXPAND_DENSE_CLASS,
    "discrete-tab-trigger justify-center transition-[background-color,color,box-shadow,transform] duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
  ),
  {
    variants: {
      size: {
        default: "text-label [&_svg:not([class*='size-'])]:size-[14px]",
        compact: "h-8 px-2 text-[11px] [&_svg:not([class*='size-'])]:size-3.5",
      },
      state: {
        active: DISCRETE_TAB_ACTIVE_CLASS,
        inactive: DISCRETE_TAB_INACTIVE_CLASS,
      },
    },
    defaultVariants: {
      size: "default",
      state: "inactive",
    },
  }
)

export type DiscreteTabItem<T extends string = string> = {
  id: T
  title: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  ariaLabel?: string
  badge?: number
}

export type DiscreteTabsProps<T extends string = string> = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "defaultValue" | "onChange"
> & {
  tabs: Array<DiscreteTabItem<T>>
  value?: T | null
  defaultValue?: T | null
  onValueChange?: (value: T) => void
  size?: "default" | "compact"
}

export type DiscreteTabTriggerProps = {
  value: string
  title: string
  ariaLabel?: string
  badge?: number
  icon: ComponentType<SVGProps<SVGSVGElement>>
  isActive: boolean
  size: "default" | "compact"
  onClick: () => void
}

function DiscreteTabs<T extends string = string>({
  className,
  tabs,
  value,
  defaultValue = null,
  onValueChange,
  size = "default",
  ...props
}: DiscreteTabsProps<T>) {
  const isControlled = value !== undefined
  const [internalValue, setInternalValue] = React.useState<T | null>(
    defaultValue
  )
  const activeTab = isControlled ? value : internalValue

  const handleTabChange = React.useCallback(
    (nextValue: T) => {
      if (!isControlled) {
        setInternalValue(nextValue)
      }
      onValueChange?.(nextValue)
    },
    [isControlled, onValueChange]
  )

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!tabs.length) return

      const currentIndex = tabs.findIndex((tab) => tab.id === activeTab)
      const resolvedIndex = currentIndex >= 0 ? currentIndex : 0
      let nextIndex: number

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (resolvedIndex + 1) % tabs.length
          break
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (resolvedIndex - 1 + tabs.length) % tabs.length
          break
        case "Home":
          nextIndex = 0
          break
        case "End":
          nextIndex = tabs.length - 1
          break
        default:
          return
      }

      event.preventDefault()
      handleTabChange(tabs[nextIndex].id)
    },
    [activeTab, handleTabChange, tabs]
  )

  return (
    <div
      role="tablist"
      aria-label="Discrete tabs"
      className={cn(
        "discrete-tab-list inline-flex items-center gap-1 [contain:layout]",
        className
      )}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {tabs.map((tab) => (
        <DiscreteTabTrigger
          key={tab.id}
          value={tab.id}
          title={tab.title}
          ariaLabel={tab.ariaLabel}
          badge={tab.badge}
          icon={tab.icon}
          isActive={activeTab === tab.id}
          size={size}
          onClick={() => handleTabChange(tab.id)}
        />
      ))}
    </div>
  )
}
DiscreteTabs.displayName = "DiscreteTabs"

const DiscreteTabTrigger = React.memo(function DiscreteTabTrigger({
  value,
  title,
  ariaLabel,
  badge,
  icon: Icon,
  isActive,
  size,
  onClick,
}: DiscreteTabTriggerProps) {
  return (
    <div className="group/tab relative">
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-controls={`panel-${value}`}
        aria-label={ariaLabel ?? title}
        data-state={isActive ? "active" : "inactive"}
        data-size={size}
        onClick={onClick}
        className={discreteTabTriggerVariants({
          size,
          state: isActive ? "active" : "inactive",
        })}
      >
        <span className="flex shrink-0 items-center justify-center gap-1">
          <Icon aria-hidden="true" />
          {badge !== undefined && <span className="tabular-nums">{badge}</span>}
        </span>

        <span className="discrete-tab-label">
          <span
            className={cn(
              "discrete-tab-label-inner",
              size === "compact" ? "max-w-24" : "max-w-28"
            )}
          >
            {title}
          </span>
        </span>
      </button>

      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-md bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md",
          "opacity-0 transition-[opacity,transform] duration-150 ease-out",
          "-translate-y-0.5 scale-[0.98]",
          "group-hover/tab:translate-y-0 group-hover/tab:scale-100 group-hover/tab:opacity-100",
          isActive && "hidden"
        )}
      >
        {title}
        <span className="absolute bottom-full left-1/2 h-0 w-0 -translate-x-1/2 border-r-4 border-b-4 border-l-4 border-transparent border-b-popover" />
      </span>
    </div>
  )
})
DiscreteTabTrigger.displayName = "DiscreteTabTrigger"

export { DiscreteTabs, DiscreteTabTrigger, discreteTabTriggerVariants }
