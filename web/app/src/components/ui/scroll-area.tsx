"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { createContext, forwardRef, useContext, type ComponentPropsWithoutRef, type ComponentRef } from "react";
import { useTouchPrimary } from "@/hooks/use-touch-primary";
import { useShape } from "@/lib/fluid/shape-context";
import { cn } from "@/lib/utils";

const ScrollAreaContext = createContext<boolean>(false);

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
	viewportClassName?: string;
	/** Which axes get scrollbars. Defaults to `"vertical"`. */
	orientation?: Orientation;
}

const ScrollArea = forwardRef<ComponentRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
	({ className, children, viewportClassName, orientation = "vertical", ...props }, ref) => {
		const isTouch = useTouchPrimary();

		return (
			<ScrollAreaContext.Provider value={isTouch}>
				{isTouch ? (
					<div
						ref={ref}
						role="group"
						data-slot="scroll-area"
						aria-roledescription="scroll area"
						className={cn("relative overflow-hidden", className)}
						{...props}
					>
						<div
							data-slot="scroll-area-viewport"
							className={cn(
								"size-full rounded-[inherit] focus-visible:outline-offset-[-1px]",
								orientation === "vertical" && "overflow-y-auto",
								orientation === "horizontal" && "overflow-x-auto",
								orientation === "both" && "overflow-auto",
								viewportClassName,
							)}
							tabIndex={0}
						>
							{children}
						</div>
					</div>
				) : (
					<ScrollAreaPrimitive.Root
						ref={ref}
						data-slot="scroll-area"
						className={cn("relative overflow-hidden", className)}
						{...props}
					>
						<ScrollAreaPrimitive.Viewport
							data-slot="scroll-area-viewport"
							className={cn(
								"size-full rounded-[inherit] focus-visible:outline-offset-[-1px]",
								viewportClassName,
							)}
						>
							<ScrollAreaPrimitive.Content
								className={orientation === "vertical" ? "block! w-full min-w-0! max-w-full" : undefined}
							>
								{children}
							</ScrollAreaPrimitive.Content>
						</ScrollAreaPrimitive.Viewport>
						{orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
						{orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
						{orientation === "both" && <ScrollAreaPrimitive.Corner />}
					</ScrollAreaPrimitive.Root>
				)}
			</ScrollAreaContext.Provider>
		);
	},
);

ScrollArea.displayName = "ScrollArea";

const ScrollBar = forwardRef<
	ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>,
	ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
	const isTouch = useContext(ScrollAreaContext);
	const shape = useShape();

	if (isTouch) return null;

	return (
		<ScrollAreaPrimitive.Scrollbar
			ref={ref}
			orientation={orientation}
			data-slot="scroll-area-scrollbar"
			className={cn(
				"group/scrollbar absolute z-20 flex touch-none select-none",
				"opacity-0 transition-opacity duration-120 ease-out delay-160",
				"data-[hovering]:duration-160 data-[scrolling]:duration-160",
				"data-[hovering]:opacity-100 data-[scrolling]:opacity-100",
				"data-[hovering]:delay-0 data-[scrolling]:delay-0",
				orientation === "vertical" && "top-0 right-0 h-full w-2.5",
				orientation === "horizontal" && "bottom-0 left-0 h-2.5 w-full flex-col",
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.Thumb
				data-slot="scroll-area-thumb"
				className={cn(
					"relative bg-[rgb(var(--overlay)/0.08)] transition-[background-color,width,height] duration-160 ease-in-out",
					"group-hover/scrollbar:bg-[rgb(var(--overlay)/0.12)] active:!bg-[rgb(var(--overlay)/0.16)]",
					shape.bg,
					orientation === "vertical" &&
						"mx-auto my-1 w-1 -translate-x-0.5 h-[var(--scroll-area-thumb-height)] group-hover/scrollbar:w-1.5",
					orientation === "horizontal" &&
						"my-auto mx-1 h-1 -translate-y-0.5 w-[var(--scroll-area-thumb-width)] group-hover/scrollbar:h-1.5",
				)}
			/>
		</ScrollAreaPrimitive.Scrollbar>
	);
});

ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
export type { ScrollAreaProps };
