"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useShape } from "@/lib/fluid/shape-context";
import { useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
	const shape = useShape();
	const sizeClasses = useSize();

	return (
		<div
			data-slot="input-group"
			role="group"
			className={cn(
				"group/input-group relative flex w-full min-w-0 items-center border border-border bg-transparent transition-[background-color,border-color] duration-80 outline-none",
				"hover:bg-hover focus-within:hover:bg-transparent",
				"in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0",
				"has-[[data-slot=input-group-control]:disabled]:pointer-events-none has-[[data-slot=input-group-control]:disabled]:opacity-50 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
				"has-[[data-slot=input-group-control]:focus-visible]:border-foreground/40 has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-[color:var(--focus-ring,#6B97FF)]",
				"has-[[data-slot][aria-invalid=true]]:border-destructive/50",
				"has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
				"has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
				sizeClasses.control,
				shape.input,
				className,
			)}
			{...props}
		/>
	);
}

const inputGroupAddonVariants = cva(
	"flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-sm [&>svg:not([class*='size-'])]:size-4",
	{
		variants: {
			align: {
				"inline-start": "order-first pl-2 has-[>button]:ml-[-0.3rem] has-[>kbd]:ml-[-0.15rem]",
				"inline-end": "order-last pr-2 has-[>button]:mr-[-0.3rem] has-[>kbd]:mr-[-0.15rem]",
				"block-start":
					"order-first w-full justify-start px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
				"block-end":
					"order-last w-full justify-start px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
			},
		},
		defaultVariants: {
			align: "inline-start",
		},
	},
);

function InputGroupAddon({
	className,
	align = "inline-start",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
	return (
		<div
			role="group"
			data-slot="input-group-addon"
			data-align={align}
			className={cn(inputGroupAddonVariants({ align }), className)}
			onClick={(e) => {
				if ((e.target as HTMLElement).closest("button")) {
					return;
				}
				e.currentTarget.parentElement
					?.querySelector<HTMLElement>("[data-slot='input-group-control'], input, textarea")
					?.focus();
			}}
			{...props}
		/>
	);
}

const inputGroupButtonVariants = cva("flex items-center gap-2 text-sm shadow-none", {
	variants: {
		size: {
			xs: "h-6 gap-1 px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
			sm: "",
			"icon-xs": "size-6 p-0 has-[>svg]:p-0",
			"icon-sm": "size-8 p-0 has-[>svg]:p-0",
		},
	},
	defaultVariants: {
		size: "xs",
	},
});

function InputGroupButton({
	className,
	type = "button",
	variant = "ghost",
	size = "xs",
	...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
	VariantProps<typeof inputGroupButtonVariants> & {
		type?: "button" | "submit" | "reset";
	}) {
	const shape = useShape();
	return (
		<Button
			type={type}
			data-size={size}
			size="compact"
			variant={variant}
			className={cn(shape.item, inputGroupButtonVariants({ size }), className)}
			{...props}
		/>
	);
}

function InputGroupInput({ className, ...props }: React.ComponentProps<typeof Input>) {
	return (
		<Input
			data-slot="input-group-control"
			className={cn(
				"flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 hover:bg-transparent focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0",
				className,
			)}
			{...props}
		/>
	);
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<typeof Textarea>) {
	return (
		<Textarea
			data-slot="input-group-control"
			className={cn(
				"flex-1 resize-none rounded-none border-0 bg-transparent shadow-none ring-0 hover:bg-transparent focus-visible:ring-0 disabled:bg-transparent aria-invalid:ring-0",
				className,
			)}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupTextarea };
