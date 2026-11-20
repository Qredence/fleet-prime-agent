"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { animate, AnimatePresence, m, type MotionValue, useMotionValue, useTransform } from "motion/react";
import {
	forwardRef,
	type HTMLAttributes,
	type Ref,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useShape } from "@/lib/fluid/shape-context";
import { fieldTouchClass, type SizeVariant, useSizeVariant } from "@/lib/fluid/size-context";
import { spring } from "@/lib/fluid/springs";
import { cn } from "@/lib/utils";

interface SliderEngineProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"onChange" | "defaultValue" | "onDrag" | "onDragStart" | "onDragEnd" | "onDragOver" | "onAnimationStart"
> {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	formatValue?: (v: number) => string;
	label?: string;
	disabled?: boolean;
}

const THUMB_SIZE = 20;
const THUMB_SIZE_REST = 16;
const TRACK_BG_HEIGHT = 18;

const PIP_SIZE = 5;
const MAX_DECORATIVE_PIPS = 24;
const TRACK_INSET = (THUMB_SIZE - TRACK_BG_HEIGHT) / 2;

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function normalizeStep(step: number): number {
	return Number.isFinite(step) && step > 0 ? step : Number.EPSILON;
}

function buildDiscreteSteps(min: number, max: number, step: number): number[] {
	if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return [];
	const rawCount = (max - min) / step + 1;
	if (!Number.isFinite(rawCount) || rawCount > MAX_DECORATIVE_PIPS) return [];
	const count = Math.round(rawCount);
	if (count < 2 || count > MAX_DECORATIVE_PIPS) return [];
	return Array.from({ length: count }, (_, i) => min + i * step);
}

function normalizeSlider(value: number, minProp: number, maxProp: number, step: number) {
	const min = Number.isFinite(minProp) ? minProp : 0;
	const max = Number.isFinite(maxProp) && maxProp >= min ? maxProp : min;
	return { min, max, step: normalizeStep(step), value: clampNumber(value, min, max) };
}

function snapValue(value: number, min: number, max: number, step: number) {
	return clampNumber(Math.round((value - min) / step) * step + min, min, max);
}

function useScalarValueChange(onChange: (value: number) => void, dragging?: { current: boolean }) {
	return useCallback(
		(value: number | readonly number[]) => {
			if (dragging?.current) return;
			const next = typeof value === "number" ? value : value[0];
			if (next !== undefined) onChange(next);
		},
		[dragging, onChange],
	);
}

function valueToPixel(v: number, min: number, max: number, trackWidth: number): number {
	if (max === min) return 0;
	const usable = trackWidth - THUMB_SIZE;
	return ((clampNumber(v, min, max) - min) / (max - min)) * usable;
}

function pixelToValue(px: number, min: number, max: number, step: number, trackWidth: number): number {
	const usable = trackWidth - THUMB_SIZE;
	if (usable <= 0) return min;
	const raw = (px / usable) * (max - min) + min;
	return snapValue(raw, min, max, step);
}

interface ValueDisplayProps {
	value: number;
	editing: boolean;
	onStartEdit: () => void;
	onCommitEdit: (value: number) => void;
	onCancelEdit: () => void;
	min: number;
	max: number;
	step: number;
	formatValue: (v: number) => string;
	label?: string;
	disabled: boolean;
	isInteracting: boolean;
}

