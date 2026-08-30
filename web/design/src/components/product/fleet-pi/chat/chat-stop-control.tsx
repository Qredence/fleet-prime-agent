import { Square } from "lucide-react"

import { Button } from "../../../ui/button"
import { SpiralLoader } from "../../../registry/beui/agents/spiral-loader"

export type ChatStopControlProps = {
  status: "ready" | "submitted" | "streaming" | "error"
  onStop: () => void
}

export function ChatStopControl({ status, onStop }: ChatStopControlProps) {
  const isBusy = status === "submitted" || status === "streaming"

  if (!isBusy) return null

  return (
    <div className="flex items-center gap-1">
      <SpiralLoader size={16} />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onStop}
        aria-label="Stop"
        title="Stop"
        className="text-foreground/40 hover:bg-foreground/6 hover:text-foreground/70"
      >
        <Square className="size-3" />
      </Button>
    </div>
  )
}
