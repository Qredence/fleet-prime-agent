import type { ReactNode } from "react";
import { TextShimmer } from "@prime-agent/web-design/components/registry/beui/motion/text-shimmer";
import { cn } from "@prime-agent/web-design/lib/utils";

export interface ThinkingShimmerProps {
  /** Loading message shown to the user. */
  children?: ReactNode;
  /** Seconds taken for one shimmer pass. */
  duration?: number;
  className?: string;
}

export function ThinkingShimmer({
  children = "Thinking…",
  duration = 1.8,
  className,
}: ThinkingShimmerProps) {
  return (
    <TextShimmer
      as="span"
      duration={duration}
      className={cn("font-medium", className)}
    >
      {children}
    </TextShimmer>
  );
}
