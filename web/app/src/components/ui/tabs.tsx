"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { AnimatePresence, m } from "motion/react";
import {
	createContext,
	forwardRef,
	type HTMLAttributes,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { useFluidHover } from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/fluid/font-weight";
import type { IconComponent } from "@/lib/fluid/icon-context";
import { useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/fluid/size-context";
import { spring } from "@/lib/fluid/springs";
import { cn } from "@/lib/utils";

interface TabsContextValue {
	registerTab: (index: number, element: HTMLElement | null) => void;
	hoveredIndex: number | null;
	selectedIndex: number;
	idPrefix: string | undefined;
	activeLabel: boolean;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs() {
	const ctx = useContext(TabsContext);
	if (!ctx) throw new Error("useTabs must be used within a Tabs");
	return ctx;
}

interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect" | "defaultValue" | "value"> {
	children: ReactNode;
	/** Fluid index-driven mode props. */
	selectedIndex?: number;
	onSelect?: (index: number) => void;
	idPrefix?: string;
	/** When true, only the selected tab shows its text label. Requires icons on tabs. */
	activeLabel?: boolean;
	/** Pins the tabs to one step of the size ladder (default 36px, compact 28px). */
	size?: SizeVariant;
	/** Base UI composable string/value mode props. */
	value?: TabsPrimitive.Root.Props["value"];
	defaultValue?: TabsPrimitive.Root.Props["defaultValue"];
	onValueChange?: TabsPrimitive.Root.Props["onValueChange"];
	orientation?: TabsPrimitive.Root.Props["orientation"];
}

const Tabs = forwardRef<HTMLDivElement, TabsProps>(
	(
		{
			children,
			selectedIndex,
			onSelect,
			idPrefix,
			activeLabel = false,
			size,
			value,
			defaultValue,
			onValueChange,
			orientation = "horizontal",
			className,
			...props
		},
		ref,
	) => {
		if (selectedIndex === undefined || onSelect === undefined) {
			const composableRoot = (
				<TabsPrimitive.Root
					ref={ref}
					data-slot="tabs"
					data-orientation={orientation}
					orientation={orientation}
					value={value}
					defaultValue={defaultValue}
					onValueChange={onValueChange}
					className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
					{...props}
				>
					{children}
				</TabsPrimitive.Root>
			);
			return size ? <SizeProvider size={size}>{composableRoot}</SizeProvider> : composableRoot;
		}

		return (
			<FluidIndexTabs
				ref={ref}
				selectedIndex={selectedIndex}
				onSelect={onSelect}
				idPrefix={idPrefix}
				activeLabel={activeLabel}
				size={size}
				className={className}
				{...props}
			>
				{children}
			</FluidIndexTabs>
		);
	},
);
Tabs.displayName = "Tabs";

interface FluidIndexTabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
	children: ReactNode;
	selectedIndex: number;
	onSelect: (index: number) => void;
	idPrefix?: string;
	activeLabel?: boolean;
	size?: SizeVariant;
}

const FluidIndexTabs = forwardRef<HTMLDivElement, FluidIndexTabsProps>(
	({ children, selectedIndex, onSelect, idPrefix, activeLabel = false, size, className, ...props }, ref) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const isMouseInside = useRef(false);
		const [mouseInside, setMouseInside] = useState(false);
		const shape = useShape();

		const {
			activeIndex: hoveredIndex,
			setActiveIndex: setHoveredIndex,
			itemRects: tabRects,
			handlers,
			registerItem,
			measureItems: measureTabs,
		} = useFluidHover(containerRef, { axis: "x" });

		const tabElementsRef = useRef(new Map<number, HTMLElement>());
		const registerTab = useCallback(
			(index: number, element: HTMLElement | null) => {
				registerItem(index, element);
				if (element) {
					tabElementsRef.current.set(index, element);
				} else {
					tabElementsRef.current.delete(index);
				}
			},
			[registerItem],
		);

		useEffect(() => {
			measureTabs();
		}, [measureTabs, children]);

		useEffect(() => {
			const elements = tabElementsRef.current;
			if (elements.size === 0 || typeof ResizeObserver === "undefined") return;
			const ro = new ResizeObserver(() => measureTabs());
			elements.forEach((el) => ro.observe(el));
			return () => ro.disconnect();
		}, [measureTabs, children]);

		const handleMouseMove = useCallback(
			(e: React.MouseEvent) => {
				isMouseInside.current = true;
				setMouseInside(true);
				handlers.onMouseMove(e);
			},
			[handlers],
		);

		const handleMouseLeave = useCallback(() => {
			isMouseInside.current = false;
			setMouseInside(false);
			handlers.onMouseLeave();
		}, [handlers]);

		const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

		const selectedRect = tabRects[selectedIndex];
		const hoverRect = hoveredIndex !== null ? tabRects[hoveredIndex] : null;
		const focusRect = focusedIndex !== null ? tabRects[focusedIndex] : null;
		const isHoveringSelected = hoveredIndex === selectedIndex;
		const isHovering = hoveredIndex !== null && !isHoveringSelected;

		const root = (
			<TabsContext.Provider value={{ registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel }}>
				<TabsPrimitive.Root
					value={selectedIndex}
					onValueChange={(next) => {
						if (typeof next === "number") onSelect(next);
					}}
					render={
						<TabsPrimitive.List
							activateOnFocus={false}
							ref={(node: HTMLDivElement | null) => {
								containerRef.current = node;
								if (typeof ref === "function") ref(node);
								else if (ref) ref.current = node;
							}}
							onMouseMove={handleMouseMove}
							onMouseLeave={handleMouseLeave}
							onFocus={(e: React.FocusEvent<HTMLDivElement>) => {
								const indexAttr = (e.target as HTMLElement)
									.closest("[data-fluid-hover-index]")
									?.getAttribute("data-fluid-hover-index");
								if (indexAttr != null) {
									const idx = Number(indexAttr);
									setHoveredIndex(idx);
									setFocusedIndex((e.target as HTMLElement).matches(":focus-visible") ? idx : null);
								}
							}}
							onBlur={(e: React.FocusEvent<HTMLDivElement>) => {
								if (containerRef.current?.contains(e.relatedTarget as Node)) return;
								setFocusedIndex(null);
								if (isMouseInside.current) return;
								setHoveredIndex(null);
							}}
							className={cn(
								"relative flex items-center select-none overflow-x-auto max-w-[calc(100%_+_8px)] no-scrollbar -mx-1 px-1 -my-1 py-1",
								className,
							)}
							{...props}
						>
							{selectedRect && (
								<m.div
									className={cn("absolute bg-active pointer-events-none", shape.bg)}
									initial={false}
									animate={{
										left: selectedRect.left,
										width: selectedRect.width,
										top: selectedRect.top,
										height: selectedRect.height,
										opacity: isHovering ? 0.8 : 1,
									}}
									transition={{
										...spring.moderate,
										opacity: { duration: 0.08 },
									}}
								/>
							)}

							<AnimatePresence>
								{hoverRect && !isHoveringSelected && selectedRect && (
									<m.div
										className={cn("absolute bg-active pointer-events-none", shape.bg)}
										initial={{
											left: selectedRect.left,
											width: selectedRect.width,
											top: selectedRect.top,
											height: selectedRect.height,
											opacity: 0,
										}}
										animate={{
											left: hoverRect.left,
											width: hoverRect.width,
											top: hoverRect.top,
											height: hoverRect.height,
											opacity: 0.4,
										}}
										exit={
											!mouseInside && selectedRect
												? {
														left: selectedRect.left,
														width: selectedRect.width,
														top: selectedRect.top,
														height: selectedRect.height,
														opacity: 0,
														transition: { ...spring.moderate, opacity: { duration: 0.06 } },
													}
												: { opacity: 0, transition: spring.fast.exit }
										}
										transition={{
											...spring.fast,
											opacity: { duration: 0.08 },
										}}
									/>
								)}
							</AnimatePresence>

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
						</TabsPrimitive.List>
					}
				/>
			</TabsContext.Provider>
		);

		return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
	},
);
FluidIndexTabs.displayName = "FluidIndexTabs";

