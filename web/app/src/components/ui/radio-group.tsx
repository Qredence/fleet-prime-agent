"use client";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { AnimatePresence, m } from "motion/react";
import {
	Children,
	createContext,
	forwardRef,
	type HTMLAttributes,
	isValidElement,
	type ReactNode,
	useContext,
	useRef,
	useState,
} from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { useFluidHover, useRegisterFluidHoverItem } from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/fluid/size-context";
import { spring } from "@/lib/fluid/springs";
import { cn } from "@/lib/utils";

let pointerFocusRedirect = false;

interface RadioGroupContextValue {
	registerItem: (index: number, element: HTMLElement | null) => void;
	activeIndex: number | null;
	selectedIndex: number | null;
	selectedValue?: string | null;
	onValueChange?: (value: string) => void;
	hasSelection: boolean;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

function useRadioGroupContext() {
	const ctx = useContext(RadioGroupContext);
	if (!ctx) throw new Error("useRadioGroup must be used within a RadioGroup");
	return ctx;
}

interface RadioGroupProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect" | "defaultValue"> {
	children: ReactNode;
	selectedIndex?: number;
	value?: string | null;
	defaultValue?: string | null;
	onValueChange?: (value: string) => void;
	/** Pins the group's rows to one step of the size ladder (default 36px, compact 28px). */
	size?: SizeVariant;
}

