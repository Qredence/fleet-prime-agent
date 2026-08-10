"use client"

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { Tabs } from "@base-ui/react/tabs"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { useProximityHover } from "../hooks/use-proximity-hover"
import { fontWeights } from "../lib/font-weight"
import { spring } from "../lib/springs"
import { cn } from "../lib/utils"
import type { ItemRect } from "../hooks/use-proximity-hover"
import type { LucideIcon } from "lucide-react"
import type { HTMLAttributes, ReactNode } from "react"

/** Selection / hover pill surface — maps Fluid `bg-active` to Fleet chrome. */
const ACTIVE_PILL_CLASS = "bg-background shadow-sm"

/** Floating header chrome track (matches DiscreteTabs / chrome pills). */
const PILL_TRACK_CLASS =
  "rounded-full border border-border/70 bg-sidebar p-0.5 shadow-sm backdrop-blur"

const PILL_RADIUS = "rounded-full"

type TabsSubtleVariant = "default" | "pill"

function chromeTone(isPill: boolean, isActive: boolean) {
  if (isActive) {
    return isPill ? "text-foreground/75" : "text-foreground"
  }
  return isPill ? "text-foreground/55" : "text-muted-foreground"
}

interface TabsSubtleContextValue {
  registerTab: (index: number, element: HTMLElement | null) => void
  hoveredIndex: number | null
  selectedIndex: number
  idPrefix: string | undefined
  activeLabel: boolean
  variant: TabsSubtleVariant
  /** Always invoked on tab press, including re-select of the active tab. */
  onSelect: (index: number) => void
}

const TabsSubtleContext = createContext<TabsSubtleContextValue | null>(null)

function useTabsSubtle() {
  const ctx = useContext(TabsSubtleContext)
  if (!ctx) throw new Error("useTabsSubtle must be used within a TabsSubtle")
  return ctx
}

function TabsSubtleIndicators({
  selectedRect,
  hoverRect,
  focusRect,
  isHovering,
  isHoveringSelected,
}: {
  selectedRect: ItemRect | undefined
  hoverRect: ItemRect | null | undefined
  focusRect: ItemRect | null | undefined
  isHovering: boolean
  isHoveringSelected: boolean
}) {
  const reduceMotion = useReducedMotion()
  const instant = reduceMotion ? { duration: 0 } : undefined
  return (
    <>
      {selectedRect ? (
        <motion.div
          className={cn(
            "pointer-events-none absolute",
            ACTIVE_PILL_CLASS,
            PILL_RADIUS
          )}
          layout
          initial={false}
          style={{
            left: selectedRect.left,
            top: selectedRect.top,
            width: selectedRect.width,
            height: selectedRect.height,
          }}
          animate={{ opacity: isHovering ? 0.8 : 1 }}
          transition={
            instant ?? {
              ...spring.moderate.enter,
              opacity: { duration: 0.08 },
            }
          }
        />
      ) : null}

      <AnimatePresence>
        {hoverRect && !isHoveringSelected ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute",
              ACTIVE_PILL_CLASS,
              PILL_RADIUS
            )}
            layout
            style={{
              left: hoverRect.left,
              top: hoverRect.top,
              width: hoverRect.width,
              height: hoverRect.height,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.4 }}
            exit={{ opacity: 0, transition: instant ?? spring.fast.exit }}
            transition={
              instant ?? {
                ...spring.fast.enter,
                opacity: { duration: 0.08 },
              }
            }
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {focusRect ? (
          <motion.div
            className={cn(
              "pointer-events-none absolute z-20 border border-ring",
              PILL_RADIUS
            )}
            layout
            initial={false}
            style={{
              left: focusRect.left - 2,
              top: focusRect.top - 2,
              width: focusRect.width + 4,
              height: focusRect.height + 4,
            }}
            exit={{ opacity: 0, transition: instant ?? spring.fast.exit }}
            transition={
              instant ?? {
                ...spring.fast.enter,
                opacity: { duration: 0.08 },
              }
            }
          />
        ) : null}
      </AnimatePresence>
    </>
  )
}

interface TabsSubtleProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onSelect"
> {
  children: ReactNode
  selectedIndex: number
  onSelect: (index: number) => void
  idPrefix?: string
  /** When true, only the selected tab shows its text label. Requires icons on tabs. */
  activeLabel?: boolean
  /** `pill` wraps the list in Fleet header chrome (bg-sidebar + rounded-full track). */
  variant?: TabsSubtleVariant
}

const TabsSubtle = forwardRef<HTMLDivElement, TabsSubtleProps>(
  (
    {
      children,
      selectedIndex,
      onSelect,
      idPrefix,
      activeLabel = false,
      variant = "default",
      className,
      ...props
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const isMouseInside = useRef(false)
    const isPill = variant === "pill"

    const {
      activeIndex: hoveredIndex,
      setActiveIndex: setHoveredIndex,
      itemRects: tabRects,
      onMouseMove: proximityMouseMove,
      onMouseLeave: proximityMouseLeave,
      registerItem,
    } = useProximityHover(containerRef, { axis: "x" })

    const registerTab = useCallback(
      (index: number, element: HTMLElement | null) => {
        registerItem(index, element)
      },
      [registerItem]
    )

    const handleMouseMove = useCallback(
      (e: React.MouseEvent) => {
        isMouseInside.current = true
        proximityMouseMove(e)
      },
      [proximityMouseMove]
    )

    const handleMouseLeave = useCallback(() => {
      isMouseInside.current = false
      proximityMouseLeave()
    }, [proximityMouseLeave])

    const [focusedIndex, setFocusedIndex] = useState<number | null>(null)

    const selectedRect =
      selectedIndex >= 0 ? tabRects[selectedIndex] : undefined
    const hoverRect = hoveredIndex !== null ? tabRects[hoveredIndex] : null
    const focusRect = focusedIndex !== null ? tabRects[focusedIndex] : null
    const isHoveringSelected = hoveredIndex === selectedIndex
    const isHovering = hoveredIndex !== null && !isHoveringSelected

    return (
      <TabsSubtleContext.Provider
        value={{
          registerTab,
          hoveredIndex,
          selectedIndex,
          idPrefix,
          activeLabel,
          variant,
          onSelect,
        }}
      >
        <Tabs.Root
          value={selectedIndex >= 0 ? selectedIndex : null}
          onValueChange={(value) => {
            if (typeof value === "number") onSelect(value)
          }}
          render={
            <Tabs.List
              activateOnFocus={false}
              ref={(node: HTMLDivElement | null) => {
                containerRef.current = node
                if (typeof ref === "function") ref(node)
                else if (ref) ref.current = node
              }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onFocus={(e: React.FocusEvent<HTMLDivElement>) => {
                const indexAttr = (e.target as HTMLElement)
                  .closest("[data-proximity-index]")
                  ?.getAttribute("data-proximity-index")
                if (indexAttr != null) {
                  const idx = Number(indexAttr)
                  setHoveredIndex(idx)
                  setFocusedIndex(
                    (e.target as HTMLElement).matches(":focus-visible")
                      ? idx
                      : null
                  )
                }
              }}
              onBlur={(e: React.FocusEvent<HTMLDivElement>) => {
                if (containerRef.current?.contains(e.relatedTarget)) return
                setFocusedIndex(null)
                if (isMouseInside.current) return
                setHoveredIndex(null)
              }}
              className={cn(
                "relative flex max-w-full [scrollbar-width:none] items-center gap-0.5 overflow-x-auto select-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
                isPill ? PILL_TRACK_CLASS : "-mx-1 -my-1 px-1 py-1",
                className
              )}
              {...props}
            >
              <TabsSubtleIndicators
                selectedRect={selectedRect}
                hoverRect={hoverRect}
                focusRect={focusRect}
                isHovering={isHovering}
                isHoveringSelected={isHoveringSelected}
              />
              {children}
            </Tabs.List>
          }
        />
      </TabsSubtleContext.Provider>
    )
  }
)

TabsSubtle.displayName = "TabsSubtle"

interface TabsSubtleItemProps extends HTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon
  label: string
  index: number
  /** Optional count shown beside the icon (stays visible in activeLabel mode). */
  badge?: number
}

const TabsSubtleItem = forwardRef<HTMLButtonElement, TabsSubtleItemProps>(
  (
    {
      icon: Icon,
      label,
      index,
      badge,
      className,
      "aria-label": ariaLabelProp,
      onClick,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLButtonElement | null>(null)
    const {
      registerTab,
      hoveredIndex,
      selectedIndex,
      idPrefix,
      activeLabel,
      variant,
      onSelect,
    } = useTabsSubtle()

    useEffect(() => {
      registerTab(index, internalRef.current)
      return () => registerTab(index, null)
    }, [index, registerTab])

    const isSelected = selectedIndex === index
    const isActive = hoveredIndex === index || isSelected
    const collapseLabel = activeLabel && !!Icon
    const showLabel = !collapseLabel || isSelected
    const isPill = variant === "pill"
    const tone = chromeTone(isPill, isActive)
    const ariaLabel =
      ariaLabelProp ?? (collapseLabel && !showLabel ? label : undefined)

    const labelContent = (
      <span
        className={cn(
          "inline-grid whitespace-nowrap",
          isPill ? "text-[12px] font-medium" : "text-[13px]"
        )}
      >
        <span
          className="invisible col-start-1 row-start-1 [text-box:trim-both_cap_alphabetic]"
          style={{ fontVariationSettings: fontWeights.semibold }}
          aria-hidden="true"
        >
          {label}
        </span>
        <span
          className={cn(
            "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
            tone
          )}
          style={{
            fontVariationSettings: isSelected
              ? fontWeights.semibold
              : fontWeights.normal,
          }}
        >
          {label}
        </span>
      </span>
    )

    return (
      <Tabs.Tab
        ref={(node: HTMLElement | null) => {
          const button = node as HTMLButtonElement | null
          internalRef.current = button
          if (typeof ref === "function") ref(button)
          else if (ref) ref.current = button
        }}
        value={index}
        data-proximity-index={index}
        id={idPrefix ? `${idPrefix}-tab-${index}` : undefined}
        aria-controls={idPrefix ? `${idPrefix}-panel-${index}` : undefined}
        aria-label={ariaLabel}
        className={cn(
          "relative z-10 flex cursor-pointer items-center border-none bg-transparent outline-none",
          isPill ? "h-8 px-2.5" : collapseLabel ? "h-8 px-3" : "h-9 gap-2 px-3",
          PILL_RADIUS,
          className
        )}
        {...props}
        onClick={(event) => {
          onClick?.(event)
          // Base UI skips onValueChange when the active tab is pressed again;
          // re-fire so callers can toggle closed (header panel launcher).
          if (isSelected) onSelect(index)
        }}
      >
        {Icon ? (
          <span className="flex shrink-0 items-center gap-1">
            <Icon
              size={isPill ? 14 : 16}
              strokeWidth={isActive ? 2 : 1.5}
              className={cn(
                "shrink-0 transition-[color,stroke-width] duration-80",
                tone
              )}
            />
            {badge !== undefined ? (
              <span
                className={cn(
                  "text-[11px] tabular-nums transition-colors duration-80",
                  tone
                )}
              >
                {badge}
              </span>
            ) : null}
          </span>
        ) : null}
        {collapseLabel ? (
          <AnimatePresence initial={false}>
            {showLabel ? (
              <motion.span
                key="label"
                className="overflow-hidden"
                initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                animate={{ width: "auto", opacity: 1, marginLeft: 8 }}
                exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                transition={{
                  ...spring.fast.enter,
                  opacity: { duration: 0.06 },
                }}
              >
                {labelContent}
              </motion.span>
            ) : null}
          </AnimatePresence>
        ) : (
          labelContent
        )}
      </Tabs.Tab>
    )
  }
)

TabsSubtleItem.displayName = "TabsSubtleItem"

interface TabsSubtlePanelProps extends HTMLAttributes<HTMLDivElement> {
  index: number
  selectedIndex: number
  idPrefix: string
  children: ReactNode
}

const TabsSubtlePanel = forwardRef<HTMLDivElement, TabsSubtlePanelProps>(
  ({ index, selectedIndex, idPrefix, children, className, ...props }, ref) => {
    const isSelected = selectedIndex === index

    return (
      <div
        ref={ref}
        id={`${idPrefix}-panel-${index}`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${index}`}
        hidden={!isSelected}
        tabIndex={-1}
        className={cn("outline-none", className)}
        {...props}
      >
        {isSelected ? children : null}
      </div>
    )
  }
)

TabsSubtlePanel.displayName = "TabsSubtlePanel"

export { TabsSubtle, TabsSubtleItem, TabsSubtlePanel }
export default TabsSubtle
