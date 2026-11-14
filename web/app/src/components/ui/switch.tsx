"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { animate, m, type Transition, useMotionValue } from "motion/react";
import { forwardRef, type HTMLAttributes, useCallback, useEffect, useId, useRef, useState } from "react";
import { useShape } from "@/lib/fluid/shape-context";
import { useSize, type SizeVariant } from "@/lib/fluid/size-context";
import { spring } from "@/lib/fluid/springs";
import { omit } from "@/lib/fluid/omit";
import { cn } from "@/lib/utils";

interface SwitchProps extends HTMLAttributes<HTMLDivElement> {
	label?: string;
	checked?: boolean;
	defaultChecked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	/** Called by a click, keyboard activation, or drag past midpoint. */
	onToggle?: () => void;
	disabled?: boolean;
	/** Overrides the thumb's spring (spring.moderate by default). */
	thumbTransition?: Transition;
	/** Pins the switch to one step of the size ladder. */
	size?: SizeVariant;
}

const METRICS = {
	default: {
		trackWidth: 34,
		trackHeight: 20,
		thumbSize: 16,
		pillExtend: 2,
		pressExtend: 4,
		pressShrink: 4,
	},
	compact: {
		trackWidth: 28,
		trackHeight: 16,
		thumbSize: 12,
		pillExtend: 2,
		pressExtend: 3,
		pressShrink: 3,
	},
} as const;

const THUMB_OFFSET = 2;
const DRAG_DEAD_ZONE = 2;

