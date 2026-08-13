import { SpiralLoader } from "../../agent-elements/spiral-loader"
import { cn } from "../../../lib/utils"

export type CenteredLoaderProps = {
  className?: string
  size?: number
}

export function CenteredLoader({ className, size = 20 }: CenteredLoaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-svh items-center justify-center bg-background",
        className
      )}
    >
      <SpiralLoader size={size} />
    </div>
  )
}
