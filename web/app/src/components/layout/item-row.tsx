import type { ReactNode } from "react";
import { RowSurface } from "@/components/layout/surface";
import { cn } from "@/lib/utils";

/**
 * Compact settings row: optional icon, title (+ subtitle), trailing control.
 * Use for toggles, selects, and list entries across Settings panes.
 */
export function ItemRow({
	icon,
	title,
	subtitle,
	trailing,
	className,
	interactive = true,
	tone = "default",
	truncateSubtitle = true,
	truncateTitle = true,
}: {
	icon?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	trailing?: ReactNode;
	className?: string;
	interactive?: boolean;
	tone?: "default" | "muted" | "inset" | "dashed";
	truncateSubtitle?: boolean;
	truncateTitle?: boolean;
}) {
	return (
		<RowSurface tone={tone} padding="md" interactive={interactive} className={cn("items-center gap-3", className)}>
			{icon ? (
				<div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/60 text-foreground/70">
					{icon}
				</div>
			) : null}
			<div className="min-w-0 flex-1">
				<div className={cn("text-sm font-medium text-foreground", truncateTitle && "truncate")}>{title}</div>
				{subtitle ? (
					<div
						className={cn(
							"mt-0.5 text-xs text-muted-foreground",
							truncateSubtitle ? "truncate" : "leading-normal",
						)}
					>
						{subtitle}
					</div>
				) : null}
			</div>
			{trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
		</RowSurface>
	);
}
