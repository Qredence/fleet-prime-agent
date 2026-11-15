"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { typeClass, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const attachmentVariants = cva(
	"group/attachment relative flex w-fit max-w-full min-w-0 shrink-0 flex-wrap border border-border/60 bg-card text-card-foreground transition-colors focus-within:ring-1 focus-within:ring-[color:var(--focus-ring,#6B97FF)] has-[>a,>button]:hover:bg-hover data-[state=error]:border-destructive/30 data-[state=idle]:border-dashed",
	{
		variants: {
			size: {
				default:
					"gap-2 has-data-[slot=attachment-content]:px-2.5 has-data-[slot=attachment-content]:py-2 has-data-[slot=attachment-media]:p-2",
				sm: "gap-2.5 text-xs has-data-[slot=attachment-content]:px-2 has-data-[slot=attachment-content]:py-1.5 has-data-[slot=attachment-media]:p-1.5",
				xs: "gap-1.5 text-xs has-data-[slot=attachment-content]:px-1.5 has-data-[slot=attachment-content]:py-1 has-data-[slot=attachment-media]:p-1",
			},
			orientation: {
				horizontal: "min-w-40 items-center",
				vertical: "w-24 flex-col has-data-[slot=attachment-content]:w-30",
			},
		},
	},
);

function Attachment({
	className,
	state = "done",
	size = "default",
	orientation = "horizontal",
	...props
}: React.ComponentProps<"div"> &
	VariantProps<typeof attachmentVariants> & {
		state?: "idle" | "uploading" | "processing" | "error" | "done";
	}) {
	const shape = useShape();
	const compact = useSize().variant === "compact" || size === "sm" || size === "xs";
	return (
		<div
			data-slot="attachment"
			data-state={state}
			data-size={size}
			data-orientation={orientation}
			className={cn(
				attachmentVariants({ size, orientation }),
				size === "xs" ? shape.item : shape.container,
				typeClass(size === "sm" || size === "xs" ? "caption" : "body", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
}

const attachmentMediaVariants = cva(
	"relative flex aspect-square w-10 shrink-0 items-center justify-center overflow-hidden bg-muted text-foreground group-data-[orientation=vertical]/attachment:w-full group-data-[size=sm]/attachment:w-8 group-data-[size=xs]/attachment:w-7 group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:text-destructive group-data-[orientation=vertical]/attachment:*:data-[slot=spinner]:size-6! [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 group-data-[orientation=vertical]/attachment:[&_svg:not([class*='size-'])]:size-6 group-data-[size=xs]/attachment:[&_svg:not([class*='size-'])]:size-3.5",
	{
		variants: {
			variant: {
				icon: "",
				image: "opacity-60 group-data-[state=done]/attachment:opacity-100 group-data-[state=idle]/attachment:opacity-100 *:[img]:aspect-square *:[img]:w-full *:[img]:object-cover",
			},
		},
		defaultVariants: {
			variant: "icon",
		},
	},
);

function AttachmentMedia({
	className,
	variant = "icon",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentMediaVariants>) {
	const shape = useShape();
	return (
		<div
			data-slot="attachment-media"
			data-variant={variant}
			className={cn(attachmentMediaVariants({ variant }), shape.bg, className)}
			{...props}
		/>
	);
}

function AttachmentContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="attachment-content"
			className={cn(
				"max-w-full min-w-0 flex-1 leading-tight group-data-[orientation=vertical]/attachment:px-1",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="attachment-title"
			className={cn(
				"block max-w-full min-w-0 truncate font-medium group-data-[state=processing]/attachment:shimmer group-data-[state=uploading]/attachment:shimmer",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentDescription({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="attachment-description"
			className={cn(
				"mt-0.5 block min-w-0 truncate text-xs text-muted-foreground group-data-[state=error]/attachment:text-destructive/80",
				"max-w-full",
				className,
			)}
			{...props}
		/>
	);
}

function AttachmentTrigger({ className, render, type, ...props }: useRender.ComponentProps<"button">) {
	return useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(
			{
				type: render ? type : (type ?? "button"),
				className: cn("absolute inset-0 z-10 outline-none", className),
			},
			props,
		),
		render,
		state: {
			slot: "attachment-trigger",
		},
	});
}

export { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger };
