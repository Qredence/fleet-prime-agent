"use client";

import { cn } from "@prime-agent/web-design/lib/utils";
import type { ComponentProps } from "react";
import { mono, ShimmerLabel } from "../../../../lib/surfaces";

export function ThinkingIndicator({
	label,
	elapsed,
	className,
	...props
}: Omit<ComponentProps<"div">, "children" | "label" | "elapsed"> & {
	label: string;
	elapsed?: string;
}) {
	return (
		<div
			data-slot="thinking-indicator"
			className={cn("flex items-center gap-2.5 text-sm text-muted-foreground", className)}
			{...props}
		>
			<span
				aria-hidden
				className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
			/>
			<ShimmerLabel
				key={label}
				className="fade-in slide-in-from-bottom-1 animate-in relative inline-block leading-none duration-300"
			>
				{label}
			</ShimmerLabel>
			{elapsed !== undefined && <span className={cn(mono, "tabular-nums text-muted-foreground/70")}>{elapsed}</span>}
		</div>
	);
}
