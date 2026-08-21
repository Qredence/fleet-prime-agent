import { useEffect, useRef, useState } from "react"
import { IconCheck, IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"

import { cn } from "./utils/cn"

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
})
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
})

export function formatTimestamp(date: Date): string {
  const now = new Date()
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (isSameDay) {
    return timeFormatter.format(date)
  }
  return dateFormatter.format(date)
}

function CopyButton({
  text,
  onCopied,
}: {
  text: string
  onCopied?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current)
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copiedTimerRef.current = null
      }, 2000)
      toast.success("Copied to clipboard")
      onCopied?.()
    } catch {
      toast.error("Failed to copy to clipboard")
    }
  }
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={copied ? "Copied" : "Copy message"}
      onClick={handleCopy}
      onPointerDown={(event) => {
        event.stopPropagation()
      }}
      onMouseDown={(event) => event.stopPropagation()}
      className={cn(
        "flex size-6 items-center justify-center rounded-md transition-[background-color,opacity,transform] duration-150 ease-out active:scale-[0.97]",
        "bg-transparent opacity-50 hover:bg-an-foreground/10 hover:opacity-100"
      )}
    >
      <div className="relative h-3.5 w-3.5">
        <IconCopy
          className={cn(
            "absolute inset-0 h-3.5 w-3.5 text-an-foreground-muted transition-[opacity,transform] duration-150 ease-out",
            copied ? "scale-50 opacity-0" : "scale-100 opacity-100"
          )}
        />
        <IconCheck
          className={cn(
            "absolute inset-0 h-3.5 w-3.5 text-an-foreground-muted transition-[opacity,transform] duration-150 ease-out",
            copied ? "scale-100 opacity-100" : "scale-50 opacity-0"
          )}
        />
      </div>
    </button>
  )
}

export function MessageToolbar({
  text,
  timestamp,
  heightClass,
  hoverClass,
  isVisible,
  alignClass,
  onCopied,
}: {
  text?: string
  timestamp?: string
  heightClass: string
  hoverClass: string
  isVisible: boolean
  alignClass: string
  onCopied?: () => void
}) {
  return (
    <div
      className={cn(
        "pointer-events-none flex items-center gap-1 pt-1 text-xs text-an-foreground-muted/70 opacity-0 transition-opacity duration-100",
        heightClass,
        alignClass,
        hoverClass,
        isVisible && "pointer-events-auto opacity-100"
      )}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {timestamp && <span>{timestamp}</span>}
      {text && <CopyButton text={text} onCopied={onCopied} />}
    </div>
  )
}
