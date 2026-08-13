import { memo } from "react"
import { cn } from "./utils/cn"

export type ErrorMessageProps = {
  title?: string
  message: string
  className?: string
}

export const ErrorMessage = memo(function ErrorMessage({
  title = "Something went wrong",
  message,
  className,
}: ErrorMessageProps) {
  return (
    <div className={cn("flex justify-start", className)}>
      <div className="rounded-[8px] border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-an-foreground">
        <div className="font-medium text-an-foreground">{title}</div>
        <div className="mt-0.5 text-an-foreground-muted">{message}</div>
      </div>
    </div>
  )
})
