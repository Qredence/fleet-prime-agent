"use client";

// Scroll area built on Base UI — shape-system scrollbar, native overflow
// fallback on touch-primary devices. Scrollbar
// machinery adapted from Lina by SameerJS6 (https://lina.sameer.sh); built on
// @base-ui/react/scroll-area, whose scrollbars stay mounted while scrollable
// and expose hover/scroll state as data attributes instead of Radix's
// show/hide presence animation.

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { type ComponentPropsWithoutRef, type ComponentRef, createContext, forwardRef, useContext } from "react";
import { useTouchPrimary } from "@/hooks/use-touch-primary";
import { cn } from "@/lib/utils";

// On touch-primary devices the Base UI machinery is skipped entirely in
// favour of native overflow scrolling (better physics, momentum,
// rubber-banding); the context lets the exported ScrollBar no-op there.
const ScrollAreaContext = createContext<boolean>(false);

type Orientation = "vertical" | "horizontal" | "both";

interface ScrollAreaProps extends ComponentPropsWithoutRef<"div"> {
	viewportClassName?: string;
	/** Which axes get scrollbars. Defaults to `"vertical"`. */
	orientation?: Orientation;
}

/** Renders a scroll viewport with scrollbars on the requested axes.
 * Touch-primary devices use native overflow scrolling; other devices use
 * Base UI scrollbars. The forwarded ref points to the outer root. */
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
								"size-full overscroll-contain rounded-[inherit]",
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
							className={cn("size-full rounded-[inherit]", viewportClassName)}
						>
							{/* Content gives Base UI an intrinsic size to measure
                  horizontal overflow against. */}
							<ScrollAreaPrimitive.Content
								className={cn(orientation === "vertical" && "block! w-full min-w-0! max-w-full")}
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

/** Renders a shaped Base UI scrollbar, or nothing inside a touch-primary ScrollArea. */
const ScrollBar = forwardRef<
	ComponentRef<typeof ScrollAreaPrimitive.Scrollbar>,
	ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => {
	const isTouch = useContext(ScrollAreaContext);

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
					"relative rounded-lg bg-[rgb(var(--overlay)/0.08)] transition-[background-color,width,height] duration-160 ease-in-out",
					"group-hover/scrollbar:bg-[rgb(var(--overlay)/0.12)] active:!bg-[rgb(var(--overlay)/0.16)]",
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

export type { ScrollAreaProps };
export { ScrollArea };
