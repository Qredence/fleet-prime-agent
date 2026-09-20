import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";
import { rowSurface } from "@/components/layout/tokens";
import { cn } from "@/lib/utils";

type RowSurfaceProps = ComponentPropsWithoutRef<"div"> & VariantProps<typeof rowSurface>;

export function RowSurface({ className, interactive, padding, tone, ...props }: RowSurfaceProps) {
	return <div className={cn(rowSurface({ interactive, padding, tone }), className)} {...props} />;
}
