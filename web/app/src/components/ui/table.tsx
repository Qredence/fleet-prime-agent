"use client";

import {
	createContext,
	type CSSProperties,
	forwardRef,
	type HTMLAttributes,
	type ReactNode,
	type TdHTMLAttributes,
	type ThHTMLAttributes,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { FluidHoverHighlight } from "@/components/ui/fluid-hover-highlight";
import {
	type FluidHoverActiveStore,
	useFluidHover,
	useFluidHoverSelect,
	useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { SelectionBackgrounds, useMergeSplitBlocks, useSelectionRuns } from "@/hooks/use-merge-split";
import { fontWeights } from "@/lib/fluid/font-weight";
import { useShape } from "@/lib/fluid/shape-context";
import { SizeProvider, type SizeVariant, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

interface TableContextValue {
	registerItem: (index: number, element: HTMLElement | null) => void;
	activeStore: FluidHoverActiveStore;
	selected: ReadonlySet<number>;
	registerHead: (index: number, element: HTMLElement | null) => void;
}

const TableContext = createContext<TableContextValue | null>(null);

interface TableProps extends HTMLAttributes<HTMLTableElement> {
	children: ReactNode;
	/** Pins the table's rows to one step of the size ladder. */
	size?: SizeVariant;
	/** Selected body rows, by `index`. */
	selectedIndices?: readonly number[];
	/** Reordering snap key so selection/hover jump with reordered rows. */
	snapKey?: string | number;
	/** Hides header hover highlight while dragging headers. */
	hideHeadHighlight?: boolean;
}

const NO_SELECTION: readonly number[] = [];

const Table = forwardRef<HTMLTableElement, TableProps>(
	(
		{ children, size, selectedIndices = NO_SELECTION, snapKey, hideHeadHighlight = false, className, ...props },
		ref,
	) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const sizeClasses = useSize(size);

		const hover = useFluidHover(containerRef);
		const headHover = useFluidHover(containerRef, { axis: "x" });
		const registerHead = headHover.registerItem;
		const { activeStore, handlers, registerItem, itemRects, setActiveIndex } = hover;

		const shape = useShape();
		const runs = useSelectionRuns(selectedIndices);
		const mergedBlocks = useMergeSplitBlocks(runs, itemRects, shape.mergedRadius);
		const [snap, setSnap] = useState({ key: snapKey, on: false });
		if (snap.key !== snapKey) setSnap({ key: snapKey, on: true });
		useEffect(() => {
			if (!snap.on) return;
			const id = requestAnimationFrame(() => setSnap((s) => ({ ...s, on: false })));
			return () => cancelAnimationFrame(id);
		}, [snap.on]);

		const { measureItems } = hover;
		useLayoutEffect(() => {
			if (snap.on) measureItems();
		}, [snap.on, measureItems]);
		const blocks = snap.on
			? mergedBlocks.map((b) => ({ ...b, instant: true, exitInstant: true, enterFrom: undefined }))
			: mergedBlocks;

		const keyboardOwns = useRef(false);
		const lastPointer = useRef<{ x: number; y: number } | null>(null);
		const pointerMoved = (e: React.MouseEvent) => {
			const last = lastPointer.current;
			lastPointer.current = { x: e.clientX, y: e.clientY };
			return !last || last.x !== e.clientX || last.y !== e.clientY;
		};
		const fromPointer = (e: React.MouseEvent) => {
			const moved = pointerMoved(e);
			if (keyboardOwns.current && !moved) return false;
			keyboardOwns.current = false;
			return true;
		};

		const [repeating, setRepeating] = useState(false);

		const selectedKey = selectedIndices.join(",");
		const selected = useMemo(() => new Set(selectedKey ? selectedKey.split(",").map(Number) : []), [selectedKey]);

		const hideCoveredRules = useCallback((box: { y: number; height: number; opacity: number }) => {
			const container = containerRef.current;
			if (!container) return;
			const top = container.getBoundingClientRect().top;
			const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>("thead > tr, tbody > tr"));
			const covered = rows.map((tr) => {
				if (box.opacity < 0.5) return false;
				const bottom = tr.getBoundingClientRect().bottom - top;
				return bottom >= box.y - 1.5 && bottom <= box.y + box.height + 1.5;
			});
			rows.forEach((tr, i) => tr.toggleAttribute("data-under-highlight", covered[i]));
		}, []);

		const headCell =
			!hideHeadHighlight && headHover.isMeasured && headHover.activeIndex !== null
				? headHover.itemRects[headHover.activeIndex]
				: undefined;
		const headRect = headCell ? { ...headCell, height: headCell.height - 1 } : null;
		const [pressedHead, setPressedHead] = useState<number | null>(null);
		const headPressed = pressedHead !== null && pressedHead === headHover.activeIndex;
		const setHeadPressed = (on: boolean) => setPressedHead(on ? headHover.activeIndex : null);
		useEffect(() => {
			if (pressedHead === null) return;
			const release = () => setPressedHead(null);
			window.addEventListener("pointerup", release);
			window.addEventListener("pointercancel", release);
			return () => {
				window.removeEventListener("pointerup", release);
				window.removeEventListener("pointercancel", release);
			};
		}, [pressedHead]);

		const contextValue = useMemo(
			() => ({ registerItem, activeStore, selected, registerHead }),
			[registerItem, activeStore, selected, registerHead],
		);

		const table = (
			<TableContext.Provider value={contextValue}>
				<div
					ref={containerRef}
					data-slot="table-container"
					className="relative"
					onMouseEnter={(e) => {
						headHover.handlers.onMouseEnter();
						if (fromPointer(e)) handlers.onMouseEnter();
					}}
					onMouseMove={(e) => {
						headHover.handlers.onMouseMove(e);
						if (fromPointer(e)) handlers.onMouseMove(e);
					}}
					onMouseLeave={(e) => {
						headHover.handlers.onMouseLeave();
						if (fromPointer(e)) handlers.onMouseLeave();
					}}
					onPointerDown={(e) => {
						if (e.button !== 0) return;
						const th = (e.target as HTMLElement).closest("th[data-head-hover]");
						if (th && containerRef.current?.contains(th)) setHeadPressed(true);
					}}
					onClick={handlers.onClick}
					onKeyDown={(e) => {
						if (e.repeat && !repeating && e.key.startsWith("Arrow")) setRepeating(true);
					}}
					onKeyUp={() => repeating && setRepeating(false)}
					onFocus={(e) => {
						const target = e.target as HTMLElement;
						if (!target.matches(":focus-visible")) return;
						const index = target.closest("[data-fluid-hover-index]")?.getAttribute("data-fluid-hover-index");
						if (index == null) return;
						keyboardOwns.current = true;
						setActiveIndex(Number(index));
					}}
					onBlur={(e) => {
						const container = containerRef.current;
						if (!container || container.contains(e.relatedTarget as Node)) return;
						if (!container.matches(":hover")) setActiveIndex(null);
						setRepeating(false);
					}}
				>
					<SelectionBackgrounds key={String(snap.key ?? "")} blocks={blocks} />

					<FluidHoverHighlight
						hover={hover}
						className={shape.bg}
						transition={repeating || snap.on ? false : undefined}
						onFrame={hideCoveredRules}
					/>
					<FluidHoverHighlight
						rect={headRect}
						session={headHover.session}
						className={cn(shape.bg, "transition-[background-color] duration-80", headPressed && "bg-active")}
					/>

					<table
						ref={ref}
						data-slot="table"
						className={cn(
							"w-full border-separate border-spacing-0",
							sizeClasses.variant === "compact" ? "[--table-cell-py:5px]" : "[--table-cell-py:--spacing(2)]",
							sizeClasses.text,
							className,
						)}
						{...props}
					>
						{children}
					</table>
				</div>
			</TableContext.Provider>
		);

		return size ? <SizeProvider size={size}>{table}</SizeProvider> : table;
	},
);

Table.displayName = "Table";

const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
	({ className, ...props }, ref) => <thead ref={ref} data-slot="table-header" className={cn(className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
	({ className, ...props }, ref) => <tbody ref={ref} data-slot="table-body" className={cn(className)} {...props} />,
);
TableBody.displayName = "TableBody";

interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
	index?: number;
}

const TableRow = forwardRef<HTMLTableRowElement, TableRowProps>(({ index, className, style, ...props }, ref) => {
	const internalRef = useRef<HTMLTableRowElement>(null);
	const ctx = useContext(TableContext);

	useRegisterFluidHoverItem(ctx?.registerItem, index, internalRef);

	const isBodyRow = index !== undefined;
	const lit = useFluidHoverSelect(ctx?.activeStore, (active) => isBodyRow && active === index);
	const selected = ctx?.selected;
	const nextIndex = isBodyRow ? index + 1 : 0;
	const bySelection = Boolean(selected && ((isBodyRow && selected.has(index)) || selected.has(nextIndex)));

	return (
		<tr
			ref={(node) => {
				internalRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			}}
			data-slot="table-row"
			data-fluid-hover-index={index}
			className={cn(
				"group/row relative z-10 *:border-b *:transition-[border-color] *:duration-80",
				!isBodyRow && "hover:bg-hover/60",
				bySelection
					? "*:border-transparent"
					: "*:border-accent/40 data-[under-highlight]:*:border-transparent data-[under-highlight]:*:duration-0",
				lit && "is-active",
				className,
			)}
			style={{
				...style,
				fontVariationSettings: fontWeights.normal,
			}}
			{...props}
		/>
	);
});
TableRow.displayName = "TableRow";

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
	/** Joins the header row's fluid hover scope. */
	hoverIndex?: number;
}

