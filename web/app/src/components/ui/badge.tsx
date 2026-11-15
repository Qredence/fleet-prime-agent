"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { useSizeVariant } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex min-w-0 max-w-full items-center whitespace-nowrap", {
	variants: {
		variant: {
			secondary: "bg-[var(--accent)] text-foreground",
			outline: "border border-border bg-transparent text-foreground",
			info: "border border-info/30 bg-info/10 text-info-foreground",
			success: "border border-success/30 bg-success/10 text-success-foreground",
			warning: "border border-warning/30 bg-warning/10 text-warning-foreground",
			destructive: "border border-destructive/30 bg-destructive/10 text-destructive",
		},
		size: {
			default: "h-6 px-2.5 text-[length:var(--fs-caption,12px)] leading-[var(--lh-caption,16px)] gap-1.5",
			compact:
				"h-5 px-2 text-[length:var(--fs-caption-compact,11px)] leading-[var(--lh-caption-compact,14px)] gap-1",
		},
	},
	defaultVariants: {
		variant: "secondary",
		size: "default",
	},
});

type BadgeSize = "default" | "compact";

interface BadgeProps
	extends Omit<HTMLAttributes<HTMLSpanElement>, "color">, Omit<VariantProps<typeof badgeVariants>, "size"> {
	/** Omitted, the badge follows the surrounding SizeProvider. */
	size?: BadgeSize;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
	({ className, variant, size: sizeProp, children, ...props }, ref) => {
		const shape = useShape();
		const contextSize = useSizeVariant();
		const size: BadgeSize = sizeProp ?? (contextSize === "compact" ? "compact" : "default");

		return (
			<span
				ref={ref}
				data-slot="badge"
				className={cn(badgeVariants({ variant, size }), shape.item, className)}
				{...props}
			>
				<span className="min-w-0 overflow-x-clip text-ellipsis [text-box:trim-both_cap_alphabetic]">
					{children}
				</span>
			</span>
		);
	},
);

Badge.displayName = "Badge";

export { Badge };
export type { BadgeProps, BadgeSize };
