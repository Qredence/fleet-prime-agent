import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { useShape } from "@/lib/fluid/shape-context";
import { typeClass, useSize } from "@/lib/fluid/size-context";
import { surfaceClasses } from "@/lib/fluid/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/fluid/surface-context";
import { cn } from "@/lib/utils";

/** Conventional elevation offset for a popover/dropdown off its substrate (Fluid surfaces). */
const POPOVER_SURFACE_OFFSET = 2;

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
	className,
	children,
	align = "center",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	anchor,
	...props
}: PopoverPrimitive.Popup.Props &
	Pick<PopoverPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset" | "anchor">) {
	const shape = useShape();
	const compact = useSize().variant === "compact";
	const substrate = useSurface();
	const level = Math.min(substrate + POPOVER_SURFACE_OFFSET, 8);
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
				anchor={anchor}
				className="isolate z-50"
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={cn(
						"z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 border border-border p-2.5 text-popover-foreground outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
						shape.container,
						typeClass("body", compact ? "compact" : "default"),
						surfaceClasses(level, 3),
						"bg-popover",
						className,
					)}
					{...props}
				>
					<SurfaceProvider value={level}>{children}</SurfaceProvider>
				</PopoverPrimitive.Popup>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

export { Popover, PopoverContent, PopoverTrigger };
export type PopoverOpenChangeDetails = PopoverPrimitive.Root.ChangeEventDetails;
