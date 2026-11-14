"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, m } from "motion/react";
import {
	Children,
	type ComponentType,
	createContext,
	forwardRef,
	type HTMLAttributes,
	isValidElement,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	useFluidHover,
	useFluidHoverSelect,
	useRegisterFluidHoverItem,
	type FluidHoverActiveStore,
} from "@/hooks/use-fluid-hover";
import { useKeyboardNavGate } from "@/hooks/use-keyboard-nav-gate";
import { Elevated } from "@/lib/fluid/elevated";
import { isDisabledRow, popupMotionClass, popupScrollAreaClass, popupViewportClass } from "@/lib/fluid/popup";
import { usePopupShape, useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, type SizeVariant, typeClass, useSize } from "@/lib/fluid/size-context";
import { exitFallbackMs, spring } from "@/lib/fluid/springs";
import { cn } from "@/lib/utils";

const selectionAckMs = 300;

type SelectIcon = ComponentType<{ className?: string }>;

type SelectOption = {
	disabled?: boolean;
	icon?: SelectIcon;
	label: string;
	value: string;
};

interface SelectContextValue {
	value: string | null;
	open: boolean;
	actionsRef: React.RefObject<{ unmount: () => void; close: () => void } | null>;
}

const SelectContext = createContext<SelectContextValue | null>(null);

function useSelectContext() {
	const ctx = useContext(SelectContext);
	if (!ctx) throw new Error("Select compound components must be inside <Select>");
	return ctx;
}

interface SelectContentContextValue {
	registerItem: (index: number, element: HTMLElement | null) => void;
	activeStore: FluidHoverActiveStore;
	checkedIndex?: number;
}

const SelectContentContext = createContext<SelectContentContextValue | null>(null);

interface SelectProps extends Pick<HTMLAttributes<HTMLButtonElement>, "aria-label" | "className"> {
	children?: ReactNode;
	/** Shorthand option list rendered as SelectTrigger + SelectContent. */
	options?: Array<SelectOption>;
	value?: string | null;
	defaultValue?: string | null;
	onValueChange?: (value: string) => void;
	placeholder?: string;
	triggerId?: string;
	disabled?: boolean;
	name?: string;
	required?: boolean;
	/** Pins trigger and popup to one step of the size ladder (default 36px, compact 28px). */
	size?: SizeVariant;
}

function collectSelectItems(node: ReactNode, out: { value: string; label: ReactNode }[] = []) {
	Children.forEach(node, (child) => {
		if (!isValidElement(child)) return;
		const props = child.props as { value?: unknown; children?: ReactNode };
		if (typeof props.value === "string") {
			out.push({
				value: props.value,
				label: typeof props.children === "string" ? props.children : props.value,
			});
		} else if (props.children) {
			collectSelectItems(props.children, out);
		}
	});
	return out;
}