function ValueDisplay({
	value,
	editing,
	onStartEdit,
	onCommitEdit,
	onCancelEdit,
	min,
	max,
	step,
	formatValue,
	label,
	disabled,
	isInteracting,
}: ValueDisplayProps) {
	const shape = useShape();
	const [inputValue, setInputValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!editing) return;
		const frame = requestAnimationFrame(() => inputRef.current?.select());
		return () => cancelAnimationFrame(frame);
	}, [editing]);

	const commitEdit = useCallback(() => {
		const parsed = Number.parseFloat(inputValue);
		if (!Number.isNaN(parsed)) {
			const clamped = clampNumber(parsed, min, max);
			onCommitEdit(snapValue(clamped, min, max, step));
		} else {
			onCancelEdit();
		}
	}, [inputValue, min, max, step, onCommitEdit, onCancelEdit]);

	const renderValue = () => {
		if (editing) {
			return (
				<span className="inline-grid text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)]">
					{[min, max].map((v) => (
						<span
							key={v}
							className="col-start-1 row-start-1 invisible"
							style={{ fontVariationSettings: fontWeights.normal }}
							aria-hidden="true"
						>
							{label ? `${label}: ` : ""}
							{formatValue(v)}
						</span>
					))}
					<span className="col-start-1 row-start-1 flex items-center gap-1">
						{label && <span className="text-muted-foreground">{label}:</span>}
						<span className="inline-flex w-[5ch] shrink-0">
							<input
								ref={inputRef}
								type="number"
								value={inputValue}
								disabled={disabled}
								min={min}
								max={max}
								step={step}
								onChange={(e) => setInputValue(e.target.value)}
								onBlur={commitEdit}
								onKeyDown={(e) => {
									if (e.key === "Enter") commitEdit();
									if (e.key === "Escape") onCancelEdit();
								}}
								aria-label="Edit slider value"
								className={cn(
									"w-full min-w-0 bg-transparent text-foreground outline-none border-b border-border text-center",
									fieldTouchClass,
									shape.input,
								)}
								style={{ fontVariationSettings: fontWeights.normal }}
							/>
						</span>
					</span>
				</span>
			);
		}

		return (
			<button
				type="button"
				disabled={disabled}
				className="cursor-text select-none border-0 bg-transparent p-0 text-inherit"
				aria-label={`${label ? `${label}: ` : ""}${formatValue(value)} (edit)`}
				onClick={() => {
					setInputValue(String(value));
					onStartEdit();
				}}
			>
				{formatValue(value)}
			</button>
		);
	};

	const ghostFor = (v: number) => {
		const text = formatValue(v);
		return (
			<>
				{label ? `${label}: ` : ""}
				{text}
			</>
		);
	};
	const ghostValues = [ghostFor(min), ghostFor(max)];

	return (
		<span
			className="inline-grid shrink-0 text-[length:var(--fs-body,13px)] leading-none text-muted-foreground transition-[font-variation-settings] duration-100 tabular-nums"
			style={{
				fontVariationSettings: isInteracting ? fontWeights.semibold : fontWeights.normal,
			}}
		>
			{ghostValues.map((ghost, i) => (
				<span
					key={i}
					className="col-start-1 row-start-1 invisible whitespace-nowrap"
					style={{ fontVariationSettings: fontWeights.semibold }}
					aria-hidden="true"
				>
					{ghost}
				</span>
			))}
			<span className="col-start-1 row-start-1 whitespace-nowrap">
				{label && !editing && <span className="text-muted-foreground">{label}: </span>}
				{renderValue()}
			</span>
		</span>
	);
}

