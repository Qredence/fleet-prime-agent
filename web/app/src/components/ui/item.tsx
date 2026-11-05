import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const itemVariants = cva(
	"group/item flex w-full flex-wrap items-center rounded-lg border text-sm transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
	{
		variants: {
			variant: {
				default: "border-transparent",
				outline: "border-border",
				muted: "border-transparent bg-muted/50",
			},
			size: {
				default: "gap-2.5 px-3 py-2.5",
				sm: "gap-2.5 px-3 py-2.5",
				xs: "gap-2 px-2.5 py-2",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

function Item({
	className,
	variant = "default",
	size = "default",
	render,
	...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof itemVariants>) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">({ className: cn(itemVariants({ variant, size, className })) }, props),
		render,
		state: { slot: "item", variant, size },
	});
}

function ItemMedia({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="item-media"
			className={cn("flex shrink-0 items-center justify-center [&_svg]:size-4", className)}
			{...props}
		/>
	);
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="item-content" className={cn("flex min-w-0 flex-1 flex-col gap-1", className)} {...props} />;
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="item-title" className={cn("text-sm font-medium leading-snug", className)} {...props} />;
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
	return (
		<p
			data-slot="item-description"
			className={cn("text-sm leading-normal text-muted-foreground", className)}
			{...props}
		/>
	);
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="item-actions" className={cn("flex items-center gap-2", className)} {...props} />;
}

export { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle };
