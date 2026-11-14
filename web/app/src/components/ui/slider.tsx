"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { animate, AnimatePresence, m, type MotionValue, useMotionValue, useTransform } from "motion/react";
import {
	type CSSProperties,
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
import { omit } from "@/lib/fluid/omit";
import { useShape } from "@/lib/fluid/shape-context";
import { fieldTouchClass, type SizeVariant, useSizeVariant } from "@/lib/fluid/size-context";
import { spring } from "@/lib/fluid/springs";
import { cn } from "@/lib/utils";

type SliderValue = number | [number, number];
type ValuePosition = "left" | "right" | "top" | "bottom" | "tooltip";

interface SliderEngineProps<V extends SliderValue = SliderValue> extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"onChange" | "defaultValue"
> {
	value: V;
	onChange: (value: V) => void;
	min?: number;
	max?: number;
	step?: number;
	/** Discrete list of allowed values. */
	steps?: number[];
	showSteps?: boolean;
	showValue?: boolean;
	valuePosition?: ValuePosition;
	formatValue?: (v: number) => string;
	label?: string;
	disabled?: boolean;
	trackClassName?: string;
	trackStyle?: CSSProperties;
	fillClassName?: string;
	fillStyle?: CSSProperties;
	hideFill?: boolean;
	thumbColor?: string;
	thumbBorderColor?: string;
}

const THUMB_SIZE = 20;
const THUMB_SIZE_REST = 16;
const TRACK_BG_HEIGHT = 18;
const DOT_SIZE = 4;
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

function valueToPixel(v: number, min: number, max: number, trackWidth: number): number {
	if (max === min) return 0;
	const usable = trackWidth - THUMB_SIZE;
	return ((clampNumber(v, min, max) - min) / (max - min)) * usable;
}

function nearestStepIndex(v: number, steps: number[]): number {
	let idx = 0;
	for (let i = 1; i < steps.length; i++) {
		if (Math.abs(steps[i] - v) < Math.abs(steps[idx] - v)) idx = i;
	}
	return idx;
}

function pixelToValue(
	px: number,
	min: number,
	max: number,
	step: number,
	trackWidth: number,
	stepValues: number[] | null = null,
): number {
	const usable = trackWidth - THUMB_SIZE;
	if (usable <= 0) return min;
	const raw = (px / usable) * (max - min) + min;
	if (stepValues) return stepValues[nearestStepIndex(raw, stepValues)];
	const snapped = Math.round((raw - min) / step) * step + min;
	return clampNumber(snapped, min, max);
}

function toRadixValue(value: SliderValue): number[] {
	return Array.isArray(value) ? value : [value];
}

interface ValueDisplayProps {
	values: number[];
	editingIndex: number | null;
	onStartEdit: (index: number) => void;
	onCommitEdit: (index: number, v: number) => void;
	onCancelEdit: () => void;
	min: number;
	max: number;
	step: number;
	stepValues: number[] | null;
	formatValue: (v: number) => string;
	label?: string;
	isRange: boolean;
	isInteracting: boolean;
}

function ValueDisplay({
	values,
	editingIndex,
	onStartEdit,
	onCommitEdit,
	onCancelEdit,
	min,
	max,
	step,
	stepValues,
	formatValue,
	label,
	isRange,
	isInteracting,
}: ValueDisplayProps) {
	const shape = useShape();
	const [inputValue, setInputValue] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const [seededIndex, setSeededIndex] = useState<number | null>(null);
	if (seededIndex !== editingIndex) {
		setSeededIndex(editingIndex);
		if (editingIndex !== null) setInputValue(String(values[editingIndex]));
	}
	useEffect(() => {
		if (editingIndex === null) return;
		const frame = requestAnimationFrame(() => inputRef.current?.select());
		return () => cancelAnimationFrame(frame);
	}, [editingIndex]);

	const commitEdit = useCallback(
		(index: number) => {
			const parsed = parseFloat(inputValue);
			if (!Number.isNaN(parsed)) {
				const clamped = clampNumber(parsed, min, max);
				const snapped = stepValues
					? stepValues[nearestStepIndex(clamped, stepValues)]
					: Math.round((clamped - min) / step) * step + min;
				onCommitEdit(index, snapped);
			} else {
				onCancelEdit();
			}
		},
		[inputValue, min, max, step, stepValues, onCommitEdit, onCancelEdit],
	);

	const renderValue = (index: number) => {
		if (editingIndex === index) {
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
								min={min}
								max={max}
								step={stepValues ? "any" : step}
								onChange={(e) => setInputValue(e.target.value)}
								onBlur={() => commitEdit(index)}
								onKeyDown={(e) => {
									if (e.key === "Enter") commitEdit(index);
									if (e.key === "Escape") onCancelEdit();
								}}
								aria-label={`Edit slider value${isRange ? (index === 0 ? " (start)" : " (end)") : ""}`}
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
			<span className="cursor-text select-none" onClick={() => onStartEdit(index)}>
				{formatValue(values[index])}
			</span>
		);
	};

	const ghostFor = (v: number) => {
		const text = formatValue(v);
		return (
			<>
				{label ? `${label}: ` : ""}
				{text}
				{isRange && (
					<>
						<span className="mx-1">–</span>
						{text}
					</>
				)}
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
				{label && editingIndex === null && <span className="text-muted-foreground">{label}: </span>}
				{isRange ? (
					<>
						{renderValue(0)}
						<span className="mx-1 text-muted-foreground">–</span>
						{renderValue(1)}
					</>
				) : (
					renderValue(0)
				)}
			</span>
		</span>
	);
}

interface TooltipValueProps {
	value: number;
	formatValue: (v: number) => string;
	motionX: MotionValue<number>;
}

function TooltipValue({ value, formatValue, motionX }: TooltipValueProps) {
	const shape = useShape();
	const tooltipX = useTransform(motionX, (x) => x + THUMB_SIZE / 2);
	return (
		<m.div
			className="absolute -translate-x-1/2 pointer-events-none z-20"
			style={{
				x: tooltipX,
				top: -16,
			}}
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: 4, transition: spring.fast.exit }}
			transition={spring.fast}
		>
			<span
				className={cn(
					"text-[length:var(--fs-caption,12px)] leading-[var(--lh-caption,16px)] text-background tabular-nums whitespace-nowrap bg-foreground px-2 py-1",
					shape.bg,
				)}
				style={{ fontVariationSettings: fontWeights.normal }}
			>
				{formatValue(value)}
			</span>
		</m.div>
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
			steps,
			showSteps = false,
			showValue = true,
			valuePosition = "left",
			formatValue = String,
			label,
			disabled = false,
			trackClassName,
			trackStyle,
			fillClassName,
			fillStyle,
			hideFill = false,
			thumbColor,
			thumbBorderColor,
			className,
			"aria-label": ariaLabelProp,
			...props
		},
		ref,
	) => {
		const isRange = Array.isArray(value);
		const safeStep = normalizeStep(stepProp);

		const stepsKey = steps ? steps.join(",") : "";
		const stepValues = useMemo(() => {
			if (!stepsKey) return null;
			const parsed = Array.from(new Set(stepsKey.split(",").map(Number))).sort((a, b) => a - b);
			return parsed.length > 1 ? parsed : null;
		}, [stepsKey]);
		const min = stepValues ? stepValues[0] : Number.isFinite(minProp) ? minProp : 0;
		const max = stepValues
			? stepValues[stepValues.length - 1]
			: Number.isFinite(maxProp) && maxProp >= min
				? maxProp
				: min;

		const rawValues = toRadixValue(value);
		const values = useMemo(() => rawValues.map((v) => clampNumber(v, min, max)), [rawValues, min, max]);
		const shape = useShape();
		const sharp = shape.variant === "sharp";

		const trackRef = useRef<HTMLDivElement>(null);
		const trackWidthRef = useRef(0);
		const dragging = useRef(false);
		const dragTargetValue = useRef(0);
		const activeDragThumb = useRef<number>(0);
		const valuesRef = useRef(values);
		const minRef = useRef(min);
		const maxRef = useRef(max);
		useLayoutEffect(() => {
			valuesRef.current = values;
			minRef.current = min;
			maxRef.current = max;
		});

		const [isHovered, setIsHovered] = useState(false);
		const [isPressed, setIsPressed] = useState(false);
		const [editingIndex, setEditingIndex] = useState<number | null>(null);
		const [hoverPreview, setHoverPreview] = useState<{
			left: number;
			width: number;
			snappedValue: number;
			cursorX: number;
		} | null>(null);
		const [focusedThumb, setFocusedThumb] = useState<number | null>(null);
		const [hoverDelayDone, setHoverDelayDone] = useState(false);

		if (!isHovered && hoverDelayDone) setHoverDelayDone(false);
		useEffect(() => {
			if (!isHovered) return;
			const id = setTimeout(() => setHoverDelayDone(true), 100);
			return () => clearTimeout(id);
		}, [isHovered]);
		const showHoverTooltip = isHovered && hoverDelayDone;

		const motionX0 = useMotionValue(0);
		const motionX1 = useMotionValue(0);

		const fillLeft = useTransform(motionX0, (x) => (isRange ? x + THUMB_SIZE / 2 - TRACK_INSET : 0));
		const fillWidthSingle = useTransform(motionX0, (x) => x + THUMB_SIZE / 2 - TRACK_INSET);
		const fillWidthRange = useTransform(
			[motionX0, motionX1] as MotionValue<number>[],
			([x0, x1]) => (x1 as number) - (x0 as number),
		);
		const fillWidth = isRange ? fillWidthRange : fillWidthSingle;

		const stepDotsMaskSingle = useTransform(motionX0, (x) => {
			const edge = x + THUMB_SIZE / 2;
			return `linear-gradient(to right, transparent ${edge}px, black ${edge + 2}px)`;
		});
		const stepDotsMaskRange = useTransform([motionX0, motionX1] as MotionValue<number>[], ([x0, x1]) => {
			const left = (x0 as number) + THUMB_SIZE / 2;
			const right = (x1 as number) + THUMB_SIZE / 2;
			return `linear-gradient(to right, black ${left - 2}px, transparent ${left}px, transparent ${right}px, black ${right + 2}px)`;
		});
		const stepDotsMask = isRange ? stepDotsMaskRange : stepDotsMaskSingle;

		const computeHoverPreview = useCallback(
			(cursorX: number, trackWidth: number) => {
				const usable = trackWidth - THUMB_SIZE;
				const rawPx = cursorX - THUMB_SIZE / 2;
				const clampedPx = Math.max(0, Math.min(usable, rawPx));
				const rawVal = usable > 0 ? (clampedPx / usable) * (max - min) + min : min;
				const snappedVal = stepValues
					? stepValues[nearestStepIndex(rawVal, stepValues)]
					: clampNumber(Math.round((rawVal - min) / safeStep) * safeStep + min, min, max);
				const snappedPercent = max === min ? 0 : (snappedVal - min) / (max - min);
				const snappedX = THUMB_SIZE / 2 + snappedPercent * usable;

				const c0 = motionX0.get() + THUMB_SIZE / 2;
				const c1 = motionX1.get() + THUMB_SIZE / 2;
				const nearestIdx = isRange ? (Math.abs(snappedX - c0) <= Math.abs(snappedX - c1) ? 0 : 1) : 0;
				const nearest = nearestIdx === 0 ? c0 : c1;

				const edgeX = snappedVal === min ? 0 : snappedVal === max ? trackWidth : snappedX;
				const left = Math.min(nearest, edgeX);
				const width = Math.abs(edgeX - nearest);
				setHoverPreview({ left, width, snappedValue: snappedVal, cursorX: snappedX });
			},
			[min, max, safeStep, stepValues, isRange, motionX0, motionX1],
		);

		const initialSyncDone = useRef(false);
		const [ready, setReady] = useState(false);
		useLayoutEffect(() => {
			const el = trackRef.current;
			if (!el || initialSyncDone.current) return;
			const w = el.offsetWidth;
			trackWidthRef.current = w;
			motionX0.set(valueToPixel(values[0], min, max, w));
			if (isRange && values[1] !== undefined) {
				motionX1.set(valueToPixel(values[1], min, max, w));
			}
			initialSyncDone.current = true;
			setReady(true);
		}, [values, min, max, isRange, motionX0, motionX1]);

		useEffect(() => {
			const el = trackRef.current;
			if (!el || typeof ResizeObserver === "undefined") return;
			const ro = new ResizeObserver(([entry]) => {
				const w = entry.contentRect.width;
				trackWidthRef.current = w;
				if (!dragging.current && initialSyncDone.current) {
					const v = valuesRef.current;
					const mn = minRef.current;
					const mx = maxRef.current;
					animate(motionX0, valueToPixel(v[0], mn, mx, w), spring.moderate);
					if (isRange && v[1] !== undefined) {
						animate(motionX1, valueToPixel(v[1], mn, mx, w), spring.moderate);
					}
				}
			});
			ro.observe(el);
			return () => ro.disconnect();
		}, [isRange, motionX0, motionX1]);

		const valuesKey = values.join(",");
		useEffect(() => {
			if (!initialSyncDone.current || dragging.current) return;
			const tw = trackWidthRef.current;
			if (tw <= 0) return;
			const v = valuesRef.current;
			animate(motionX0, valueToPixel(v[0], min, max, tw), spring.moderate);
			if (isRange && v[1] !== undefined) {
				animate(motionX1, valueToPixel(v[1], min, max, tw), spring.moderate);
			}
		}, [valuesKey, min, max, isRange, motionX0, motionX1]);

		const clampForRange = useCallback(
			(px: number, thumbIndex: number): number => {
				if (!isRange) return px;
				if (thumbIndex === 0) return Math.min(px, motionX1.get() - THUMB_SIZE * 0.5);
				return Math.max(px, motionX0.get() + THUMB_SIZE * 0.5);
			},
			[isRange, motionX0, motionX1],
		);

		const emitChange = useCallback(
			(thumbIndex: number, newValue: number) => {
				if (isRange) {
					const newValues: [number, number] = [values[0], values[1] ?? values[0]];
					newValues[thumbIndex] = newValue;
					onChange(newValues);
				} else {
					onChange(newValue);
				}
			},
			[isRange, values, onChange],
		);

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

				if (isRange) {
					const dist0 = Math.abs(clamped - motionX0.get());
					const dist1 = Math.abs(clamped - motionX1.get());
					activeDragThumb.current = dist0 <= dist1 ? 0 : 1;
				} else {
					activeDragThumb.current = 0;
				}

				dragging.current = true;
				setIsPressed(true);

				const motionX = activeDragThumb.current === 0 ? motionX0 : motionX1;
				const snappedValue = pixelToValue(clamped, min, max, safeStep, layoutWidth, stepValues);
				const snappedPx = valueToPixel(snappedValue, min, max, layoutWidth);
				const finalPx = clampForRange(snappedPx, activeDragThumb.current);
				animate(motionX, finalPx, spring.moderate);

				const finalValue = pixelToValue(finalPx, min, max, safeStep, layoutWidth, stepValues);
				dragTargetValue.current = finalValue;
				emitChange(activeDragThumb.current, finalValue);

				if (typeof e.currentTarget.setPointerCapture === "function") {
					e.currentTarget.setPointerCapture(e.pointerId);
				}
			},
			[disabled, isRange, min, max, safeStep, stepValues, motionX0, motionX1, clampForRange, emitChange],
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

				const motionX = activeDragThumb.current === 0 ? motionX0 : motionX1;
				const snappedValue = pixelToValue(clamped, min, max, safeStep, layoutWidth, stepValues);
				const snappedPx = valueToPixel(snappedValue, min, max, layoutWidth);
				const finalPx = clampForRange(snappedPx, activeDragThumb.current);
				motionX.set(finalPx);

				const finalValue = pixelToValue(finalPx, min, max, safeStep, layoutWidth, stepValues);
				dragTargetValue.current = finalValue;
				emitChange(activeDragThumb.current, finalValue);
			},
			[min, max, safeStep, stepValues, motionX0, motionX1, clampForRange, emitChange],
		);

		const handlePointerUp = useCallback(() => {
			if (!dragging.current) return;
			dragging.current = false;
			setIsPressed(false);
			setHoverPreview(null);

			const tw = trackWidthRef.current;
			const motionX = activeDragThumb.current === 0 ? motionX0 : motionX1;
			const snappedPx = valueToPixel(dragTargetValue.current, min, max, tw);
			animate(motionX, snappedPx, spring.moderate);
		}, [min, max, motionX0, motionX1]);

		const handleRadixChange = useCallback(
			(nextRaw: number | readonly number[]) => {
				if (dragging.current) return;
				const newValues = Array.isArray(nextRaw) ? nextRaw : [nextRaw as number];
				const mapped = stepValues ? newValues.map((i) => stepValues[Math.round(i)]) : newValues;
				if (isRange) {
					onChange(mapped as [number, number]);
				} else {
					onChange(mapped[0]);
				}
			},
			[isRange, onChange, stepValues],
		);

		const handleStartEdit = useCallback((index: number) => setEditingIndex(index), []);
		const handleCommitEdit = useCallback(
			(index: number, v: number) => {
				emitChange(index, v);
				setEditingIndex(null);
			},
			[emitChange],
		);
		const handleCancelEdit = useCallback(() => setEditingIndex(null), []);

		const stepDots = useMemo(() => {
			if (!showSteps) return [];
			if (stepValues) {
				return stepValues.map((v) => ({
					value: v,
					percent: max === min ? 0 : (v - min) / (max - min),
				}));
			}
			return buildDiscreteSteps(min, max, safeStep).map((v) => ({
				value: v,
				percent: (v - min) / (max - min),
			}));
		}, [showSteps, min, max, safeStep, stepValues]);

		const isInteracting = isHovered || isPressed;
		const effectiveLabel = ariaLabelProp ?? label;

		const thumbAriaLabel = (index: number): string | undefined => {
			if (!isRange) return effectiveLabel;
			if (!effectiveLabel) return index === 0 ? "Minimum" : "Maximum";
			return index === 0 ? `${effectiveLabel} minimum` : `${effectiveLabel} maximum`;
		};

		const valueDisplay = showValue && valuePosition !== "tooltip" && (
			<ValueDisplay
				values={values}
				editingIndex={editingIndex}
				onStartEdit={handleStartEdit}
				onCommitEdit={handleCommitEdit}
				onCancelEdit={handleCancelEdit}
				min={min}
				max={max}
				step={safeStep}
				stepValues={stepValues}
				formatValue={formatValue}
				label={label}
				isRange={isRange}
				isInteracting={isInteracting}
			/>
		);

		const renderVisualThumb = (index: number) => {
			const motionX = index === 0 ? motionX0 : motionX1;
			return (
				<m.span
					key={`visual-thumb-${index}`}
					className="flex items-center justify-center pointer-events-none"
					style={{
						width: THUMB_SIZE,
						height: THUMB_SIZE,
						marginTop: -THUMB_SIZE / 2,
						x: motionX,
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
							backgroundColor: thumbColor ?? "white",
							boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
							border: thumbBorderColor ? `1px solid ${thumbBorderColor}` : undefined,
						}}
					/>
					<m.span
						className={cn(
							"absolute border border-[color:var(--focus-ring,#6B97FF)] pointer-events-none",
							sharp ? "rounded-none" : "rounded-full",
						)}
						initial={false}
						animate={{
							opacity: focusedThumb === index ? 1 : 0,
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
					valuePosition === "left" || valuePosition === "right" ? "flex-row items-center gap-2 mb-2" : "flex-col",
					disabled && "opacity-50 pointer-events-none",
					className,
				)}
				{...props}
			>
				{(valuePosition === "top" || valuePosition === "left") && valueDisplay}

				<div
					className="relative flex-1 overflow-visible"
					style={{
						height:
							valuePosition === "left" || valuePosition === "right"
								? THUMB_SIZE + 16
								: THUMB_SIZE + (valuePosition === "tooltip" ? 16 : 0),
						paddingTop: valuePosition === "tooltip" ? 16 : 0,
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
					{showValue && valuePosition === "tooltip" && (
						<AnimatePresence>
							{isInteracting && (
								<TooltipValue key="tooltip-0" value={values[0]} formatValue={formatValue} motionX={motionX0} />
							)}
							{isInteracting && isRange && values[1] !== undefined && (
								<TooltipValue key="tooltip-1" value={values[1]} formatValue={formatValue} motionX={motionX1} />
							)}
						</AnimatePresence>
					)}

					<SliderPrimitive.Root
						value={stepValues ? values.map((v) => nearestStepIndex(v, stepValues)) : values}
						onValueChange={handleRadixChange}
						min={stepValues ? 0 : min}
						max={stepValues ? stepValues.length - 1 : max}
						step={stepValues ? 1 : safeStep}
						disabled={disabled}
						className="absolute inset-0 pointer-events-none [&_*]:pointer-events-none"
					>
						<SliderPrimitive.Control className="w-full h-full">
							<SliderPrimitive.Track className="w-full h-full">
								<SliderPrimitive.Indicator />
							</SliderPrimitive.Track>
							<SliderPrimitive.Thumb
								index={0}
								aria-label={thumbAriaLabel(0)}
								getAriaValueText={() => formatValue(values[0])}
								className="block outline-none"
								style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
								onFocus={(e) => {
									if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setFocusedThumb(0);
								}}
								onBlur={() => setFocusedThumb((prev) => (prev === 0 ? null : prev))}
							/>
							{isRange && (
								<SliderPrimitive.Thumb
									index={1}
									aria-label={thumbAriaLabel(1)}
									getAriaValueText={() => formatValue(values[1])}
									className="block outline-none"
									style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
									onFocus={(e) => {
										if ((e.currentTarget as HTMLElement).matches(":focus-visible")) setFocusedThumb(1);
									}}
									onBlur={() => setFocusedThumb((prev) => (prev === 1 ? null : prev))}
								/>
							)}
						</SliderPrimitive.Control>
					</SliderPrimitive.Root>

					<div
						ref={trackRef}
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
							{hoverPreview && showHoverTooltip && !isPressed && valuePosition !== "tooltip" && (
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
								trackClassName,
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
								...trackStyle,
							}}
						>
							{!hideFill && (
								<m.div
									className={cn("absolute h-full bg-selected/50 dark:bg-accent/40", fillClassName)}
									style={{ left: fillLeft, width: fillWidth, ...fillStyle }}
								/>
							)}

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

						{stepDots.length > 0 && (
							<m.div
								className="absolute left-0 right-0 pointer-events-none"
								style={{
									top: 8 + (THUMB_SIZE - TRACK_BG_HEIGHT) / 2,
									height: TRACK_BG_HEIGHT,
									WebkitMaskImage: stepDotsMask,
									maskImage: stepDotsMask,
								}}
							>
								{stepDots.map(({ value: v, percent }) => (
									<div
										key={v}
										className="absolute pointer-events-none flex items-center justify-center"
										style={{
											left: `calc(${THUMB_SIZE / 2}px + ${percent} * (100% - ${THUMB_SIZE}px))`,
											top: "50%",
											width: 0,
											height: 0,
										}}
									>
										<m.div
											className="rounded-full flex-shrink-0 bg-muted-foreground opacity-30"
											initial={false}
											animate={{
												width: isHovered ? DOT_SIZE * 1.25 : DOT_SIZE,
												height: isHovered ? DOT_SIZE * 1.25 : DOT_SIZE,
											}}
											transition={spring.moderate}
										/>
									</div>
								))}
							</m.div>
						)}

						{renderVisualThumb(0)}
						{isRange && renderVisualThumb(1)}
					</div>
				</div>

				{(valuePosition === "bottom" || valuePosition === "right") && valueDisplay}
			</div>
		);
	},
);

CompactSlider.displayName = "SliderCompact";

interface SliderComfortableProps extends Omit<
	HTMLAttributes<HTMLDivElement>,
	"onChange" | "defaultValue" | "onDrag" | "onDragStart" | "onDragEnd" | "onDragOver" | "onAnimationStart"
> {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	variant?: "pips" | "scrubber";
	label?: string;
	formatValue?: (v: number) => string;
	disabled?: boolean;
}

const ComfortableSlider = forwardRef<HTMLDivElement, SliderComfortableProps>(
	(
		{
			value: rawValue,
			onChange,
			min: minProp = 0,
			max: maxProp = 100,
			step: stepProp = 1,
			variant = "pips",
			label,
			formatValue = String,
			disabled = false,
			className,
			"aria-label": ariaLabelProp,
			...props
		},
		ref,
	) => {
		const min = Number.isFinite(minProp) ? minProp : 0;
		const max = Number.isFinite(maxProp) && maxProp >= min ? maxProp : min;
		const step = normalizeStep(stepProp);
		const value = clampNumber(rawValue, min, max);

		const valueCh = Math.max(String(formatValue(min)).length, String(formatValue(max)).length);
		const containerRef = useRef<HTMLDivElement>(null);
		const dragging = useRef(false);
		const handleDragging = useRef(false);
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
		const zeroTarget = variant === "pips" ? 8 : 17;
		const zeroOffset = useMotionValue(value === min ? zeroTarget : 0);

		const fillWidthStyle = useTransform(fillPercent, (p) => `${p * 100}%`);
		const handleLeftStyle = useTransform(
			[fillPercent, zeroOffset] as MotionValue<number>[],
			([p, zo]) => `calc(${(p as number) * 100}% - 8px + ${zo as number}px)`,
		);
		const handleLineLeftStyle = useTransform(
			[fillPercent, zeroOffset] as MotionValue<number>[],
			([p, zo]) => `calc(${(p as number) * 100}% - 9px + ${zo as number}px)`,
		);
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
				if (variant === "pips" && pipCount >= 2) {
					const index = Math.max(0, Math.min(pipCount - 1, Math.round((clamped / w) * (pipCount - 1))));
					snappedVal = pipSteps[index];
				} else {
					const raw = min + (clamped / w) * (max - min);
					snappedVal = clampNumber(Math.round((raw - min) / step) * step + min, min, max);
				}
				const snappedPercent = max === min ? 0 : (snappedVal - min) / (max - min);
				const snappedX = snappedPercent * w;

				const currentPercent = fillPercent.get();
				let handleX: number;
				if (variant === "pips") {
					const zo = zeroOffset.get();
					handleX = currentPercent * w + (20 - 20 * currentPercent - zo * 2.5);
				} else {
					handleX = currentPercent * w;
				}

				const edgeX = snappedVal === min ? 0 : snappedVal === max ? w : snappedX;
				const left = Math.min(handleX, edgeX);
				const width = Math.abs(edgeX - handleX);
				setHoverPreview({ left, width, snappedValue: snappedVal, cursorX: snappedX });
			},
			[variant, pipSteps, pipCount, min, max, step, fillPercent, zeroOffset],
		);

		useEffect(() => {
			if (dragging.current || handleDragging.current) return;
			const percent = max === min ? 0 : clampNumber((value - min) / (max - min), 0, 1);
			animate(fillPercent, percent, spring.fast);
			animate(zeroOffset, value === min ? zeroTarget : 0, spring.fast);
		}, [value, min, max, variant, fillPercent, zeroOffset, zeroTarget]);

		const getValueFromX = useCallback(
			(clientX: number) => {
				const rect = containerRef.current?.getBoundingClientRect();
				if (!rect || rect.width <= 0) return min;
				const x = clientX - rect.left;
				const clamped = Math.max(0, Math.min(rect.width, x));
				if (variant === "pips" && pipCount >= 2) {
					const index = Math.max(0, Math.min(pipCount - 1, Math.round((clamped / rect.width) * (pipCount - 1))));
					return pipSteps[index];
				}
				const raw = min + (clamped / rect.width) * (max - min);
				const snapped = Math.round((raw - min) / step) * step + min;
				return clampNumber(snapped, min, max);
			},
			[variant, pipSteps, pipCount, min, max, step],
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
				if (variant === "scrubber") fillPercent.set(newPercent);
				else animate(fillPercent, newPercent, spring.fast);
				animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
			},
			[getValueFromX, onChange, variant, fillPercent, zeroOffset, zeroTarget, min, max],
		);

		const handlePointerUp = useCallback(() => {
			dragging.current = false;
			setIsPressed(false);
			setHoverPreview(null);
		}, []);

		const handleResizePointerDown = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (disabled) return;
				if (e.pointerType === "mouse" && e.button !== 0) return;
				e.preventDefault();
				e.stopPropagation();
				handleDragging.current = true;
				setIsPressed(true);
				const newVal = getValueFromX(e.clientX);
				onChange(newVal);
				fillPercent.set(max === min ? 0 : clampNumber((newVal - min) / (max - min), 0, 1));
				animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
				if (typeof e.currentTarget.setPointerCapture === "function") {
					e.currentTarget.setPointerCapture(e.pointerId);
				}
			},
			[disabled, getValueFromX, onChange, fillPercent, zeroOffset, zeroTarget, min, max],
		);

		const handleResizePointerMove = useCallback(
			(e: React.PointerEvent<HTMLDivElement>) => {
				if (!handleDragging.current) return;
				const newVal = getValueFromX(e.clientX);
				onChange(newVal);
				fillPercent.set(max === min ? 0 : clampNumber((newVal - min) / (max - min), 0, 1));
				animate(zeroOffset, newVal === min ? zeroTarget : 0, spring.fast);
			},
			[getValueFromX, onChange, fillPercent, zeroOffset, zeroTarget, min, max],
		);

		const handleResizePointerUp = useCallback(() => {
			handleDragging.current = false;
			setIsPressed(false);
			setHoverPreview(null);
		}, []);

		const handleRadixChange = useCallback(
			(newValues: number | readonly number[]) => {
				const next = Array.isArray(newValues) ? newValues[0] : (newValues as number);
				if (typeof next === "number") onChange(next);
			},
			[onChange],
		);

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
					if (disabled || dragging.current || handleDragging.current) return;
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
					className={cn(
						"relative w-full h-8 select-none touch-none border border-border overflow-hidden outline-offset-2",
						variant === "scrubber" ? "flex items-center gap-3 px-4 cursor-ew-resize" : "cursor-ew-resize",
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

					{variant === "pips" && pipSteps.length > 0 && (
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

					{variant === "pips" && (
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
					)}

					{variant === "pips" && (
						<m.div
							className="absolute left-0 top-0 bottom-0 pointer-events-none z-[3] bg-active"
							style={{ width: pipsFillWidthStyle }}
						/>
					)}

					{variant === "pips" && (
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
					)}

					{variant === "pips" && (
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
					)}

					{variant === "scrubber" && (
						<m.div
							className="absolute left-0 top-0 bottom-0 pointer-events-none bg-active"
							style={{ width: fillWidthStyle }}
						/>
					)}

					{variant === "scrubber" && (
						<m.div
							className="absolute rounded-full pointer-events-none z-10 w-0.5"
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
							style={{ left: handleLineLeftStyle }}
						/>
					)}

					{variant === "scrubber" && label && (
						<m.span
							className="text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] shrink-0 z-10"
							initial={false}
							animate={{ color: isActive ? "var(--foreground)" : "var(--muted-foreground)" }}
							transition={spring.fast}
						>
							{label}
						</m.span>
					)}

					{variant === "scrubber" && (
						<>
							<div className="flex-1" />
							<m.span
								className="text-[length:var(--fs-body,13px)] leading-[var(--lh-body,20px)] shrink-0 tabular-nums text-right z-10"
								initial={false}
								animate={{ color: isActive ? "var(--foreground)" : "var(--muted-foreground)" }}
								transition={spring.fast}
								style={{ minWidth: `${valueCh}ch` }}
							>
								{formatValue(value)}
							</m.span>
						</>
					)}

					{variant === "scrubber" && (
						<m.div
							className="absolute top-0 bottom-0 w-2 cursor-ew-resize z-20"
							style={{ left: handleLeftStyle }}
							onPointerDown={handleResizePointerDown}
							onPointerMove={handleResizePointerMove}
							onPointerUp={handleResizePointerUp}
							onPointerCancel={handleResizePointerUp}
						/>
					)}
				</m.div>
			</div>
		);
	},
);

ComfortableSlider.displayName = "SliderComfortable";

const COMPACT_ENGINE_PROPS = [
	"steps",
	"showSteps",
	"showValue",
	"valuePosition",
	"trackClassName",
	"trackStyle",
	"fillClassName",
	"fillStyle",
	"hideFill",
	"thumbColor",
	"thumbBorderColor",
] as const;

interface SliderProps<V extends SliderValue = SliderValue> extends SliderEngineProps<V> {
	/** Default-step layout: value pips along the track, or an edge-to-edge scrubber. */
	variant?: "pips" | "scrubber";
	/** Pins the slider to one step of the size ladder. */
	size?: SizeVariant;
}

function Slider<V extends SliderValue = number>({
	size,
	variant = "pips",
	ref,
	...props
}: SliderProps<V> & { ref?: Ref<HTMLDivElement> }) {
	const resolved = useSizeVariant(size);
	const needsCompactEngine =
		Array.isArray(props.value) || COMPACT_ENGINE_PROPS.some((key) => props[key] !== undefined);

	if (resolved === "compact" || needsCompactEngine) {
		return <CompactSlider ref={ref} {...(props as unknown as SliderEngineProps<SliderValue>)} />;
	}

	const { value, onChange, min, max, step, label, formatValue, disabled, ...rest } = props;
	const html = omit(rest, COMPACT_ENGINE_PROPS);

	return (
		<ComfortableSlider
			ref={ref}
			value={value as number}
			onChange={onChange as (v: number) => void}
			min={min}
			max={max}
			step={step}
			variant={variant}
			label={label}
			formatValue={formatValue}
			disabled={disabled}
			{...(html as Omit<SliderComfortableProps, "value" | "onChange">)}
		/>
	);
}

Slider.displayName = "Slider";

const SliderComfortable = ComfortableSlider;

export { Slider, SliderComfortable };
export type { SliderComfortableProps, SliderProps, SliderValue, ValuePosition };