const CompactSlider = forwardRef<HTMLDivElement, SliderEngineProps>(
	(
		{
			value,
			onChange,
			min: minProp = 0,
			max: maxProp = 100,
			step: stepProp = 1,
			formatValue = String,
			label,
			disabled = false,
			className,
			"aria-label": ariaLabelProp,
			...props
		},
		ref,
	) => {
		const { min, max, step: safeStep, value: currentValue } = normalizeSlider(value, minProp, maxProp, stepProp);
		const shape = useShape();
		const sharp = shape.variant === "sharp";

		const trackRef = useRef<HTMLDivElement>(null);
		const trackWidthRef = useRef(0);
		const dragging = useRef(false);
		const dragTargetValue = useRef(0);
		const valueRef = useRef(currentValue);
		const minRef = useRef(min);
		const maxRef = useRef(max);
		useLayoutEffect(() => {
			valueRef.current = currentValue;
			minRef.current = min;
			maxRef.current = max;
		});

		const [isHovered, setIsHovered] = useState(false);
		const [isPressed, setIsPressed] = useState(false);
		const [editing, setEditing] = useState(false);
		const [hoverPreview, setHoverPreview] = useState<{
			left: number;
			width: number;
			snappedValue: number;
			cursorX: number;
		} | null>(null);
		const [focused, setFocused] = useState(false);
		const [hoverDelayDone, setHoverDelayDone] = useState(false);

		if (!isHovered && hoverDelayDone) setHoverDelayDone(false);
		useEffect(() => {
			if (!isHovered) return;
			const id = setTimeout(() => setHoverDelayDone(true), 100);
			return () => clearTimeout(id);
		}, [isHovered]);
		const showHoverTooltip = isHovered && hoverDelayDone;

		const motionX0 = useMotionValue(0);
		const fillWidth = useTransform(motionX0, (x) => x + THUMB_SIZE / 2 - TRACK_INSET);

		const computeHoverPreview = useCallback(
			(cursorX: number, trackWidth: number) => {
				const usable = trackWidth - THUMB_SIZE;
				const rawPx = cursorX - THUMB_SIZE / 2;
				const clampedPx = Math.max(0, Math.min(usable, rawPx));
				const rawVal = usable > 0 ? (clampedPx / usable) * (max - min) + min : min;
				const snappedVal = snapValue(rawVal, min, max, safeStep);
				const snappedPercent = max === min ? 0 : (snappedVal - min) / (max - min);
				const snappedX = THUMB_SIZE / 2 + snappedPercent * usable;

				const nearest = motionX0.get() + THUMB_SIZE / 2;

				const edgeX = snappedVal === min ? 0 : snappedVal === max ? trackWidth : snappedX;
				const left = Math.min(nearest, edgeX);
				const width = Math.abs(edgeX - nearest);
				setHoverPreview({ left, width, snappedValue: snappedVal, cursorX: snappedX });
			},
			[min, max, safeStep, motionX0],
		);

		const initialSyncDone = useRef(false);
		const [ready, setReady] = useState(false);
		useLayoutEffect(() => {
			const el = trackRef.current;
			if (!el || initialSyncDone.current) return;
			const w = el.offsetWidth;
			trackWidthRef.current = w;
			motionX0.set(valueToPixel(currentValue, min, max, w));
			initialSyncDone.current = true;
			setReady(true);
		}, [currentValue, min, max, motionX0]);

		useEffect(() => {
			const el = trackRef.current;
			if (!el || typeof ResizeObserver === "undefined") return;
			const ro = new ResizeObserver(([entry]) => {
				const w = entry.contentRect.width;
				trackWidthRef.current = w;
				if (!dragging.current && initialSyncDone.current) {
					const v = valueRef.current;
					const mn = minRef.current;
					const mx = maxRef.current;
					animate(motionX0, valueToPixel(v, mn, mx, w), spring.moderate);
				}
			});
			ro.observe(el);
			return () => ro.disconnect();
		}, [motionX0]);

		useEffect(() => {
			if (!initialSyncDone.current || dragging.current) return;
			const tw = trackWidthRef.current;
			if (tw <= 0) return;
			const v = valueRef.current;
			animate(motionX0, valueToPixel(v, min, max, tw), spring.moderate);
		}, [currentValue, min, max, motionX0]);

		const handlePointerDown = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (disabled) return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();

				const trackEl = trackRef.current;
				if (!trackEl) return;
				const trackRect = trackEl.getBoundingClientRect();
				const layoutWidth = trackEl.offsetWidth;
				if (layoutWidth <= 0 || trackRect.width <= 0) return;
				const scale = trackRect.width / layoutWidth;
				const localX = (e.clientX - trackRect.left) / scale - THUMB_SIZE / 2;
				const clamped = Math.max(0, Math.min(layoutWidth - THUMB_SIZE, localX));

				dragging.current = true;
				setIsPressed(true);
				const snappedValue = pixelToValue(clamped, min, max, safeStep, layoutWidth);
				const snappedPx = valueToPixel(snappedValue, min, max, layoutWidth);
				animate(motionX0, snappedPx, spring.moderate);

				const finalValue = pixelToValue(snappedPx, min, max, safeStep, layoutWidth);
				dragTargetValue.current = finalValue;
				onChange(finalValue);

				if (typeof e.currentTarget.setPointerCapture === "function") {
					e.currentTarget.setPointerCapture(e.pointerId);
				}
			},
			[disabled, min, max, safeStep, motionX0, onChange],
		);

		const handlePointerMove = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (!dragging.current) return;
				e.stopPropagation();
				const trackEl = trackRef.current;
				if (!trackEl) return;
				const trackRect = trackEl.getBoundingClientRect();
				const layoutWidth = trackEl.offsetWidth;
				if (layoutWidth <= 0 || trackRect.width <= 0) return;
				const scale = trackRect.width / layoutWidth;
				const localX = (e.clientX - trackRect.left) / scale - THUMB_SIZE / 2;
				const clamped = Math.max(0, Math.min(layoutWidth - THUMB_SIZE, localX));
				const snappedValue = pixelToValue(clamped, min, max, safeStep, layoutWidth);
				const snappedPx = valueToPixel(snappedValue, min, max, layoutWidth);
				motionX0.set(snappedPx);

				const finalValue = pixelToValue(snappedPx, min, max, safeStep, layoutWidth);
				dragTargetValue.current = finalValue;
				onChange(finalValue);
			},
			[min, max, safeStep, motionX0, onChange],
		);

		const handlePointerUp = useCallback(() => {
			if (!dragging.current) return;
			dragging.current = false;
			setIsPressed(false);
			setHoverPreview(null);

			const tw = trackWidthRef.current;
			const snappedPx = valueToPixel(dragTargetValue.current, min, max, tw);
			animate(motionX0, snappedPx, spring.moderate);
		}, [min, max, motionX0]);

		const handleRadixChange = useScalarValueChange(onChange, dragging);

		const isInteracting = isHovered || isPressed;
		const effectiveLabel = ariaLabelProp ?? label;

		const valueDisplay = (
			<ValueDisplay
				value={currentValue}
				editing={editing}
				onStartEdit={() => setEditing(true)}
				onCommitEdit={(next) => {
					onChange(next);
					setEditing(false);
				}}
				onCancelEdit={() => setEditing(false)}
				min={min}
				max={max}
				step={safeStep}

				formatValue={formatValue}
				label={label}
				disabled={disabled}

				isInteracting={isInteracting}
			/>
		);

		const renderVisualThumb = () => {
			return (
				<m.span
					className="flex items-center justify-center pointer-events-none"
					style={{
						width: THUMB_SIZE,
						height: THUMB_SIZE,
						marginTop: -THUMB_SIZE / 2,
						x: motionX0,
						position: "absolute",
						top: "50%",
						left: 0,
						zIndex: 10,
					}}
					initial={false}
				>
					<m.span
						className={cn("block", sharp ? "rounded-none" : "rounded-full")}
						initial={false}
						animate={{ width: THUMB_SIZE_REST, height: THUMB_SIZE_REST }}
						transition={spring.fast}
						style={{
							backgroundColor: "white",
							boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
						}}
					/>
					<m.span
						className={cn(
							"absolute border border-[color:var(--focus-ring,#6B97FF)] pointer-events-none",
							sharp ? "rounded-none" : "rounded-full",
						)}
						initial={false}
						animate={{
							opacity: focused ? 1 : 0,
							width: THUMB_SIZE + 4,
							height: THUMB_SIZE + 4,
						}}
						transition={spring.fast}
					/>
				</m.span>
			);
		};

		return (
			<div
				ref={ref}
				data-slot="slider"
				className={cn(
					"flex flex-col gap-0 w-full select-none touch-none overflow-visible",
					"flex-row items-center gap-2 mb-2",
					disabled && "opacity-50 pointer-events-none",
					className,
				)}
				{...props}
			>
				{valueDisplay}

				<div
					className="relative flex-1 overflow-visible"
					style={{
						height: THUMB_SIZE + 16,
					}}
					onPointerEnter={() => setIsHovered(true)}
					onPointerLeave={() => {
						setIsHovered(false);
						setHoverPreview(null);
					}}
					onMouseMove={(e) => {
						if (dragging.current) return;
						const trackEl = trackRef.current;
						if (!trackEl) return;
						const trackRect = trackEl.getBoundingClientRect();
						const layoutWidth = trackEl.offsetWidth;
						if (layoutWidth <= 0 || trackRect.width <= 0) return;
						const scale = trackRect.width / layoutWidth;
						const layoutX = (e.clientX - trackRect.left) / scale;
						const clamped = Math.max(0, Math.min(layoutWidth, layoutX));
						computeHoverPreview(clamped, layoutWidth);
					}}
				>
					<SliderPrimitive.Root
						value={[currentValue]}
						onValueChange={handleRadixChange}
						min={min}
						max={max}
						step={safeStep}
						disabled={disabled}
						className="absolute inset-0 pointer-events-none [&_*]:pointer-events-none"
					>
						<SliderPrimitive.Control className="w-full h-full">
							<SliderPrimitive.Track className="w-full h-full">
								<SliderPrimitive.Indicator />
							</SliderPrimitive.Track>
							<SliderPrimitive.Thumb
								index={0}
								aria-label={effectiveLabel}
								getAriaValueText={() => formatValue(currentValue)}
								className="block outline-none"
								style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
								onFocus={(e) => {
									if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setFocused(true);
								}}
								onBlur={() => setFocused(false)}
							/>
						</SliderPrimitive.Control>
					</SliderPrimitive.Root>

					<div
						ref={trackRef}
						data-slot="slider-track"
						className="relative w-full cursor-ew-resize py-2"
						style={{ height: THUMB_SIZE + 16, opacity: ready ? 1 : 0 }}
						onPointerDown={handlePointerDown}
						onPointerMove={handlePointerMove}
						onPointerUp={handlePointerUp}
						onPointerCancel={handlePointerUp}
					>
						<div
							className="absolute -inset-x-2 inset-y-0 cursor-ew-resize"
							onPointerDown={handlePointerDown}
							onPointerMove={handlePointerMove}
							onPointerUp={handlePointerUp}
							onPointerCancel={handlePointerUp}
						/>

						<AnimatePresence>
							{hoverPreview && showHoverTooltip && !isPressed && (
								<m.div
									key="hover-tooltip"
									className="absolute -translate-x-1/2 pointer-events-none z-20"
									initial={{ opacity: 0, y: 4 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: 4, transition: spring.fast.exit }}
									transition={spring.fast}
									style={{ left: hoverPreview.cursorX, top: -20 }}
								>
									<span
										className={cn(
											"text-[length:var(--fs-caption,12px)] leading-[var(--lh-caption,16px)] text-background tabular-nums whitespace-nowrap bg-foreground px-2 py-1",
											shape.bg,
										)}
										style={{ fontVariationSettings: fontWeights.normal }}
									>
										{formatValue(hoverPreview.snappedValue)}
									</span>
								</m.div>
							)}
						</AnimatePresence>

						<m.div
							className={cn(
								"absolute border border-border overflow-hidden",
								sharp ? "rounded-none" : "rounded-full",
							)}
							initial={false}
							animate={{
								height: TRACK_BG_HEIGHT,
								top: 8 + (THUMB_SIZE - TRACK_BG_HEIGHT) / 2,
							}}
							transition={spring.fast}
							style={{
								left: TRACK_INSET,
								right: TRACK_INSET,
								backgroundColor: "transparent",
							}}
						>
							<m.div
								className="absolute h-full bg-selected/50 dark:bg-accent/40"
								style={{ left: 0, width: fillWidth }}
							/>

							<m.div
								className="absolute h-full pointer-events-none z-[2]"
								initial={false}
								animate={{ opacity: hoverPreview && !isPressed ? 1 : 0 }}
								transition={{ opacity: { duration: 0.15 } }}
								style={{
									left: hoverPreview ? hoverPreview.left - TRACK_INSET : 0,
									width: hoverPreview ? hoverPreview.width : 0,
									borderRadius: sharp
										? 0
										: hoverPreview && hoverPreview.cursorX > hoverPreview.left
											? "0 9999px 9999px 0"
											: "9999px 0 0 9999px",
									backgroundColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
								}}
							/>
						</m.div>

						{renderVisualThumb()}
					</div>
				</div>
			</div>
		);
	},
);

