"use client";

import {
	createContext,
	forwardRef,
	type HTMLAttributes,
	type ReactNode,
	type TdHTMLAttributes,
	type ThHTMLAttributes,
	useContext,
	useMemo,
} from "react";
import { fontWeights } from "@/lib/fluid/font-weight";
import { SizeProvider, type SizeVariant, useSize } from "@/lib/fluid/size-context";
import { cn } from "@/lib/utils";

interface TableContextValue {
	selected: ReadonlySet<number>;
}

const TableContext = createContext<TableContextValue | null>(null);

interface TableProps extends HTMLAttributes<HTMLTableElement> {
	children: ReactNode;
	size?: SizeVariant;
	selectedIndices?: readonly number[];
	snapKey?: string | number;
	hideHeadHighlight?: boolean;
}

const NO_SELECTION: readonly number[] = [];

const Table = forwardRef<HTMLTableElement, TableProps>(
	(
		{
			children,
			size,
			selectedIndices = NO_SELECTION,
			className,
			snapKey: _snapKey,
			hideHeadHighlight: _hideHeadHighlight,
			...props
		},
		ref,
	) => {
		const sizeClasses = useSize(size);
		const selectedKey = selectedIndices.join(",");
		const selected = useMemo(() => new Set(selectedKey ? selectedKey.split(",").map(Number) : []), [selectedKey]);
		const table = (
			<TableContext.Provider value={{ selected }}>
				<div data-slot="table-container" className="relative">
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
	const selected = useContext(TableContext)?.selected;
	const rowSelected = Boolean(index !== undefined && selected?.has(index));
	return (
		<tr
			ref={ref}
			data-slot="table-row"
			data-selected={rowSelected || undefined}
			className={cn(
				"group/row *:border-b *:border-accent/40",
				rowSelected && "bg-accent/40",
				"hover:bg-accent/30",
				className,
			)}
			style={{ ...style, fontVariationSettings: fontWeights.normal }}
			{...props}
		/>
	);
});
TableRow.displayName = "TableRow";

interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
	hoverIndex?: number;
}

const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
	({ className, style, hoverIndex: _hoverIndex, ...props }, ref) => {
		const sizeClasses = useSize();
		return (
			<th
				ref={ref}
				data-slot="table-head"
				className={cn(
					"text-left text-foreground hover:bg-accent/20",
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
					"text-muted-foreground group-hover/row:text-foreground",
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

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
