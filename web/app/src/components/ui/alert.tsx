import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { typeClass, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

const alertVariants = cva(
	"group/alert relative grid w-full gap-0.5 border text-left has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: "border-border/60 bg-card text-card-foreground",
				info: "border-info/30 bg-info/10 text-info-foreground *:data-[slot=alert-description]:text-info-foreground/90",
				success:
					"border-success/30 bg-success/10 text-success-foreground *:data-[slot=alert-description]:text-success-foreground/90",
				warning:
					"border-warning/30 bg-warning/10 text-warning-foreground *:data-[slot=alert-description]:text-warning-foreground/90",
				destructive:
					"border-destructive/30 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive/90",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	const shape = useShape();
	const sizeClasses = useSize();
	const compact = sizeClasses.variant === "compact";
	return (
		<div
			data-slot="alert"
			role="alert"
			className={cn(
				alertVariants({ variant }),
				shape.container,
				compact ? "px-3 py-2" : "px-3.5 py-2.5",
				typeClass("body", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	const compact = useSize().variant === "compact";
	return (
		<div
			data-slot="alert-title"
			className={cn(
				"font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
				typeClass("body", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	const compact = useSize().variant === "compact";
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-3",
				typeClass("caption", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-action"
			className={cn("relative z-10 col-start-2 mt-2 flex items-center gap-2", className)}
			{...props}
		/>
	);
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
export type AlertProps = React.ComponentProps<"div"> & VariantProps<typeof alertVariants>;
