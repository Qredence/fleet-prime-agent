import React from "react";
import { cn } from "@/lib/utils";

export type ToolTextShimmerProps = {
	children: React.ReactNode;
	as?: React.ElementType;
	className?: string;
	duration?: number;
	spread?: number;
	delay?: number;
};

function ToolTextShimmerComponent({
	children,
	as: Component = "p",
	className,
	duration = 2,
	spread = 100,
	delay = 0,
}: ToolTextShimmerProps) {
	const style = {
		"--chat-shimmer-duration": `${duration}s`,
		"--chat-shimmer-spread": `${spread}px`,
		animationDelay: delay > 0 ? `${delay}s` : undefined,
		animationDuration: `${duration}s`,
		animationIterationCount: "infinite",
		animationTimingFunction: "linear",
	} as React.CSSProperties;

	return (
		<Component className={cn("an-text-shimmer", "an-text-shimmer--active", className)} style={style}>
			{children}
		</Component>
	);
}

export const ToolTextShimmer = React.memo(ToolTextShimmerComponent);
