"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/fluid/size-context";
import { FOCUS_RING } from "@/lib/fluid/surface-classes";
import { cn } from "@/lib/utils";

interface RadioGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect" | "defaultValue"> {
	children: ReactNode;
	value?: string | null;
	defaultValue?: string | null;
	onValueChange?: (value: string) => void;
	/** Pins the group's rows to one step of the size ladder (default 36px, compact 28px). */
	size?: SizeVariant;
}

const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
	({ children, value, defaultValue, onValueChange, size, className, ...props }, ref) => {
		const content = (
			<div
				ref={ref}
				data-slot="radio-group"
				role="radiogroup"
				tabIndex={-1}
				className={cn("relative flex w-72 max-w-full flex-col select-none", className)}
				{...props}
			>
				{children}
			</div>
		);

		const withSize = (node: ReactNode) => (size ? <SizeProvider size={size}>{node}</SizeProvider> : node);

		if (value !== undefined || defaultValue !== undefined) {
			return withSize(
				<RadioGroupPrimitive
					value={value}
					defaultValue={defaultValue}
					onValueChange={(next) => onValueChange?.(next as string)}
					render={content}
				/>,
			);
		}

		return withSize(content);
	},
);
RadioGroup.displayName = "RadioGroup";

/** Base UI Radio slot compatibility wrapper for custom item layouts (such as composer menus). */
function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
	const shape = useShape();
	const sizeClasses = useSize();
	return (
		<RadioPrimitive.Root
			data-slot="radio-group-item"
			className={cn(
				"group/radio relative flex w-full cursor-pointer items-start text-left outline-none select-none transition-colors duration-80",
				"hover:bg-hover",
				FOCUS_RING,
				"data-[checked]:bg-active data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				shape.item,
				sizeClasses.itemPx,
				sizeClasses.gap,
				"py-1.5 text-xs",
				className,
			)}
			{...props}
		/>
	);
}

function RadioIndicator({ className, ...props }: RadioPrimitive.Indicator.Props) {
	return (
		<RadioPrimitive.Indicator
			data-slot="radio-group-indicator"
			className={cn("ml-auto flex shrink-0 items-center justify-center text-foreground", className)}
			{...props}
		/>
	);
}

export { Radio, RadioGroup, RadioIndicator };
