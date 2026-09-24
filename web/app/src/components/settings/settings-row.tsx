import type { ReactNode } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type SettingsRowProps = {
	children?: ReactNode;
	className?: string;
	description?: ReactNode;
	icon?: ReactNode;
	label: ReactNode;
	trailing?: ReactNode;
};

/**
 * Standard settings field row: label, wrapping description, optional icon, and trailing control.
 * Replaces ad-hoc preference rows across Settings panes and dialogs.
 */
export function SettingsRow({ children, className, description, icon, label, trailing }: SettingsRowProps) {
	const control = trailing ?? children;
	return (
		<Field
			orientation="horizontal"
			className={cn(
				"items-center justify-between gap-6 rounded-xl border border-border/60 bg-card p-4 transition-colors",
				className,
			)}
		>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				{icon ? (
					<div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/40 bg-background/60 text-foreground/70">
						{icon}
					</div>
				) : null}
				<div className="min-w-0 flex-1">
					<FieldLabel className="text-sm font-medium text-foreground">{label}</FieldLabel>
					{description ? (
						<FieldDescription className="mt-0.5 text-xs text-muted-foreground leading-normal">
							{description}
						</FieldDescription>
					) : null}
				</div>
			</div>
			{control ? <div className="shrink-0">{control}</div> : null}
		</Field>
	);
}
