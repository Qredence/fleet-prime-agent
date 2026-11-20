"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { forwardRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface SliderProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue"> {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	label?: string;
	formatValue?: (value: number) => string;
	disabled?: boolean;
	size?: "compact" | "default";
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

/**
 * Accessible range control. Callers pass a number (or a one-element range the
 * effort picker never uses as a pair). Compact size adds a value editor.
 */
const Slider = forwardRef<HTMLDivElement, SliderProps>(function Slider(
	{
		value,
		onChange,
		min = 0,
		max = 100,
		step = 1,
		label,
		formatValue = (next) => String(next),
		disabled,
		size,
		className,
		"aria-label": ariaLabel,
		...rest
	},
	ref,
) {
	const safeStep = Math.max(Number.EPSILON, step);
	const current = clamp(value, min, max);
	const accessibleName = ariaLabel ?? label;
	const [editing, setEditing] = useState(false);

	return (
		<div ref={ref} className={cn("flex min-w-0 items-center gap-3", className)} {...rest}>
			{label ? <span className="shrink-0 text-sm text-muted-foreground">{label}</span> : null}
			<SliderPrimitive.Root
				value={[current]}
				min={min}
				max={max}
				step={safeStep}
				disabled={disabled}
				onValueChange={(next) => {
					const resolved = Array.isArray(next) ? next[0] : next;
					if (typeof resolved === "number") onChange(resolved);
				}}
				className="relative flex h-5 min-w-0 flex-1 items-center"
			>
				<SliderPrimitive.Control className="relative flex w-full touch-none items-center">
					<SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
						<SliderPrimitive.Indicator className="absolute h-full bg-primary" />
					</SliderPrimitive.Track>
					<SliderPrimitive.Thumb
						aria-label={accessibleName}
						getAriaValueText={() => formatValue(current)}
						className="block size-4 rounded-full border border-border bg-background shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</SliderPrimitive.Control>
			</SliderPrimitive.Root>
			{size === "compact" ? (
				editing ? (
					<input
						aria-label="Edit slider value"
						className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
						defaultValue={current}
						disabled={disabled}
						role="spinbutton"
						type="number"
						onBlur={(event) => {
							const next = Number(event.currentTarget.value);
							if (Number.isFinite(next)) onChange(clamp(next, min, max));
							setEditing(false);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") event.currentTarget.blur();
							if (event.key === "Escape") setEditing(false);
						}}
					/>
				) : (
					<button
						type="button"
						className="shrink-0 text-sm tabular-nums"
						disabled={disabled}
						aria-label={`${label ?? accessibleName ?? "Value"}: ${formatValue(current)}`}
						onClick={() => setEditing(true)}
					>
						{formatValue(current)}
					</button>
				)
			) : null}
		</div>
	);
});

Slider.displayName = "Slider";

export { Slider };
