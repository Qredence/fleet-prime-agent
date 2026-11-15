"use client";

import { forwardRef, type HTMLAttributes } from "react";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, type SizeVariant, typeClass, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
	/** Pins the card to one step of the size ladder (default 36px, compact 28px). */
	size?: SizeVariant;
}

const Card = forwardRef<HTMLDivElement, CardProps>(({ size, className, children, ...props }, ref) => {
	const shape = useShape();
	const sizeClasses = useSize(size);
	const compact = sizeClasses.variant === "compact";

	const card = (
		<div
			ref={ref}
			data-slot="card"
			data-size={size}
			data-orientation="card"
			className={cn(
				"group/card relative flex min-h-[60px] min-w-0 flex-col",
				compact ? "pb-3" : "pb-4",
				"overflow-hidden border border-border/60 bg-card text-card-foreground",
				shape.container,
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
	return size ? <SizeProvider size={size}>{card}</SizeProvider> : card;
});
Card.displayName = "Card";

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
	const sizeClasses = useSize();
	const compact = sizeClasses.variant === "compact";
	return (
		<div
			ref={ref}
			data-slot="card-header"
			className={cn(
				"grid auto-rows-min items-start gap-1 [.border-b]:pb-3",
				compact ? "px-3 pt-3" : "px-4 pt-4",
				className,
			)}
			{...props}
		/>
	);
});
CardHeader.displayName = "CardHeader";

const CardTitle = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement>>(
	({ className, style, children, ...props }, ref) => {
		const sizeClasses = useSize();
		const compact = sizeClasses.variant === "compact";
		return (
			<span
				ref={ref}
				data-slot="card-title"
				className={cn(
					"block min-w-0 text-foreground",
					typeClass("subtitle", compact ? "compact" : "default"),
					className,
				)}
				style={{ fontVariationSettings: fontWeights.normal, ...style }}
				{...props}
			>
				{children}
			</span>
		);
	},
);
CardTitle.displayName = "CardTitle";

const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
	({ className, ...props }, ref) => {
		const sizeClasses = useSize();
		const compact = sizeClasses.variant === "compact";
		return (
			<p
				ref={ref}
				data-slot="card-description"
				className={cn("text-muted-foreground", typeClass("subtitle", compact ? "compact" : "default"), className)}
				{...props}
			/>
		);
	},
);
CardDescription.displayName = "CardDescription";

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
	const sizeClasses = useSize();
	const compact = sizeClasses.variant === "compact";
	return (
		<div
			ref={ref}
			data-slot="card-content"
			className={cn(compact ? "px-3 pt-2.5" : "px-4 pt-3", className)}
			{...props}
		/>
	);
});
CardContent.displayName = "CardContent";

export { Card, CardContent, CardDescription, CardHeader, CardTitle };
export type { CardProps };
