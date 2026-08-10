"use client"

import { useEffect, useState } from "react"
import { cn } from "./utils/cn"

const LOADER_DOTS = ["·", "•", "●", "•"]

/**
 * Mirrors the TUI's working-loader: a tiny animated indicator, the current
 * activity verb (Working / Waiting / Thinking / Writing / Executing), and
 * elapsed seconds since the current turn started. The TUI also surfaces
 * token counts; the web port shows them when they arrive via the info
 * description (see FleetPiInputBar `infoDescription`).
 */
export function ComposerLoader({
  label,
  isActive,
  className,
}: {
  label?: string
  isActive: boolean
  className?: string
}) {
  const [elapsed, setElapsed] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!isActive) {
      setElapsed(0)
      setTick(0)
      return
    }
    const startedAt = Date.now()
    const interval = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
      setTick((current) => current + 1)
    }, 500)
    return () => window.clearInterval(interval)
  }, [isActive])

  if (!isActive || !label) return null

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex items-center gap-2 px-an-context-padding py-1 text-xs text-foreground/70",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="font-mono text-an-primary-color"
      >
        {LOADER_DOTS[tick % LOADER_DOTS.length]}
      </span>
      <span className="truncate">{label}</span>
      <span className="tabular-nums text-foreground/50">{elapsed}s</span>
    </div>
  )
}
