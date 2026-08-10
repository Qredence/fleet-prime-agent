import { IconArrowUp, IconPlayerStopFilled } from "@tabler/icons-react"
import { cn } from "../utils/cn"

export type SendButtonProps = {
  state: "idle" | "typing" | "streaming"
  onClick?: () => void
}

export function SendButton({ state, onClick }: SendButtonProps) {
  const isStreaming = state === "streaming"
  const isTyping = state === "typing"

  if (isStreaming) {
    return (
      <button
        type="button"
        aria-label="Stop"
        onClick={onClick}
        className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-foreground"
      >
        <IconPlayerStopFilled className="size-4 text-background" />
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label="Send"
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-full",
        isTyping
          ? "cursor-pointer bg-an-send-button-bg"
          : "cursor-default bg-muted"
      )}
    >
      <IconArrowUp
        className={cn(
          "size-4",
          isTyping ? "text-an-send-button-color" : "text-muted-foreground"
        )}
      />
    </button>
  )
}