const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
	(
		{
			children,
			selectedIndex,
			value,
			defaultValue,
			onValueChange,
			size,
			className,
			onMouseEnter,
			onMouseMove,
			onMouseLeave,
			onClick,
			onFocus,
			onBlur,
			onKeyDown,
			...props
		},
		ref,
	) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const childValues = Children.toArray(children)
			.filter(isValidElement)
			.map((child) => (child.props as { value?: string }).value);
		const hover = useFluidHover(containerRef);
		const { activeIndex, setActiveIndex, itemRects, handlers, registerItem } = hover;

		const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
		const resolvedSelectedIndex =
			value !== undefined ? childValues.findIndex((childValue) => childValue === value) : (selectedIndex ?? -1);
		const hasSelection =
			resolvedSelectedIndex >= 0 ||
			Children.toArray(children)
				.filter(isValidElement)
				.some((child) => (child.props as { selected?: boolean }).selected === true);

		const focusRect = focusedIndex !== null ? itemRects[focusedIndex] : null;
		const selectedRect = resolvedSelectedIndex >= 0 ? itemRects[resolvedSelectedIndex] : null;
		const shape = useShape();

		const content = (
			<div
				ref={(node) => {
					containerRef.current = node;
					if (typeof ref === "function") ref(node);
					else if (ref) ref.current = node;
				}}
				data-slot="radio-group"
				onMouseEnter={(e) => {
					handlers.onMouseEnter();
					onMouseEnter?.(e);
				}}
				onMouseMove={(e) => {
					handlers.onMouseMove(e);
					onMouseMove?.(e);
				}}
				onMouseLeave={(e) => {
					handlers.onMouseLeave();
					onMouseLeave?.(e);
				}}
				onClick={(e) => {
					handlers.onClick(e);
					onClick?.(e);
				}}
				onFocus={(e) => {
					const indexAttr = (e.target as HTMLElement)
						.closest("[data-fluid-hover-index]")
						?.getAttribute("data-fluid-hover-index");
					if (indexAttr != null) {
						const idx = Number(indexAttr);
						setActiveIndex(idx);
						setFocusedIndex(
							!pointerFocusRedirect && (e.target as HTMLElement).matches(":focus-visible") ? idx : null,
						);
					}
					onFocus?.(e);
				}}
				onBlur={(e) => {
					if (!containerRef.current?.contains(e.relatedTarget as Node)) {
						setFocusedIndex(null);
						setActiveIndex(null);
					}
					onBlur?.(e);
				}}
				onKeyDown={(e) => {
					onKeyDown?.(e);
					const items = Array.from(
						containerRef.current?.querySelectorAll("[data-fluid-hover-index]") ?? [],
					) as HTMLElement[];
					const currentIdx = items.indexOf(e.target as HTMLElement);
					if (currentIdx === -1) return;

					const preventBaseUI = (e as unknown as { preventBaseUIHandler?: () => void }).preventBaseUIHandler;

					if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(e.key)) {
						e.preventDefault();
						preventBaseUI?.();
						const next = ["ArrowDown", "ArrowRight"].includes(e.key)
							? (currentIdx + 1) % items.length
							: (currentIdx - 1 + items.length) % items.length;
						items[next].focus();
						items[next].click();
					} else if (e.key === "Home") {
						e.preventDefault();
						preventBaseUI?.();
						items[0]?.focus();
						items[0]?.click();
					} else if (e.key === "End") {
						e.preventDefault();
						preventBaseUI?.();
						items[items.length - 1]?.focus();
						items[items.length - 1]?.click();
					}
				}}
				role="radiogroup"
				className={cn("relative flex flex-col w-72 max-w-full select-none", className)}
				{...props}
			>
				{selectedRect && (
					<m.div
						className={cn("absolute bg-active pointer-events-none", shape.bg)}
						initial={false}
						animate={{
							top: selectedRect.top,
							left: selectedRect.left,
							width: selectedRect.width,
							height: selectedRect.height,
							opacity: 1,
						}}
						transition={{
							...spring.moderate,
							opacity: { duration: 0.08 },
						}}
					/>
				)}

				<FluidHoverHighlight hover={hover} className={shape.bg} />

				<AnimatePresence>
					{focusRect && (
						<m.div
							className={cn(
								"absolute pointer-events-none z-20 border border-[color:var(--focus-ring,#6B97FF)]",
								shape.focusRing,
							)}
							initial={false}
							animate={{
								left: focusRect.left - 2,
								top: focusRect.top - 2,
								width: focusRect.width + 4,
								height: focusRect.height + 4,
							}}
							exit={{ opacity: 0, transition: spring.fast.exit }}
							transition={{
								...spring.fast,
								opacity: { duration: 0.08 },
							}}
						/>
					)}
				</AnimatePresence>

				{children}
			</div>
		);

		const withSize = (node: ReactNode) => (size ? <SizeProvider size={size}>{node}</SizeProvider> : node);

		if (value !== undefined || defaultValue !== undefined) {
			return withSize(
				<RadioGroupContext.Provider
					value={{
						registerItem,
						activeIndex,
						selectedIndex: resolvedSelectedIndex >= 0 ? resolvedSelectedIndex : null,
						selectedValue: value,
						onValueChange,
						hasSelection,
					}}
				>
					<RadioGroupPrimitive
						value={value}
						defaultValue={defaultValue}
						onValueChange={(next) => onValueChange?.(next as string)}
						render={content}
					/>
				</RadioGroupContext.Provider>,
			);
		}

		return withSize(
			<RadioGroupContext.Provider
				value={{
					registerItem,
					activeIndex,
					selectedIndex: selectedIndex ?? null,
					hasSelection,
				}}
			>
				{content}
			</RadioGroupContext.Provider>,
		);
	},
);

RadioGroup.displayName = "RadioGroup";

interface RadioItemProps extends HTMLAttributes<HTMLDivElement> {
	label: string;
	index: number;
	selected?: boolean;
	onSelect?: () => void;
	value?: string;
}

