import { Square } from "lucide-react"

import { Button } from "../../button"
import { SpiralLoader } from "../../agent-elements/spiral-loader"

export type ChatStopControlProps = {
  status: "ready" | "submitted" | "streaming" | "error"
  onStop: () => void
}

export function ChatStopControl({ status, onStop }: ChatStopControlProps) {
  const isBusy = status === "streaming" || status === "submitted"

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