function Select({
	children,
	options,
	value,
	defaultValue,
	onValueChange,
	placeholder = "Select…",
	triggerId,
	"aria-label": ariaLabel,
	className,
	disabled = false,
	name,
	required,
	size,
}: SelectProps) {
	const [internalValue, setInternalValue] = useState<string | null>(defaultValue ?? null);
	const [open, setOpen] = useState(false);
	const actionsRef = useRef<{ unmount: () => void; close: () => void } | null>(null);
	const currentValue = value !== undefined ? value : internalValue;

	const items = useMemo(
		() => (options ? options.map((opt) => ({ value: opt.value, label: opt.label })) : collectSelectItems(children)),
		[options, children],
	);

	const handleValueChange = useCallback(
		(next: string | null) => {
			if (value === undefined) setInternalValue(next);
			if (next !== null) onValueChange?.(next);
		},
		[value, onValueChange],
	);

	const ackTimeoutRef = useRef<number | null>(null);
	const cancelAckClose = useCallback(() => {
		if (ackTimeoutRef.current !== null) {
			clearTimeout(ackTimeoutRef.current);
			ackTimeoutRef.current = null;
		}
	}, []);
	useEffect(() => cancelAckClose, [cancelAckClose]);

	const handleOpenChange = useCallback(
		(nextOpen: boolean, eventDetails: SelectPrimitive.Root.ChangeEventDetails) => {
			if (!nextOpen && eventDetails.reason === "item-press") {
				cancelAckClose();
				ackTimeoutRef.current = window.setTimeout(() => {
					ackTimeoutRef.current = null;
					setOpen(false);
				}, selectionAckMs);
				return;
			}
			cancelAckClose();
			setOpen(nextOpen);
		},
		[cancelAckClose],
	);

	const ctx = useMemo(() => ({ value: currentValue, open, actionsRef }), [currentValue, open]);
	const selectedOption = options?.find((option) => option.value === currentValue);

	const root = (
		<SelectContext.Provider value={ctx}>
			<SelectPrimitive.Root
				data-slot="select"
				value={currentValue === "" ? null : currentValue}
				onValueChange={handleValueChange}
				open={open}
				onOpenChange={handleOpenChange}
				actionsRef={actionsRef}
				items={items}
				disabled={disabled}
				name={name}
				required={required}
				modal={false}
			>
				{options ? (
					<>
						<SelectTrigger
							id={triggerId}
							aria-label={ariaLabel}
							icon={selectedOption?.icon}
							placeholder={placeholder}
							className={className}
						/>
						<SelectContent>
							{options.map((option, index) => (
								<SelectItem
									key={option.value}
									value={option.value}
									index={index}
									disabled={option.disabled}
									icon={option.icon}
								>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</>
				) : (
					children
				)}
			</SelectPrimitive.Root>
		</SelectContext.Provider>
	);

	return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
}

Select.displayName = "Select";

const triggerVariants = cva(
	[
		"group inline-flex items-center justify-between outline-none cursor-pointer",
		"transition-[color,background-color,border-radius,box-shadow,opacity] duration-80",
		"disabled:opacity-50 disabled:pointer-events-none",
		"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
	],
	{
		variants: {
			variant: {
				bordered: "border border-border bg-transparent text-foreground hover:bg-hover",
				borderless: "border border-transparent bg-transparent text-foreground hover:bg-hover",
			},
		},
		defaultVariants: {
			variant: "bordered",
		},
	},
);

interface SelectTriggerProps
	extends Omit<HTMLAttributes<HTMLButtonElement>, "children">, VariantProps<typeof triggerVariants> {
	icon?: SelectIcon;
	placeholder?: string;
	error?: string;
	/** Size override for the trigger alone. */
	size?: SizeVariant;
}

const SelectTrigger = forwardRef<HTMLButtonElement, SelectTriggerProps>(
	({ className, variant, icon: Icon, placeholder = "Select…", error, size, ...props }, ref) => {
		const shape = useShape();
		const sizeClasses = useSize(size);
		const compact = sizeClasses.variant === "compact";

		const trigger = (
			<SelectPrimitive.Trigger
				ref={ref}
				data-slot="select-trigger"
				aria-invalid={Boolean(error) || undefined}
				className={cn(
					triggerVariants({ variant }),
					sizeClasses.control,
					sizeClasses.text,
					sizeClasses.px,
					sizeClasses.gap,
					compact ? "min-w-[128px]" : "min-w-[160px]",
					shape.input,
					error && "border-destructive/50 hover:border-destructive/50",
					className,
				)}
				{...props}
			>
				<span className={cn("flex items-center min-w-0 flex-1", sizeClasses.gap)}>
					{Icon && (
						<Icon
							className={cn(
								compact ? "size-3.5" : "size-4",
								"shrink-0 text-muted-foreground transition-colors duration-80 group-hover:text-foreground",
							)}
						/>
					)}
					<SelectPrimitive.Value
						placeholder={placeholder}
						className="min-w-0 flex-1 text-left truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1 data-[placeholder]:text-muted-foreground"
					/>
				</span>

				<svg
					width={sizeClasses.icon}
					height={sizeClasses.icon}
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
					className="shrink-0 text-muted-foreground transition-colors duration-80 group-hover:text-foreground"
				>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</SelectPrimitive.Trigger>
		);

		if (!error) return trigger;

		return (
			<div className="flex flex-col gap-1">
				{trigger}
				<span className="text-[length:var(--fs-caption,12px)] leading-[var(--lh-caption,16px)] text-destructive pl-3">
					{error}
				</span>
			</div>
		);
	},
);

SelectTrigger.displayName = "SelectTrigger";

interface SelectContentProps {
	className?: string;
	children: ReactNode;
}

const SelectContent = forwardRef<HTMLDivElement, SelectContentProps>(({ className, children }, ref) => {
	const { open, value, actionsRef } = useSelectContext();
	const shape = usePopupShape();
	const containerRef = useRef<HTMLDivElement>(null);

	const hover = useFluidHover(containerRef, { isItemDisabled: isDisabledRow });
	const { activeStore, setActiveIndex, itemRects, isMeasured, handlers, registerItem, remeasure } = hover;

	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const { keyboardNavRef, trackKeyboardNav } = useKeyboardNavGate(open);
	const [checkedIndex, setCheckedIndex] = useState<number | undefined>(undefined);

	useEffect(() => {
		if (open) return;
		const id = setTimeout(() => actionsRef.current?.unmount(), exitFallbackMs(spring.fast));
		return () => clearTimeout(id);
	}, [open, actionsRef]);

	useEffect(() => {
		if (!open) return;
		remeasure();
	}, [open, remeasure]);

	useEffect(() => {
		if (!open) return;
		let inner: number;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				const container = containerRef.current;
				if (container) {
					const items = Array.from(container.querySelectorAll("[data-fluid-hover-index]")) as HTMLElement[];
					const idx = items.findIndex((el) => el.getAttribute("data-value") === value);
					setCheckedIndex(idx !== -1 ? idx : undefined);
				}
			});
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [open, value]);

	const [overlaysOpen, setOverlaysOpen] = useState(open);
	if (overlaysOpen !== open) {
		setOverlaysOpen(open);
		if (!open) {
			setCheckedIndex(undefined);
			setActiveIndex(null);
			setFocusedIndex(null);
		}
	}

	const checkedRect = isMeasured && checkedIndex != null ? itemRects[checkedIndex] : null;
	const focusRect = isMeasured && focusedIndex !== null ? itemRects[focusedIndex] : null;

	const contentCtx = useMemo(
		() => ({ registerItem, activeStore, checkedIndex }),
		[registerItem, activeStore, checkedIndex],
	);

	return (
		<SelectPrimitive.Portal>
			{/* Above Dialog (z-50) / AlertDialog (z-60) so pickers work inside Settings */}
			<SelectPrimitive.Positioner
				side="bottom"
				align="start"
				sideOffset={6}
				alignItemWithTrigger={false}
				className="z-[70] outline-none"
			>
				<m.div
					className={popupMotionClass}
					initial={{ opacity: 0, y: "var(--popup-enter-y)", scaleY: 0.96 }}
					animate={
						open ? { opacity: 1, y: 0, scaleY: 1 } : { opacity: 0, y: "var(--popup-enter-y)", scaleY: 0.96 }
					}
					transition={open ? spring.fast : spring.fast.exit}
					onAnimationComplete={() => {
						if (!open) actionsRef.current?.unmount();
					}}
				>
					<SelectContentContext.Provider value={contentCtx}>
						<SelectPrimitive.Popup
							data-slot="select-content"
							render={<Elevated offset={2} shadowLevel={3} ref={ref} />}
							onKeyDownCapture={trackKeyboardNav}
							onMouseEnter={() => {
								handlers.onMouseEnter();
								setFocusedIndex(null);
							}}
							onMouseMove={handlers.onMouseMove}
							onMouseLeave={handlers.onMouseLeave}
							onClick={handlers.onClick}
							onFocus={(e) => {
								const indexAttr = (e.target as HTMLElement)
									.closest("[data-fluid-hover-index]")
									?.getAttribute("data-fluid-hover-index");
								if (indexAttr != null) {
									const idx = Number(indexAttr);
									setActiveIndex(idx);
									setFocusedIndex(
										keyboardNavRef.current && (e.target as HTMLElement).matches(":focus-visible")
											? idx
											: null,
									);
								}
							}}
							onBlur={(e) => {
								if (e.currentTarget.contains(e.relatedTarget as Node)) return;
								setFocusedIndex(null);
								setActiveIndex(null);
							}}
							className={cn(
								"flex flex-col min-w-[var(--anchor-width)] max-h-[min(300px,var(--available-height))] overflow-hidden select-none outline-none",
								shape.container,
								className,
							)}
						>
							<ScrollArea
								className={popupScrollAreaClass}
								viewportClassName={cn(popupViewportClass, "scroll-fade")}
							>
								<div ref={containerRef} className="relative flex flex-col p-1">
									{open && (
										<AnimatePresence>
											{checkedRect && (
												<m.div
													className={cn("absolute bg-active pointer-events-none", shape.bg)}
													initial={false}
													animate={{
														top: checkedRect.top,
														left: checkedRect.left,
														width: checkedRect.width,
														height: checkedRect.height,
														opacity: 1,
													}}
													exit={{ opacity: 0, transition: spring.moderate.exit }}
													transition={{
														...spring.moderate,
														opacity: { duration: 0.08 },
													}}
												/>
											)}
										</AnimatePresence>
									)}

									<FluidHoverHighlight hover={hover} hidden={!open} className={shape.bg} />

									{open && (
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
									)}

									{children}
								</div>
							</ScrollArea>
						</SelectPrimitive.Popup>
					</SelectContentContext.Provider>
				</m.div>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
});

SelectContent.displayName = "SelectContent";

interface SelectItemProps extends HTMLAttributes<HTMLDivElement> {
	value: string;
	index: number;
	icon?: SelectIcon;
	disabled?: boolean;
	children: ReactNode;
}

const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
	({ className, children, icon: Icon, value, index, disabled = false, ...props }, ref) => {
		const selectCtx = useSelectContext();
		const contentCtx = useContext(SelectContentContext);
		const internalRef = useRef<HTMLDivElement>(null);
		const shape = usePopupShape();
		const sizeClasses = useSize();
		const compact = sizeClasses.variant === "compact";

		const registerItem = contentCtx?.registerItem;
		useRegisterFluidHoverItem(registerItem, index, internalRef);

		const isActive = useFluidHoverSelect(contentCtx?.activeStore, (i) => i === index);
		const isChecked = selectCtx.value === value;

		return (
			<SelectPrimitive.Item
				value={value}
				disabled={disabled}
				label={typeof children === "string" ? children : undefined}
				render={
					<div
						ref={(node: HTMLDivElement | null) => {
							internalRef.current = node;
							if (typeof ref === "function") ref(node);
							else if (ref) ref.current = node;
						}}
						data-slot="select-item"
						data-fluid-hover-index={index}
						data-value={value}
						className={cn(
							"relative z-10 flex shrink-0 items-center cursor-pointer outline-none select-none transition-[color] duration-80",
							sizeClasses.control,
							sizeClasses.gap,
							shape.item,
							sizeClasses.itemPx,
							sizeClasses.text,
							isActive || isChecked ? "text-foreground" : "text-muted-foreground",
							disabled && "opacity-50 pointer-events-none",
							className,
						)}
						{...props}
					/>
				}
			>
				{Icon && <Icon className={cn(compact ? "size-3.5" : "size-4", "shrink-0 transition-colors duration-80")} />}

				<SelectPrimitive.ItemText
					render={<span className="flex-1 min-w-0 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1" />}
				>
					{children}
				</SelectPrimitive.ItemText>

				<span aria-hidden className={cn("shrink-0", compact ? "w-3.5 h-3.5" : "w-4 h-4")}>
					<AnimatePresence initial={false}>
						{isChecked && (
							<m.svg
								key="check"
								width={sizeClasses.icon}
								height={sizeClasses.icon}
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
								className="text-foreground"
								initial={{ opacity: 1 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 1 }}
							>
								<m.path
									d="M4 12L9 17L20 6"
									initial={{ pathLength: 0 }}
									animate={{
										pathLength: 1,
										transition: { duration: 0.08, ease: "easeOut" },
									}}
									exit={{
										pathLength: 0,
										transition: { duration: 0.04, ease: "easeIn" },
									}}
								/>
							</m.svg>
						)}
					</AnimatePresence>
				</span>
			</SelectPrimitive.Item>
		);
	},
);

SelectItem.displayName = "SelectItem";

function SelectGroup({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div role="group" data-slot="select-group" className={className} {...props}>
			{children}
		</div>
	);
}

SelectGroup.displayName = "SelectGroup";

const SelectLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => {
	const compact = useSize().variant === "compact";
	return (
		<div
			ref={ref}
			data-slot="select-label"
			className={cn(
				"px-2 py-1.5 shrink-0 text-muted-foreground",
				typeClass("caption", compact ? "compact" : "default"),
				className,
			)}
			{...props}
		/>
	);
});

SelectLabel.displayName = "SelectLabel";

const SelectSeparator = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		data-slot="select-separator"
		role="separator"
		className={cn("my-1 -mx-1 h-px shrink-0 bg-border/60", className)}
		{...props}
	/>
));

SelectSeparator.displayName = "SelectSeparator";

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, triggerVariants };
export type { SelectContentProps, SelectItemProps, SelectOption, SelectProps, SelectTriggerProps };
