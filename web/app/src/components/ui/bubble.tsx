import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { typeClass, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="bubble-group" className={cn("flex min-w-0 flex-col gap-2", className)} {...props} />;
}

const bubbleVariants = cva(
	"group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full",
	{
		variants: {
			variant: {
				default:
					"*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/80",
				secondary:
					"*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-hover",
				muted: "*:data-[slot=bubble-content]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:bg-hover",
				tinted:
					"*:data-[slot=bubble-content]:bg-[color-mix(in_srgb,var(--fluid-accent,var(--primary))_14%,transparent)] *:data-[slot=bubble-content]:text-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_srgb,var(--fluid-accent,var(--primary))_20%,transparent)]",
				outline:
					"*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background [&>[data-slot=bubble-content]:is(button,a):hover]:bg-hover [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground",
				ghost: "border-none *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-hover [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground",
				destructive:
					"*:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-destructive dark:*:data-[slot=bubble-content]:bg-destructive/20 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Bubble({
	variant = "default",
	align = "start",
	className,
	...props
}: React.ComponentProps<"div"> &
	VariantProps<typeof bubbleVariants> & {
		align?: "start" | "end";
	}) {
	return (
		<div
			data-slot="bubble"
			data-variant={variant}
			data-align={align}
			className={cn(bubbleVariants({ variant }), className)}
			{...props}
		/>
	);
}

function BubbleContent({ className, render, ...props }: useRender.ComponentProps<"div">) {
	const shape = useShape();
	const compact = useSize().variant === "compact";
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"w-fit max-w-full min-w-0 overflow-hidden border border-transparent px-3 py-2 leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:ring-1 [button,a]:focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
					shape.container,
					typeClass("body", compact ? "compact" : "default"),
					className,
				),
			},
			props,
		),
		render,
		state: {
			slot: "bubble-content",
		},
	});
}

export { Bubble, BubbleContent, BubbleGroup };
