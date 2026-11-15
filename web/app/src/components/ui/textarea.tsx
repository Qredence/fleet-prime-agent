"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useShape } from "@/lib/fluid/shape-context";
import { useSize, type SizeVariant } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
	/** Pins the text and padding to one step of the size ladder. */
	size?: SizeVariant;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, size, style, ...props }, ref) => {
	const shape = useShape();
	const sizeClasses = useSize(size);
	const compact = sizeClasses.variant === "compact";

	return (
		<textarea
			ref={ref}
			data-slot="textarea"
			className={cn(
				"w-full min-w-0 border border-border bg-transparent text-foreground outline-none",
				"field-sizing-content resize-none",
				"transition-[background-color,border-color] duration-80",
				"placeholder:text-muted-foreground",
				"hover:bg-hover",
				"aria-invalid:border-destructive/50",
				"focus:border-foreground/40 aria-invalid:focus:border-foreground/40 focus:hover:bg-transparent",
				"disabled:opacity-50 disabled:pointer-events-none",
				compact ? "min-h-[64px] py-1" : "min-h-[76px] py-[7px]",
				compact ? "max-h-[190px]" : "max-h-[216px]",
				shape.variant === "pill" ? shape.mergedBg : shape.input,
				sizeClasses.px,
				sizeClasses.field,
				className,
			)}
			style={{ fontVariationSettings: fontWeights.normal, ...style }}
			{...props}
		/>
	);
});

Textarea.displayName = "Textarea";

export { Textarea };
export type { TextareaProps };
export default Textarea;