interface TabsItemProps extends HTMLAttributes<HTMLButtonElement> {
	icon?: IconComponent;
	label: string;
	index: number;
}

const TabsItem = forwardRef<HTMLButtonElement, TabsItemProps>(
	({ icon: Icon, label, index, className, ...props }, ref) => {
		const internalRef = useRef<HTMLButtonElement | null>(null);
		const [labelWidth, setLabelWidth] = useState<number | null>(null);
		const labelRoRef = useRef<ResizeObserver | null>(null);
		const measureLabel = useCallback((el: HTMLSpanElement | null) => {
			labelRoRef.current?.disconnect();
			labelRoRef.current = null;
			if (!el) return;
			const update = () => setLabelWidth(el.offsetWidth);
			update();
			if (typeof ResizeObserver !== "undefined") {
				labelRoRef.current = new ResizeObserver(update);
				labelRoRef.current.observe(el);
			}
		}, []);
		const shape = useShape();
		const sizeClasses = useSize();
		const { registerTab, hoveredIndex, selectedIndex, idPrefix, activeLabel } = useTabs();

		useEffect(() => {
			registerTab(index, internalRef.current);
			return () => registerTab(index, null);
		}, [index, registerTab]);

		const isSelected = selectedIndex === index;
		const isActive = hoveredIndex === index || isSelected;
		const collapseLabel = activeLabel && Boolean(Icon);
		const showLabel = !collapseLabel || isSelected;

		const labelContent = (
			<span ref={measureLabel} className={cn("inline-grid whitespace-nowrap", sizeClasses.text)}>
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
						isActive ? "text-foreground" : "text-muted-foreground",
					)}
					style={{
						fontVariationSettings: isSelected ? fontWeights.semibold : fontWeights.normal,
					}}
				>
					{label}
				</span>
			</span>
		);

		return (
			<TabsPrimitive.Tab
				ref={(node: HTMLElement | null) => {
					const button = node as HTMLButtonElement | null;
					internalRef.current = button;
					if (typeof ref === "function") ref(button);
					else if (ref) ref.current = button;
				}}
				value={index}
				data-fluid-hover-index={index}
				id={idPrefix ? `${idPrefix}-tab-${index}` : undefined}
				aria-controls={idPrefix ? `${idPrefix}-panel-${index}` : undefined}
				aria-label={collapseLabel && !showLabel ? label : undefined}
				className={cn(
					"relative z-10 flex items-center cursor-pointer bg-transparent border-none outline-none",
					sizeClasses.control,
					sizeClasses.px,
					!collapseLabel && sizeClasses.gap,
					shape.bg,
					className,
				)}
				{...props}
			>
				{Icon && (
					<Icon
						size={sizeClasses.icon}
						strokeWidth={isActive ? 2 : 1.5}
						className={cn(
							"shrink-0 transition-[color,stroke-width] duration-80",
							isActive ? "text-foreground" : "text-muted-foreground",
						)}
					/>
				)}
				{collapseLabel ? (
					<AnimatePresence initial={false}>
						{showLabel && (
							<m.span
								key="label"
								className="overflow-hidden"
								style={labelWidth == null ? { width: "auto" } : undefined}
								initial={{ width: 0, opacity: 0, marginLeft: 0 }}
								animate={{
									...(labelWidth != null ? { width: labelWidth } : null),
									opacity: 1,
									marginLeft: sizeClasses.variant === "compact" ? 6 : 8,
								}}
								exit={{ width: 0, opacity: 0, marginLeft: 0 }}
								transition={{
									...spring.fast,
									opacity: { duration: 0.06 },
								}}
							>
								{labelContent}
							</m.span>
						)}
					</AnimatePresence>
				) : (
					labelContent
				)}
			</TabsPrimitive.Tab>
		);
	},
);
TabsItem.displayName = "TabsItem";