const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
	({ hoverIndex, className, style, ...props }, ref) => {
		const sizeClasses = useSize();
		const ctx = useContext(TableContext);
		const internalRef = useRef<HTMLTableCellElement>(null);
		useRegisterFluidHoverItem(ctx?.registerHead, hoverIndex, internalRef);
		return (
			<th
				ref={(node) => {
					internalRef.current = node;
					if (typeof ref === "function") ref(node);
					else if (ref) ref.current = node;
				}}
				data-slot="table-head"
				data-head-hover={hoverIndex !== undefined || undefined}
				className={cn(
					"text-left text-foreground",
					"py-(--table-cell-py)",
					sizeClasses.variant === "compact" ? "px-2.5" : "px-3",
					className,
				)}
				style={{ fontVariationSettings: fontWeights.semibold, ...style }}
				{...props}
			/>
		);
	},
);
TableHead.displayName = "TableHead";

const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
	({ className, ...props }, ref) => {
		const sizeClasses = useSize();
		return (
			<td
				ref={ref}
				data-slot="table-cell"
				className={cn(
					"text-muted-foreground transition-colors duration-80 group-[.is-active]/row:text-foreground",
					"py-(--table-cell-py)",
					sizeClasses.variant === "compact" ? "px-2.5" : "px-3",
					className,
				)}
				{...props}
			/>
		);
	},
);
TableCell.displayName = "TableCell";

interface TableEmptyProps extends Omit<HTMLAttributes<HTMLTableRowElement>, "title"> {
	columns: number;
	title?: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	rows?: number;
}

const TableEmpty = forwardRef<HTMLTableRowElement, TableEmptyProps>(
	({ columns, title, description, action, rows = 3, children, className, ...props }, ref) => (
		<tr ref={ref} data-slot="table-empty" className={className} {...props}>
			<td colSpan={columns} className="p-0">
				<div
					className="sticky left-0 flex w-(--table-view-w,100%) min-h-[calc(var(--table-empty-rows)*(1lh+2*var(--table-cell-py)+1px))] flex-col items-center justify-center gap-1 px-3 py-4 text-center"
					style={{ "--table-empty-rows": rows } as CSSProperties}
				>
					{title && (
						<span className="text-foreground" style={{ fontVariationSettings: fontWeights.semibold }}>
							{title}
						</span>
					)}
					{description && <span className="text-muted-foreground">{description}</span>}
					{children}
					{action && <div className="mt-2">{action}</div>}
				</div>
			</td>
		</tr>
	),
);
TableEmpty.displayName = "TableEmpty";

export { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow };
export type { TableEmptyProps, TableHeadProps, TableProps, TableRowProps };
