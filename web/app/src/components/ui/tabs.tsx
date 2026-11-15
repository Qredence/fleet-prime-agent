"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type HTMLAttributes } from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/fluid/size-context";
import { FOCUS_RING } from "@/lib/fluid/surface-classes";
import { cn } from "@/lib/utils";

interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "defaultValue" | "value"> {
	/** Pins the tabs to one step of the size ladder (default 36px, compact 28px). */
	size?: SizeVariant;
	value?: TabsPrimitive.Root.Props["value"];
	defaultValue?: TabsPrimitive.Root.Props["defaultValue"];
	onValueChange?: TabsPrimitive.Root.Props["onValueChange"];
	orientation?: TabsPrimitive.Root.Props["orientation"];
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
	({ size, value, defaultValue, onValueChange, orientation = "horizontal", className, ...props }, ref) => {
		const root = (
			<TabsPrimitive.Root
				ref={ref}
				data-slot="tabs"
				data-orientation={orientation}
				orientation={orientation}
				value={value}
				defaultValue={defaultValue}
				onValueChange={onValueChange}
				className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
				{...props}
			/>
		);
		return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
	},
);
Tabs.displayName = "Tabs";

const tabsListVariants = cva(
	"group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
	{
		variants: {
			variant: {
				default: "bg-muted/70 p-0.5",
				line: "gap-1 bg-transparent p-0",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TabsList({
	className,
	variant = "default",
	...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
	const shape = useShape();
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn(shape.bg, tabsListVariants({ variant }), className)}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	const shape = useShape();
	const sizeClasses = useSize();
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				"relative inline-flex flex-1 items-center justify-center whitespace-nowrap border border-transparent font-medium text-muted-foreground transition-colors duration-80 select-none cursor-pointer outline-none",
				"hover:text-foreground hover:bg-hover",
				FOCUS_RING,
				"disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
				"group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start",
				"group-data-[variant=default]/tabs-list:data-active:bg-active group-data-[variant=default]/tabs-list:data-active:text-foreground",
				"group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-active group-data-[variant=line]/tabs-list:data-active:text-foreground",
				"after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-4px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				shape.item,
				sizeClasses.segmentItem,
				sizeClasses.itemPx,
				sizeClasses.gap,
				sizeClasses.text,
				className,
			)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			className={cn("flex-1 text-sm outline-none", className)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
