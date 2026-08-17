"use client"

import { useId, useMemo, useState, type HTMLAttributes, type KeyboardEvent } from "react"
import { motion } from "motion/react"

import { SPRING_GLIDE } from "../lib/ease"
import { cn } from "../lib/utils"

export type SliderProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange"> & {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  formatValue?: (value: number) => string
  disabled?: boolean
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  formatValue = String,
  disabled = false,
  className,
  ...props
}: SliderProps) {
  const inputId = useId()
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const safeMax = Math.max(min, max)
  const safeStep = Math.max(Number.EPSILON, step)
  const clampedValue = clamp(value, min, safeMax)
  const normalized = safeMax === min
    ? 0
    : (clampedValue - min) / (safeMax - min)
  const percent = normalized * 100
  const zeroOffset = normalized === 0 ? 8 : 0
  const fillWidth = `calc(${percent}% + ${20 - 20 * normalized - zeroOffset * 2.5}px)`
  const handleLeft = `calc(${percent}% + ${11 - 24 * normalized}px)`
  const pipMaskOffset = 20 - 20 * normalized - zeroOffset * 2.5
  const pipMask = `linear-gradient(to right, transparent calc(${percent}% + ${pipMaskOffset}px), black calc(${percent}% + ${pipMaskOffset + 2}px))`
  const pipValues = useMemo(() => {
    const count = Math.floor((safeMax - min) / safeStep)
    const values = Array.from({length: count + 1}, (_, index) => min + index * safeStep)
    if (values.at(-1) !== safeMax) values.push(safeMax)
    return values
  }, [min, safeMax, safeStep])
  const valueText = formatValue(clampedValue)
  const maxValueText = formatValue(safeMax)
  const valueFromPointer = (clientX: number, element: HTMLDivElement) => {
    const bounds = element.getBoundingClientRect()
    if (bounds.width <= 0 || safeMax === min) return min
    const ratio = clamp((clientX - bounds.left) / bounds.width, 0, 1)
    const nextValue = min + ratio * (safeMax - min)
    return clamp(min + Math.round((nextValue - min) / safeStep) * safeStep, min, safeMax)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : 0
    if (direction !== 0) {
      event.preventDefault()
      onChange(clamp(clampedValue + direction * safeStep, min, safeMax))
    } else if (event.key === "Home") {
      event.preventDefault()
      onChange(min)
    } else if (event.key === "End") {
      event.preventDefault()
      onChange(safeMax)
    }
    event.stopPropagation()
  }

  return (
    <div
      className={cn("relative w-full touch-none", disabled && "opacity-50", className)}
      {...props}
    >
      <div
        className={cn(
          "relative h-8 w-full select-none touch-none overflow-hidden rounded-md border border-border bg-background outline-offset-2 transition-colors duration-150",
          hovered && !disabled && "border-foreground/25",
          focused && "border-foreground/40 ring-2 ring-ring/60 ring-offset-1 ring-offset-background",
        )}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          if (!disabled) onChange(valueFromPointer(event.clientX, event.currentTarget))
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 z-[1] flex items-center justify-between px-3 pointer-events-none"
          style={{WebkitMaskImage: pipMask, maskImage: pipMask}}
        >
          {pipValues.map((pipValue) => (
            <motion.span
              key={pipValue}
              className="relative flex size-[5px] items-center justify-center rounded-full"
              animate={{
                backgroundColor: pipValue === clampedValue ? "var(--foreground)" : "var(--muted-foreground)",
                opacity: pipValue === clampedValue ? 1 : 0.3,
              }}
              transition={SPRING_GLIDE}
            />
          ))}
        </div>
        <motion.div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-[3] pointer-events-none bg-foreground/[0.08]"
          animate={{width: fillWidth}}
          transition={SPRING_GLIDE}
        />
        <motion.div
          aria-hidden="true"
          className={cn(
            "absolute z-[3] w-0.5 rounded-full pointer-events-none",
          )}
          style={{left: handleLeft}}
          animate={{
            left: handleLeft,
            top: hovered || focused ? 7 : 8,
            bottom: hovered || focused ? 7 : 8,
            backgroundColor: focused
              ? "var(--foreground)"
              : hovered
                ? "color-mix(in srgb, var(--foreground) 50%, transparent)"
                : "color-mix(in srgb, var(--foreground) 25%, transparent)",
          }}
          transition={SPRING_GLIDE}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[2] flex items-center px-2"
        >
          {label ? <span className="px-2 text-[13px] text-transparent select-none" aria-hidden="true">{label}</span> : null}
          <span
            className="ml-auto px-2 text-[13px] text-transparent tabular-nums select-none"
            style={{minWidth: `${maxValueText.length}ch`}}
            aria-hidden="true"
          >
            {maxValueText}
          </span>
        </div>
        <div className="pointer-events-none absolute inset-0 z-[4] flex items-center px-2 text-[13px]">
          {label ? (
            <motion.span
              className="px-2"
              animate={{color: hovered || focused ? "var(--foreground)" : "var(--muted-foreground)"}}
              transition={SPRING_GLIDE}
            >
              {label}
            </motion.span>
          ) : null}
          <motion.span
            className="ml-auto px-2 tabular-nums"
            style={{minWidth: `${maxValueText.length}ch`, textAlign: "right"}}
            animate={{color: hovered || focused ? "var(--foreground)" : "var(--muted-foreground)"}}
            transition={SPRING_GLIDE}
          >
            {valueText}
          </motion.span>
        </div>
        <input
          id={inputId}
          type="range"
          min={min}
          max={safeMax}
          step={safeStep}
          value={clampedValue}
          disabled={disabled}
          aria-label={label ?? "Slider"}
          aria-valuetext={valueText}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          className="absolute inset-0 z-20 m-0 h-full w-full cursor-ew-resize opacity-0 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  )
}
