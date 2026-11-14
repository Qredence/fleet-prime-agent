import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { useShape } from "@/lib/fluid/shape-context";
import { typeClass, useSize } from "@/lib/fluid/size-context";
import { surfaceClasses } from "@/lib/fluid/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/fluid/surface-context";
import { cn } from "@/lib/utils";

/** Conventional elevation offset for a dialog off its substrate (Fluid surfaces). */
const DIALOG_SURFACE_OFFSET = 4;

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
	return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
	return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
	return (
		<AlertDialogPrimitive.Backdrop
			data-slot="alert-dialog-backdrop"
			className={cn(
				"fixed inset-0 isolate z-[60] bg-black/10 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogContent({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
	const shape = useShape();
	const substrate = useSurface();
	const level = Math.min(substrate + DIALOG_SURFACE_OFFSET, 8);
	return (
		<AlertDialogPortal>
			<AlertDialogBackdrop />
			<AlertDialogPrimitive.Popup
				data-slot="alert-dialog-content"
				className={cn(
					"fixed top-1/2 left-1/2 z-[60] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 border border-border/60 p-6 text-sm text-popover-foreground outline-none sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
					shape.container,
					surfaceClasses(level),
					className,
				)}
				{...props}
			>
				<SurfaceProvider value={level}>{children}</SurfaceProvider>
			</AlertDialogPrimitive.Popup>
		</AlertDialogPortal>
	);
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
	const compact = useSize().variant === "compact";
	return (
		<AlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={cn(
				"font-heading leading-none font-medium text-foreground",
				typeClass("title", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
	const compact = useSize().variant === "compact";
	return (
		<AlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={cn(
				"text-pretty text-muted-foreground",
				typeClass("body", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-footer"
			className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
			{...props}
		/>
	);
}

function AlertDialogCancel({ ...props }: AlertDialogPrimitive.Close.Props) {
	return (
		<AlertDialogPrimitive.Close data-slot="alert-dialog-cancel" render={<Button variant="outline" />} {...props} />
	);
}

function AlertDialogAction({ ...props }: AlertDialogPrimitive.Close.Props) {
	return (
		<AlertDialogPrimitive.Close
			data-slot="alert-dialog-action"
			render={<Button variant="destructive" />}
			{...props}
		/>
	);
}

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
};
