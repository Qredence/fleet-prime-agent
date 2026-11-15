"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { AnimatePresence, m } from "motion/react";
import { forwardRef, type SVGProps, useState } from "react";
import { omit } from "@/lib/fluid/omit";
import { useShape } from "@/lib/fluid/shape-context";
import { type SizeVariant, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

type MotionSafeSvgProps = Omit<
	SVGProps<SVGSVGElement>,
	| "style"
	| "values"
	| "onDrag"
	| "onDragStart"
	| "onDragEnd"
	| "onAnimationStart"
	| "onAnimationEnd"
	| "onAnimationIteration"
>;

interface CheckboxProps extends Omit<
	CheckboxPrimitive.Root.Props,
	"checked" | "defaultChecked" | "onCheckedChange" | "className"
> {
	checked?: boolean;
	defaultChecked?: boolean;
	/** Shows a dash instead of the check when partially selected. */
	indeterminate?: boolean;
	onCheckedChange?: (checked: boolean, eventDetails: CheckboxPrimitive.Root.ChangeEventDetails) => void;
	className?: string;
	/** Pins the box to one step of the size ladder (16px default, 14px compact). */
	size?: SizeVariant;
}

const Checkbox = forwardRef<HTMLElement, CheckboxProps>(
	(
		{ className, checked, defaultChecked = false, indeterminate = false, onCheckedChange, onKeyDown, size, ...props },
		ref,
	) => {
		const [uncontrolled, setUncontrolled] = useState(defaultChecked);
		const isChecked = checked ?? uncontrolled;
		const glyph = indeterminate ? "dash" : isChecked ? "check" : null;
		const compact = useSize(size).variant === "compact";
		const sharp = useShape().variant === "sharp";

		return (
			<CheckboxPrimitive.Root
				ref={ref}
				data-slot="checkbox"
				checked={isChecked}
				indeterminate={indeterminate}
				onCheckedChange={(next, eventDetails) => {
					if (checked === undefined) setUncontrolled(next);
					onCheckedChange?.(next, eventDetails);
				}}
				onKeyDown={(e) => {
					const card = e.currentTarget.closest("[data-slot=field-label]");
					if (e.key === "Enter" && !e.repeat && card?.querySelector(":scope > [data-slot=field]")) {
						e.preventDefault();
						e.currentTarget.click();
					}
					onKeyDown?.(e);
				}}
				className={cn(
					"relative inline-block shrink-0 cursor-pointer border-[1.5px] border-solid border-border bg-transparent p-0 outline-none",
					"transition-[border-color] duration-80",
					"hover:not-data-checked:border-foreground/40 group-hover/field:not-data-checked:border-foreground/40",
					"data-checked:border-transparent data-indeterminate:border-transparent",
					"hover:data-checked:border-foreground/40 group-hover/field:not-data-disabled:data-checked:border-foreground/40",
					"aria-invalid:not-data-checked:border-destructive/50",
					"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
					"data-disabled:pointer-events-none data-disabled:opacity-50",
					compact ? "size-[14px]" : "size-4",
					sharp ? "rounded-none" : compact ? "rounded-[4px]" : "rounded-[5px]",
					className,
				)}
				{...props}
			>
				<AnimatePresence initial={false}>
					{glyph && (
						<CheckboxPrimitive.Indicator
							keepMounted
							render={(indicatorProps) => {
								const rest = omit(indicatorProps as SVGProps<SVGSVGElement>, [
									"style",
									"values",
									"onDrag",
									"onDragStart",
									"onDragEnd",
									"onAnimationStart",
									"onAnimationEnd",
									"onAnimationIteration",
								]) as MotionSafeSvgProps;
								return (
									<m.svg
										{...rest}
										width={compact ? 16 : 18}
										height={compact ? 16 : 18}
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth={2}
										strokeLinecap="round"
										strokeLinejoin="round"
										className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-foreground"
										initial={{ opacity: 1 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 1 }}
									>
										<m.path
											key={glyph}
											d={glyph === "dash" ? "M7 12H17" : "M6 12L10 16L18 8"}
											initial={{ pathLength: 0 }}
											animate={{ pathLength: 1, transition: { duration: 0.08, ease: "easeOut" } }}
											exit={{ pathLength: 0, transition: { duration: 0.04, ease: "easeIn" } }}
										/>
									</m.svg>
								);
							}}
						/>
					)}
				</AnimatePresence>
			</CheckboxPrimitive.Root>
		);
	},
);

Checkbox.displayName = "Checkbox";

export { Checkbox };
export type { CheckboxProps };