CompactSlider.displayName = "SliderCompact";

const ComfortableSlider = forwardRef<HTMLDivElement, SliderEngineProps>(
	(
		{
			value: rawValue,
			onChange,
			min: minProp = 0,
			max: maxProp = 100,
			step: stepProp = 1,
			label,
			formatValue = String,
			disabled = false,
			className,
			"aria-label": ariaLabelProp,
			...props
		},
		ref,
	) => {
		const { min, max, step, value } = normalizeSlider(rawValue, minProp, maxProp, stepProp);

		const valueCh = Math.max(String(formatValue(min)).length, String(formatValue(max)).length);
		const containerRef = useRef<HTMLDivElement>(null);
		const dragging = useRef(false);
		const [isHovered, setIsHovered] = useState(false);
		const [isPressed, setIsPressed] = useState(false);
		const [isFocused, setIsFocused] = useState(false);
		const [hoverPreview, setHoverPreview] = useState<{
			left: number;
			width: number;
			snappedValue: number;
			cursorX: number;
		} | null>(null);
		const [hoverDelayDone, setHoverDelayDone] = useState(false);
		const shape = useShape();

		if (!isHovered && hoverDelayDone) setHoverDelayDone(false);
		useEffect(() => {
			if (!isHovered) return;
			const id = setTimeout(() => setHoverDelayDone(true), 100);
			return () => clearTimeout(id);
		}, [isHovered]);
		const showHoverTooltip = isHovered && hoverDelayDone;

		const mergedRef = useCallback(
			(el: HTMLDivElement | null) => {
				containerRef.current = el;
				if (typeof ref === "function") ref(el);
				else if (ref) ref.current = el;
			},
			[ref],
		);

		const pipSteps = useMemo(() => buildDiscreteSteps(min, max, step), [min, max, step]);
		const pipCount = pipSteps.length;

		const fillPercent = useMotionValue(max === min ? 0 : clampNumber((value - min) / (max - min), 0, 1));
		const zeroTarget = 8;
		const zeroOffset = useMotionValue(value === min ? zeroTarget : 0);

		const pipsFillWidthStyle = useTransform(
			[fillPercent, zeroOffset] as MotionValue<number>[],
			([p, zo]) => `calc(${(p as number) * 100}% + ${20 - 20 * (p as number) - (zo as number) * 2.5}px)`,
		);
		const pipsHandleLineLeftStyle = useTransform(fillPercent, (p) => `calc(${p * 100}% + ${11 - 24 * p}px)`);
		const pipsMaskStyle = useTransform([fillPercent, zeroOffset] as MotionValue<number>[], ([p, zo]) => {
			const offset = 20 - 20 * (p as number) - (zo as number) * 2.5;
			return `linear-gradient(to right, transparent calc(${(p as number) * 100}% + ${offset}px), black calc(${(p as number) * 100}% + ${offset + 2}px))`;
		});

		const computeHoverPreview = useCallback(
			(clientX: number) => {
				const el = containerRef.current;
				if (!el) return;
				const rect = el.getBoundingClientRect();
				const w = el.clientWidth;
				if (w <= 0 || rect.width <= 0) return;
				const scale = rect.width / el.offsetWidth;
				const borderLeftLayout = (el.offsetWidth - w) / 2;
				const visualX = clientX - rect.left;
				const layoutX = visualX / scale - borderLeftLayout;
				const clamped = Math.max(0, Math.min(w, layoutX));

				let snappedVal: number;
				if (pipCount >= 2) {
					const index = Math.max(0, Math.min(pipCount - 1, Math.round((clamped / w) * (pipCount - 1))));
					snappedVal = pipSteps[index];
				} else {
					const raw = min + (clamped / w) * (max - min);
					snappedVal = snapValue(raw, min, max, step);
				}
				const snappedPercent = max === min ? 0 : (snappedVal - min) / (max - min);
				const snappedX = snappedPercent * w;

				const currentPercent = fillPercent.get();
				const zo = zeroOffset.get();
				const handleX = currentPercent * w + (20 - 20 * currentPercent - zo * 2.5);

				const edgeX = snappedVal === min ? 0 : snappedVal === max ? w : snappedX;
				const left = Math.min(handleX, edgeX);
				const width = Math.abs(edgeX - handleX);
				setHoverPreview({ left, width, snappedValue: snappedVal, cursorX: snappedX });
			},
			[pipSteps, pipCount, min, max, step, fillPercent, zeroOffset],
		);

		useEffect(() => {
			if (dragging.current) return;
			const percent = max === min ? 0 : clampNumber((value - min) / (max - min), 0, 1);
			animate(fillPercent, percent, spring.fast);
			animate(zeroOffset, value === min ? zeroTarget : 0, spring.fast);
		}, [value, min, max, fillPercent, zeroOffset, zeroTarget]);

		const getValueFromX = useCallback(
			(clientX: number) => {
				const rect = containerRef.current?.getBoundingClientRect();
				if (!rect || rect.width <= 0) return min;
				const x = clientX - rect.left;
				const clamped = Math.max(0, Math.min(rect.width, x));
				if (pipCount >= 2) {
					const index = Math.max(0, Math.min(pipCount - 1, Math.round((clamped / rect.width) * (pipCount - 1))));
					return pipSteps[index];
				}
				const raw = min + (clamped / rect.width) * (max - min);
				const snapped = Math.round((raw - min) / step) * step + min;
				return clampNumber(snapped, min, max);
			},
			[pipSteps, pipCount, min, max, step],
		);

		const handlePointerDown = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (disabled) return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				e.preventDefault();
				dragging.current = true;
				setIsPressed(true);
				const newVal = getValueFromX(e.clientX);
				onChange(newVal);
				const newPercent = max === min ? 0 : clampNumber((newVal - min) / (max - min), 0, 1);
				animate(fillPercent, newPercent, spring.fast);
				animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
				if (typeof e.currentTarget.setPointerCapture === "function") {
					e.currentTarget.setPointerCapture(e.pointerId);
				}
			},
			[disabled, getValueFromX, onChange, fillPercent, zeroOffset, zeroTarget, min, max],
		);

		const handlePointerMove = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (!dragging.current) return;
				const newVal = getValueFromX(e.clientX);
				onChange(newVal);
				const newPercent = max === min ? 0 : clampNumber((newVal - min) / (max - min), 0, 1);
				animate(fillPercent, newPercent, spring.fast);
				animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
			},
			[getValueFromX, onChange, fillPercent, zeroOffset, zeroTarget, min, max],
		);

		const handlePointerUp = useCallback(() => {
			dragging.current = false;
			setIsPressed(false);
			setHoverPreview(null);
		}, []);

		const handleRadixChange = useScalarValueChange(onChange);

		const isActive = isHovered || isFocused;
		const accessibleLabel = ariaLabelProp ?? label;

		return (
			<div
				className="relative w-full touch-none"
				onPointerEnter={() => {
					if (!disabled) setIsHovered(true);
				}}
				onPointerLeave={() => {
					if (!disabled) {
						setIsHovered(false);
						setHoverPreview(null);
					}
				}}
				onMouseMove={(e) => {
					if (disabled || dragging.current) return;
					computeHoverPreview(e.clientX);
				}}
			>
				<div
					className="absolute -inset-x-2 inset-y-0 cursor-ew-resize"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerUp}
				/>

				<AnimatePresence>
					{hoverPreview && showHoverTooltip && !isPressed && (
						<m.div
							key="hover-tooltip"
							className="absolute -translate-x-1/2 pointer-events-none z-20"
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 4, transition: spring.fast.exit }}
							transition={spring.fast}
							style={{ left: hoverPreview.cursorX, top: -30 }}
						>
							<span
								className={cn(
									"text-[length:var(--fs-caption,12px)] leading-[var(--lh-caption,16px)] text-background tabular-nums whitespace-nowrap bg-foreground px-2 py-1",
									shape.bg,
								)}
								style={{ fontVariationSettings: fontWeights.normal }}
							>
								{formatValue(hoverPreview.snappedValue)}
							</span>
						</m.div>
					)}
				</AnimatePresence>

				<m.div
					ref={mergedRef}
					data-slot="slider"
					data-slider-track
					className={cn(
						"relative w-full h-8 select-none touch-none border border-border overflow-hidden outline-offset-2 cursor-ew-resize",
						shape.bg,
						disabled && "opacity-50 pointer-events-none",
						className,
					)}
					initial={false}
					animate={{
						outline: isFocused ? "1px solid var(--focus-ring, #6B97FF)" : "1px solid transparent",
					}}
					transition={spring.fast}
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={handlePointerUp}
					{...props}
				>
					<SliderPrimitive.Root
						value={[value]}
						onValueChange={handleRadixChange}
						min={min}
						max={max}
						step={step}
						disabled={disabled}
						className="absolute inset-0 pointer-events-none [&_*]:pointer-events-none"
					>
						<SliderPrimitive.Control className="w-full h-full">
							<SliderPrimitive.Track className="w-full h-full">
								<SliderPrimitive.Indicator />
							</SliderPrimitive.Track>
							<SliderPrimitive.Thumb
								index={0}
								aria-label={accessibleLabel}
								getAriaValueText={() => formatValue(value)}
								className="block size-4 outline-none"
								onFocus={(e) => {
									if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setIsFocused(true);
								}}
								onBlur={() => setIsFocused(false)}
							/>
						</SliderPrimitive.Control>
					</SliderPrimitive.Root>

					<m.div
						className="absolute inset-y-0 pointer-events-none z-[3]"
						initial={false}
						animate={{ opacity: hoverPreview && !isPressed ? 1 : 0 }}
						transition={{ opacity: { duration: 0.15 } }}
						style={{
							left: hoverPreview ? hoverPreview.left : 0,
							width: hoverPreview ? hoverPreview.width : 0,
							backgroundColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
						}}
					/>

					{pipSteps.length > 0 && (
						<m.div
							className="absolute inset-0 flex justify-between items-center px-3 pointer-events-none z-[1]"
							style={{ WebkitMaskImage: pipsMaskStyle, maskImage: pipsMaskStyle }}
						>
							{pipSteps.map((pipValue) => {
								const isActivePip = pipValue === value;
								return (
									<div
										key={pipValue}
										className="relative flex items-center justify-center"
										style={{ width: PIP_SIZE, height: PIP_SIZE }}
									>
										<m.span
											className="size-[5px] rounded-full"
											initial={false}
											animate={{
												backgroundColor: isActivePip ? "var(--foreground)" : "var(--muted-foreground)",
												opacity: isActivePip ? 1 : 0.3,
											}}
											transition={spring.fast}
										/>
									</div>
								);
							})}
						</m.div>
					)}

					<div className="absolute inset-0 flex items-center px-2 z-[2] pointer-events-none" aria-hidden>
						{label && (
							<span className="text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] px-2 bg-background text-transparent select-none">
								{label}
							</span>
						)}
						<span
							className="text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] tabular-nums ml-auto px-2 bg-background text-transparent select-none"
							style={{ minWidth: `${valueCh}ch` }}
						>
							{formatValue(value)}
						</span>
					</div>

					<m.div
						className="absolute left-0 top-0 bottom-0 pointer-events-none z-[3] bg-active"
						style={{ width: pipsFillWidthStyle }}
					/>

					<m.div
						className="absolute rounded-full pointer-events-none z-[3] w-0.5"
						initial={false}
						animate={{
							top: isActive ? 7 : 8,
							bottom: isActive ? 7 : 8,
							backgroundColor: isFocused
								? "var(--foreground)"
								: isHovered
									? "color-mix(in srgb, var(--foreground) 50%, transparent)"
									: "color-mix(in srgb, var(--foreground) 25%, transparent)",
						}}
						transition={spring.fast}
						style={{ left: pipsHandleLineLeftStyle }}
					/>

					<div className="absolute inset-0 flex items-center px-2 z-[4] pointer-events-none">
						{label && (
							<m.span
								className="text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] px-2"
								initial={false}
								animate={{ color: isActive ? "var(--foreground)" : "var(--muted-foreground)" }}
								transition={spring.fast}
							>
								{label}
							</m.span>
						)}
						<m.span
							className="text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] tabular-nums ml-auto px-2 text-right"
							initial={false}
							animate={{ color: isActive ? "var(--foreground)" : "var(--muted-foreground)" }}
							transition={spring.fast}
							style={{ minWidth: `${valueCh}ch` }}
						>
							{formatValue(value)}
						</m.span>
					</div>
				</m.div>
			</div>
		);
	},
);

ComfortableSlider.displayName = "SliderComfortable";

function Slider({ size, ref, ...props }: SliderEngineProps & { size?: SizeVariant; ref?: Ref<HTMLDivElement> }) {
	const Engine = useSizeVariant(size) === "compact" ? CompactSlider : ComfortableSlider;
	return <Engine ref={ref} {...props} />;
}

export { Slider };
