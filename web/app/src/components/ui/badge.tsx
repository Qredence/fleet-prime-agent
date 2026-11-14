"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { useSizeVariant } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const badgeColors = {
	accent: "var(--fluid-accent, #6B97FF)",
	gray: "#a3a3a3",
	red: "#ef4444",
	orange: "#f97316",
	amber: "#f59e0b",
	yellow: "#eab308",
	lime: "#84cc16",
	green: "#22c55e",
	emerald: "#10b981",
	teal: "#14b8a6",
	cyan: "#06b6d4",
	blue: "#3b82f6",
	indigo: "#6366f1",
	violet: "#8b5cf6",
	purple: "#a855f7",
	fuchsia: "#d946ef",
	pink: "#ec4899",
	rose: "#f43f5e",
} as const;

type BadgeColor = keyof typeof badgeColors;

const badgeVariants = cva("inline-flex min-w-0 max-w-full items-center whitespace-nowrap", {
	variants: {
		variant: {
			solid: "",
			dot: "border border-border text-foreground",
			ghost: "",
			default: "bg-foreground text-background",
			secondary: "bg-[var(--accent)] text-foreground",
			outline: "border border-border bg-transparent text-foreground",
			link: "bg-transparent text-foreground underline-offset-4 hover:underline",
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
	compoundVariants: [{ variant: "ghost", className: "px-0" }],
	defaultVariants: {
		variant: "solid",
		size: "default",
	},
});

type BadgeSizeCanonical = "default" | "compact";

/** Public size values: canonical ladder plus legacy sm/md/lg aliases. */
type BadgeSize = BadgeSizeCanonical | "sm" | "md" | "lg";

const legacySizeAliases: Partial<Record<BadgeSize, BadgeSizeCanonical>> = {
	sm: "compact",
	md: "default",
	lg: "default",
};

interface BadgeProps
	extends Omit<HTMLAttributes<HTMLSpanElement>, "color">, Omit<VariantProps<typeof badgeVariants>, "size"> {
	color?: BadgeColor;
	/** Omitted, the badge follows the surrounding SizeProvider. */
	size?: BadgeSize;
}

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
	({ className, variant = "solid", size: sizeProp, color = "gray", children, style, ...props }, ref) => {
		const shape = useShape();
		const contextSize = useSizeVariant();
		const size: BadgeSizeCanonical = sizeProp
			? (legacySizeAliases[sizeProp] ?? (sizeProp as BadgeSizeCanonical))
			: contextSize === "compact"
				? "compact"
				: "default";
		const colorValue = badgeColors[color];
		const isSolid = variant === "solid";
		const hasDot = variant === "dot" || variant === "ghost";
		const dotSize = size === "compact" ? 6 : 7;

		const colorStyle = isSolid
			? color === "gray"
				? { backgroundColor: "var(--accent)", color: "var(--foreground)" }
				: {
						color: "var(--foreground)",
						backgroundColor: `color-mix(in srgb, ${colorValue} 15%, var(--background))`,
					}
			: {};

		const dotColor = color === "gray" ? "var(--muted-foreground)" : colorValue;

		return (
			<span
				ref={ref}
				data-slot="badge"
				className={cn(badgeVariants({ variant, size }), shape.item, className)}
				style={{ ...colorStyle, ...style }}
				{...props}
			>
				{hasDot && (
					<span
						className="shrink-0 rounded-full"
						style={{
							width: dotSize,
							height: dotSize,
							backgroundColor: dotColor,
						}}
					/>
				)}
				<span className="min-w-0 overflow-x-clip text-ellipsis [text-box:trim-both_cap_alphabetic]">
					{children}
				</span>
			</span>
		);
	},
);

Badge.displayName = "Badge";

export { Badge, badgeColors, badgeVariants };
export type { BadgeColor, BadgeProps, BadgeSize };
