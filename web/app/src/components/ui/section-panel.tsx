import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionPanelProps = {
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
	description: ReactNode;
	title: string;
};

/** A consistent content section with a heading, description, optional actions, and body. */
export function SectionPanel({ actions, children, className, description, title }: SectionPanelProps) {
	return (
		<div
			data-slot="section-panel"
			className={cn("flex min-w-0 max-w-full flex-col gap-4 [overflow-wrap:anywhere]", className)}
		>
			<div className="flex items-start justify-between gap-3 max-sm:flex-col">
				<div className="min-w-0 flex-1">
					<h3 className="text-lg font-medium text-balance">{title}</h3>
					<p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p>
				</div>
				{actions ? <div className="flex shrink-0 items-center gap-1.5 pt-0.5">{actions}</div> : null}
			</div>
			<div className="flex flex-col gap-3">{children}</div>
		</div>
	);
}