const RadioItem = forwardRef<HTMLDivElement, RadioItemProps>(
	({ label, index, selected, onSelect, value, className, ...props }, ref) => {
		const internalRef = useRef<HTMLDivElement>(null);
		const { registerItem, activeIndex, selectedIndex, selectedValue, onValueChange, hasSelection } =
			useRadioGroupContext();

		useRegisterFluidHoverItem(registerItem, index, internalRef);

		const isActive = activeIndex === index;
		const shape = useShape();
		const sizeClasses = useSize();
		const compact = sizeClasses.variant === "compact";
		const isSelected =
			value !== undefined && selectedValue !== undefined
				? selectedValue === value
				: (selected ?? selectedIndex === index);

		const handleSelect = () => {
			if (value !== undefined) {
				onValueChange?.(value);
			}
			onSelect?.();
		};

		return (
			<div
				ref={(node) => {
					internalRef.current = node;
					if (typeof ref === "function") ref(node);
					else if (ref) ref.current = node;
				}}
				data-fluid-hover-index={index}
				tabIndex={isSelected ? 0 : !hasSelection && index === 0 ? 0 : -1}
				role="radio"
				aria-checked={isSelected}
				aria-label={label}
				onClick={handleSelect}
				onMouseDown={(e) => {
					const interactive = (e.target as HTMLElement).closest(
						'button:not([tabindex="-1"]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
					);
					if (interactive && interactive !== e.currentTarget) return;
					e.preventDefault();
					pointerFocusRedirect = true;
					try {
						e.currentTarget.focus();
					} finally {
						pointerFocusRedirect = false;
					}
				}}
				onKeyDown={(e) => {
					if (e.key === " " || e.key === "Enter") {
						e.preventDefault();
						handleSelect();
					}
				}}
				className={cn(
					"relative z-10 flex items-center cursor-pointer outline-none",
					compact ? "min-h-7 py-2" : "min-h-9 py-3",
					sizeClasses.gap,
					shape.item,
					sizeClasses.px,
					className,
				)}
				{...props}
			>
				<div className={cn("relative shrink-0", compact ? "w-[14px] h-[14px]" : "w-[16px] h-[16px]")}>
					<div
						className={cn(
							"absolute inset-0 rounded-full border-solid transition-[border-color] duration-80",
							isSelected
								? "border-[1.5px] border-transparent"
								: isActive
									? "border-[1.5px] border-neutral-400 dark:border-neutral-500"
									: "border-[1.5px] border-border",
						)}
					/>
					<AnimatePresence initial={false}>
						{isSelected && (
							<m.div
								className="absolute inset-0 flex items-center justify-center"
								initial={{ opacity: 0, scale: 0.3 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.3, transition: { duration: 0.04 } }}
								transition={spring.fast}
							>
								<div
									className={cn("rounded-full bg-foreground", compact ? "w-[7px] h-[7px]" : "w-[8px] h-[8px]")}
								/>
							</m.div>
						)}
					</AnimatePresence>
				</div>

				<span className={cn("inline-grid min-w-0 [overflow-wrap:anywhere]", sizeClasses.text)}>
					<span
						className="col-start-1 row-start-1 invisible [text-box:trim-both_cap_alphabetic]"
						style={{ fontVariationSettings: fontWeights.semibold }}
						aria-hidden="true"
					>
						{label}
					</span>
					<span
						className={cn(
							"col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80 [text-box:trim-both_cap_alphabetic]",
							isSelected || isActive ? "text-foreground" : "text-muted-foreground",
						)}
						style={{
							fontVariationSettings: isSelected ? fontWeights.semibold : fontWeights.normal,
						}}
					>
						{label}
					</span>
				</span>

				{value !== undefined && <RadioPrimitive.Root value={value} className="sr-only" tabIndex={-1} aria-hidden />}
			</div>
		);
	},
);

RadioItem.displayName = "RadioItem";

/** Base UI Radio slot compatibility wrapper for custom item layouts (such as composer menus). */
function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
	const shape = useShape();
	const sizeClasses = useSize();
	return (
		<RadioPrimitive.Root
			data-slot="radio-group-item"
			className={cn(
				"group/radio relative flex w-full cursor-pointer items-start text-left outline-none select-none transition-colors duration-80",
				"hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
				"data-[checked]:bg-active data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
				shape.item,
				sizeClasses.itemPx,
				sizeClasses.gap,
				"py-1.5 text-xs",
				className,
			)}
			{...props}
		/>
	);
}

function RadioIndicator({ className, ...props }: RadioPrimitive.Indicator.Props) {
	return (
		<RadioPrimitive.Indicator
			data-slot="radio-group-indicator"
			className={cn("ml-auto flex shrink-0 items-center justify-center text-foreground", className)}
			{...props}
		/>
	);
}

export { Radio, RadioGroup, RadioIndicator, RadioItem };
export default RadioGroup;