interface TabsPanelProps extends HTMLAttributes<HTMLDivElement> {
	index: number;
	selectedIndex: number;
	idPrefix: string;
	children: ReactNode;
}

const TabsPanel = forwardRef<HTMLDivElement, TabsPanelProps>(
	({ index, selectedIndex, idPrefix, children, className, ...props }, ref) => {
		const isSelected = selectedIndex === index;
		return (
			<div
				ref={ref}
				id={`${idPrefix}-panel-${index}`}
				role="tabpanel"
				aria-labelledby={`${idPrefix}-tab-${index}`}
				hidden={!isSelected}
				tabIndex={-1}
				className={cn("outline-none", className)}
				{...props}
			>
				{isSelected && children}
			</div>
		);
	},
);
TabsPanel.displayName = "TabsPanel";

const tabsListVariants = cva(
	"group/tabs-list inline-flex w-fit items-center justify-center text-muted-foreground group-data-[orientation=horizontal]/tabs:h-8 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
	{
		variants: {
			variant: {
				default: "bg-muted/70 p-0.5",
				line: "gap-1 bg-transparent p-0",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

function TabsList({
	className,
	variant = "default",
	...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
	const shape = useShape();
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			data-variant={variant}
			className={cn(shape.bg, tabsListVariants({ variant }), className)}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
	const shape = useShape();
	const sizeClasses = useSize();
	return (
		<TabsPrimitive.Tab
			data-slot="tabs-trigger"
			className={cn(
				"relative inline-flex flex-1 items-center justify-center whitespace-nowrap border border-transparent font-medium text-muted-foreground transition-colors duration-80 outline-none select-none cursor-pointer",
				"hover:text-foreground hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
				"disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
				"group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start",
				"group-data-[variant=default]/tabs-list:data-active:bg-active group-data-[variant=default]/tabs-list:data-active:text-foreground",
				"group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-active group-data-[variant=line]/tabs-list:data-active:text-foreground",
				"after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-4px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				shape.item,
				sizeClasses.segmentItem,
				sizeClasses.itemPx,
				sizeClasses.gap,
				sizeClasses.text,
				className,
			)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			data-slot="tabs-content"
			className={cn("flex-1 text-sm outline-none", className)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsItem, TabsList, TabsPanel, TabsTrigger };
export default Tabs;