const Switch = forwardRef<HTMLDivElement, SwitchProps>(
	(
		{
			label,
			checked: checkedProp,
			defaultChecked = false,
			onCheckedChange,
			onToggle,
			disabled = false,
			thumbTransition,
			size,
			id,
			"aria-label": ariaLabel,
			"aria-labelledby": ariaLabelledBy,
			className,
			...props
		},
		ref,
	) => {
		const labelId = useId();
		const hasMounted = useRef(false);
		const [hovered, setHovered] = useState(false);
		const [pressed, setPressed] = useState(false);
		const [uncontrolledChecked, setUncontrolledChecked] = useState(defaultChecked);
		const checked = checkedProp ?? uncontrolledChecked;

		const sizeClasses = useSize(size);
		const sharp = useShape().variant === "sharp";
		const metrics = METRICS[sizeClasses.variant];
		const thumbTravel = metrics.trackWidth - metrics.thumbSize - THUMB_OFFSET * 2;

		const dragging = useRef(false);
		const didDrag = useRef(false);
		const pointerStart = useRef<{ clientX: number; originX: number } | null>(null);

		const motionX = useMotionValue(checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET);

		useEffect(() => {
			hasMounted.current = true;
		}, []);

		const commitToggle = useCallback(
			(nextChecked?: boolean) => {
				const resolved = nextChecked ?? !checked;
				if (checkedProp === undefined) {
					setUncontrolledChecked(resolved);
				}
				onCheckedChange?.(resolved);
				onToggle?.();
			},
			[checked, checkedProp, onCheckedChange, onToggle],
		);

		const thumbWidth = pressed
			? metrics.thumbSize + metrics.pressExtend
			: hovered
				? metrics.thumbSize + metrics.pillExtend
				: metrics.thumbSize;
		const thumbHeight = pressed ? metrics.thumbSize - metrics.pressShrink : metrics.thumbSize;
		const thumbY = pressed ? THUMB_OFFSET + metrics.pressShrink / 2 : THUMB_OFFSET;
		const extraWidth = thumbWidth - metrics.thumbSize;
		const thumbX = checked ? THUMB_OFFSET + thumbTravel - extraWidth : THUMB_OFFSET;

		useEffect(() => {
			if (dragging.current) return;
			if (!hasMounted.current) {
				motionX.set(thumbX);
			} else {
				animate(motionX, thumbX, thumbTransition ?? spring.moderate);
			}
		}, [thumbX, motionX, thumbTransition]);

		const handlePointerDown = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (disabled) return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				setPressed(true);
				dragging.current = false;
				didDrag.current = false;
				pointerStart.current = {
					clientX: e.clientX,
					originX: motionX.get(),
				};
				if (typeof e.currentTarget.setPointerCapture === "function") {
					e.currentTarget.setPointerCapture(e.pointerId);
				}
			},
			[disabled, motionX],
		);

		const handlePointerMove = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (!pointerStart.current) return;
				const delta = e.clientX - pointerStart.current.clientX;

				if (!dragging.current) {
					if (Math.abs(delta) < DRAG_DEAD_ZONE) return;
					dragging.current = true;
				}

				const dragMin = THUMB_OFFSET;
				const pressedThumbWidth = metrics.thumbSize + metrics.pressExtend;
				const dragMax = metrics.trackWidth - THUMB_OFFSET - pressedThumbWidth;
				const rawX = pointerStart.current.originX + delta;
				motionX.set(Math.max(dragMin, Math.min(dragMax, rawX)));
			},
			[motionX, metrics],
		);

		const handlePointerUp = useCallback(() => {
			if (!pointerStart.current) return;
			setPressed(false);

			if (dragging.current) {
				didDrag.current = true;
				dragging.current = false;

				const currentX = motionX.get();
				const dragMin = THUMB_OFFSET;
				const pressedThumbWidth = metrics.thumbSize + metrics.pressExtend;
				const dragMax = metrics.trackWidth - THUMB_OFFSET - pressedThumbWidth;
				const midpoint = (dragMin + dragMax) / 2;
				const shouldBeOn = currentX > midpoint;

				if (shouldBeOn !== checked) {
					commitToggle(shouldBeOn);
				} else {
					const snapTarget = checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET;
					animate(motionX, snapTarget, thumbTransition ?? spring.moderate);
				}

				requestAnimationFrame(() => {
					didDrag.current = false;
				});
			}

			pointerStart.current = null;
		}, [checked, commitToggle, motionX, thumbTransition, metrics, thumbTravel]);

		const handlePointerCancel = useCallback(() => {
			if (!pointerStart.current) return;
			setPressed(false);

			if (dragging.current) {
				dragging.current = false;
				const snapTarget = checked ? THUMB_OFFSET + thumbTravel : THUMB_OFFSET;
				animate(motionX, snapTarget, thumbTransition ?? spring.moderate);
			}

			pointerStart.current = null;
		}, [checked, motionX, thumbTransition, thumbTravel]);

		return (
			<div
				ref={ref}
				data-slot="switch-field"
				className={cn(
					"relative z-10 inline-flex items-center cursor-pointer select-none touch-none",
					label
						? cn("w-fit", sizeClasses.gap, sizeClasses.px, sizeClasses.variant === "compact" ? "py-1" : "py-2")
						: "",
					disabled && "opacity-50 pointer-events-none",
					className,
				)}
				onPointerEnter={(e) => {
					if (e.pointerType === "mouse") setHovered(true);
				}}
				onPointerLeave={() => setHovered(false)}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerCancel}
				onClick={() => {
					if (disabled || didDrag.current) return;
					commitToggle();
				}}
				{...props}
			>
				<SwitchPrimitive.Root
					id={id}
					data-slot="switch"
					checked={checked}
					aria-label={ariaLabel}
					aria-labelledby={label ? labelId : ariaLabelledBy}
					onCheckedChange={(next) => {
						if (didDrag.current) return;
						commitToggle(next);
					}}
					disabled={disabled}
					tabIndex={0}
					className={cn(
						"relative shrink-0 outline-none cursor-pointer transition-colors duration-80",
						sharp ? "rounded-none" : "rounded-full",
						"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
					)}
					style={{
						width: metrics.trackWidth,
						height: metrics.trackHeight,
						backgroundColor: checked
							? hovered
								? "color-mix(in oklab, var(--fluid-accent, #6B97FF), black 8%)"
								: "var(--fluid-accent, #6B97FF)"
							: hovered
								? "color-mix(in oklab, var(--accent), rgb(var(--overlay)) 10%)"
								: "var(--accent)",
					}}
					onClick={(e) => e.stopPropagation()}
				>
					<SwitchPrimitive.Thumb
						data-slot="switch-thumb"
						render={(thumbProps) => {
							const { style: baseStyle, ...baseProps } = thumbProps as React.HTMLAttributes<HTMLSpanElement>;
							const rest = omit(baseProps, [
								"onDrag",
								"onDragStart",
								"onDragEnd",
								"onAnimationStart",
								"onAnimationEnd",
								"onAnimationIteration",
							]);
							return (
								<m.span
									{...rest}
									className={cn(
										"absolute top-0 left-0 block bg-white shadow-sm",
										sharp ? "rounded-none" : "rounded-full",
									)}
									initial={false}
									style={{
										...(baseStyle as React.CSSProperties | undefined),
										x: motionX,
									}}
									animate={{
										y: thumbY,
										width: thumbWidth,
										height: thumbHeight,
									}}
									transition={hasMounted.current ? (thumbTransition ?? spring.moderate) : { duration: 0 }}
								/>
							);
						}}
					/>
				</SwitchPrimitive.Root>

				{label ? (
					<span
						id={labelId}
						className={cn(
							"[text-box:trim-both_cap_alphabetic] transition-[color] duration-80",
							sizeClasses.text,
							checked ? "text-foreground" : "text-muted-foreground",
						)}
					>
						{label}
					</span>
				) : null}
			</div>
		);
	},
);

Switch.displayName = "Switch";

export { Switch };
export type { SwitchProps };
