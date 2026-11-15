"use client";

import { ChevronRight, File, Folder, FolderOpen } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
	Children,
	type CSSProperties,
	Fragment,
	isValidElement,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { spring } from "@/lib/fluid/springs";
import { cn } from "@/lib/utils";

type FileTreeItem = {
	value: string;
	name: string;
	type: "file" | "folder";
	children?: Array<FileTreeItem>;
	icon?: ReactNode;
	disabled?: boolean;
	className?: string;
};

export interface FileTreeFolderProps {
	value: string;
	name: string;
	icon?: ReactNode;
	disabled?: boolean;
	children?: ReactNode;
	className?: string;
}

export interface FileTreeFileProps {
	value: string;
	name: string;
	icon?: ReactNode;
	disabled?: boolean;
	className?: string;
}

export type FileTreeClassNames = {
	tree?: string;
	item?: string;
	icon?: string;
	label?: string;
};

export interface FileTreeProps {
	children: ReactNode;
	value?: string | null;
	defaultValue?: string | null;
	onValueChange?: (value: string) => void;
	expandedIds?: Array<string>;
	defaultExpandedIds?: Array<string>;
	onExpandedChange?: (expandedIds: Array<string>) => void;
	ariaLabel?: string;
	indent?: number;
	className?: string;
	classNames?: FileTreeClassNames;
}

type FlatFileTreeItem = {
	item: FileTreeItem;
	depth: number;
	parentId: string | null;
	position: number;
	setSize: number;
};

// These declarative parts are read by FileTree and turned into one flattened,
// keyboard-navigable collection. They intentionally render nothing alone.
export function FileTreeFolder(_props: FileTreeFolderProps) {
	return null;
}

export function FileTreeFile(_props: FileTreeFileProps) {
	return null;
}

function flattenItems(
	items: Array<FileTreeItem>,
	expanded: ReadonlySet<string>,
	depth = 0,
	parentId: string | null = null,
): Array<FlatFileTreeItem> {
	return items.flatMap((item, index) => {
		const row = {
			item,
			depth,
			parentId,
			position: index + 1,
			setSize: items.length,
		};

		if (item.type !== "folder" || !expanded.has(item.value) || !item.children?.length) {
			return [row];
		}

		return [row, ...flattenItems(item.children, expanded, depth + 1, item.value)];
	});
}

function itemsFromChildren(children: ReactNode): Array<FileTreeItem> {
	const items: Array<FileTreeItem> = [];

	Children.forEach(children, (child) => {
		if (!isValidElement(child)) return;

		if (child.type === Fragment) {
			const props = child.props as { children?: ReactNode };
			items.push(...itemsFromChildren(props.children));
			return;
		}

		if (child.type === FileTreeFolder) {
			const props = child.props as FileTreeFolderProps;
			items.push({
				value: props.value,
				name: props.name,
				type: "folder",
				icon: props.icon,
				disabled: props.disabled,
				className: props.className,
				children: itemsFromChildren(props.children),
			});
			return;
		}

		if (child.type === FileTreeFile) {
			const props = child.props as FileTreeFileProps;
			items.push({
				value: props.value,
				name: props.name,
				type: "file",
				icon: props.icon,
				disabled: props.disabled,
				className: props.className,
			});
		}
	});

	return items;
}

function DefaultIcon({ item, open, reduce }: { item: FileTreeItem; open: boolean; reduce: boolean }) {
	if (item.type === "file") return <File className="size-4" />;
	if (reduce) {
		return open ? <FolderOpen className="size-4" /> : <Folder className="size-4" />;
	}

	return (
		<AnimatePresence initial={false} mode="popLayout">
			<m.span
				key={open ? "open" : "closed"}
				initial={{ opacity: 0, scale: 0.75, rotate: open ? -8 : 8 }}
				animate={{ opacity: 1, scale: 1, rotate: 0 }}
				exit={{ opacity: 0, scale: 0.75, rotate: open ? 8 : -8 }}
				transition={spring.fast}
				className="absolute inset-0 grid place-items-center"
			>
				{open ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
			</m.span>
		</AnimatePresence>
	);
}

/**
 * Keyboard-navigable hierarchical file tree with animated folder transitions.
 */
export function FileTree({
	children,
	value,
	defaultValue = null,
	onValueChange,
	expandedIds,
	defaultExpandedIds = [],
	onExpandedChange,
	ariaLabel = "Files",
	indent = 18,
	className,
	classNames,
}: FileTreeProps) {
	const reduce = useReducedMotion() ?? false;
	const hoverUid = useId();
	const [internalValue, setInternalValue] = useState(defaultValue);
	const [internalExpandedIds, setInternalExpandedIds] = useState(defaultExpandedIds);
	const [focusedId, setFocusedId] = useState<string | null>(value ?? defaultValue);
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const rowRefs = useRef(new Map<string, HTMLButtonElement>());
	const selectedId = value === undefined ? internalValue : value;
	const currentExpandedIds = expandedIds ?? internalExpandedIds;
	const expanded = useMemo(() => new Set(currentExpandedIds), [currentExpandedIds]);
	const items = useMemo(() => itemsFromChildren(children), [children]);
	const rows = useMemo(() => flattenItems(items, expanded), [expanded, items]);

	// Keep a real row tabbable in the first commit and immediately after a
	// collapse removes the previously focused descendant.
	const focusedRow =
		focusedId !== null && rows.some(({ item }) => item.value === focusedId)
			? focusedId
			: (rows[0]?.item.value ?? null);
	if (focusedId !== focusedRow) setFocusedId(focusedRow);

	const focusRow = useCallback((id: string) => {
		setFocusedId(id);
		const row = rowRefs.current.get(id);
		if (row) row.focus();
		else requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
	}, []);

	const selectItem = useCallback(
		(item: FileTreeItem) => {
			if (item.disabled) return;
			if (value === undefined) setInternalValue(item.value);
			onValueChange?.(item.value);
		},
		[onValueChange, value],
	);

	const setExpanded = useCallback(
		(next: Array<string>) => {
			if (expandedIds === undefined) setInternalExpandedIds(next);
			onExpandedChange?.(next);
		},
		[expandedIds, onExpandedChange],
	);

	const toggleFolder = useCallback(
		(id: string) => {
			const next = new Set(currentExpandedIds);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			setExpanded(Array.from(next));
		},
		[currentExpandedIds, setExpanded],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLButtonElement>, row: FlatFileTreeItem) => {
			const index = rows.findIndex(({ item }) => item.value === row.item.value);
			const previous = rows[index - 1];
			const next = rows[index + 1];
			const isFolder = row.item.type === "folder";
			const isExpandable = isFolder && Boolean(row.item.children?.length);
			const isOpen = isExpandable && expanded.has(row.item.value);

			if (event.key === "ArrowDown" && next) {
				event.preventDefault();
				focusRow(next.item.value);
			} else if (event.key === "ArrowUp" && previous) {
				event.preventDefault();
				focusRow(previous.item.value);
			} else if (event.key === "Home" && rows[0]) {
				event.preventDefault();
				focusRow(rows[0].item.value);
			} else if (event.key === "End" && rows.at(-1)) {
				event.preventDefault();
				focusRow(rows.at(-1)?.item.value ?? row.item.value);
			} else if (event.key === "ArrowRight" && isExpandable) {
				event.preventDefault();
				if (!isOpen && !row.item.disabled) toggleFolder(row.item.value);
				else if (next?.parentId === row.item.value) focusRow(next.item.value);
			} else if (event.key === "ArrowLeft") {
				event.preventDefault();
				if (isExpandable && isOpen && !row.item.disabled) toggleFolder(row.item.value);
				else if (row.parentId) focusRow(row.parentId);
			} else if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				if (row.item.disabled) return;
				selectItem(row.item);
				if (isExpandable) toggleFolder(row.item.value);
			}
		},
		[expanded, focusRow, rows, selectItem, toggleFolder],
	);

	return (
		<m.div
			role="tree"
			aria-label={ariaLabel}
			aria-multiselectable="false"
			layoutRoot
			onMouseLeave={() => setHoveredId(null)}
			className={cn("flex w-full min-w-0 flex-col", className, classNames?.tree)}
		>
			{rows.map((row) => {
				const isFolder = row.item.type === "folder";
				const isExpandable = isFolder && Boolean(row.item.children?.length);
				const isOpen = isExpandable && expanded.has(row.item.value);
				const isSelected = selectedId === row.item.value;
				const rowStyle = {
					"--tree-depth": row.depth,
					"--tree-indent": `${indent}px`,
				} as CSSProperties;

				return (
					<m.div
						layout={reduce ? false : "position"}
						key={row.item.value}
						onMouseEnter={() => setHoveredId(row.item.value)}
						initial={reduce ? false : { opacity: 0, y: -6 }}
						animate={{
							opacity: row.item.disabled ? 0.42 : 1,
							y: 0,
							transition: reduce
								? { duration: 0 }
								: {
										...spring.fast,
										delay: Math.min(row.position * 0.025, 0.1),
									},
						}}
						transition={reduce ? { duration: 0 } : spring.moderate}
						className="relative"
					>
						<AnimatePresence>
							{hoveredId !== null ? (
								<m.div
									initial={{ opacity: 0 }}
									animate={{ opacity: 1 }}
									exit={{ opacity: 0, transition: spring.fast.exit }}
									transition={{ duration: 0.08 }}
									className="pointer-events-none absolute inset-x-0 top-0 h-9"
								>
									{hoveredId === row.item.value ? (
										<m.div
											layoutId={`file-tree-hover-${hoverUid}`}
											transition={reduce ? { duration: 0 } : spring.moderate}
											className="pointer-events-none h-full w-full rounded-xl bg-muted"
										/>
									) : null}
								</m.div>
							) : null}
						</AnimatePresence>

						<Button
							ref={(node) => {
								if (node) rowRefs.current.set(row.item.value, node);
								else rowRefs.current.delete(row.item.value);
							}}
							type="button"
							variant="ghost"
							size="compact"
							role="treeitem"
							aria-level={row.depth + 1}
							aria-posinset={row.position}
							aria-setsize={row.setSize}
							aria-selected={isSelected}
							aria-expanded={isExpandable ? isOpen : undefined}
							aria-disabled={row.item.disabled || undefined}
							tabIndex={focusedRow === row.item.value ? 0 : -1}
							onFocus={() => setFocusedId(row.item.value)}
							onKeyDown={(event) => handleKeyDown(event, row)}
							onClick={() => {
								if (row.item.disabled) return;
								selectItem(row.item);
								if (isExpandable) toggleFolder(row.item.value);
							}}
							style={rowStyle}
							className={cn(
								"group/file-tree relative z-10 h-9 w-full justify-start gap-2 overflow-hidden rounded-lg text-left text-sm font-normal text-muted-foreground",
								"hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
								"aria-disabled:cursor-not-allowed",
								"[&>span:nth-child(2)]:static [&>span:nth-child(2)]:flex [&>span:nth-child(2)]:h-full [&>span:nth-child(2)]:w-full [&>span:nth-child(2)]:justify-start",
								"[&>span:nth-child(2)>span]:flex [&>span:nth-child(2)>span]:w-full [&>span:nth-child(2)>span]:min-w-0",
								isSelected && "bg-muted font-medium text-foreground",
								classNames?.item,
								row.item.className,
								"pl-[calc(8px+var(--tree-depth)*var(--tree-indent))] pr-2",
							)}
						>
							{row.depth > 0 ? (
								<m.span
									aria-hidden="true"
									initial={reduce ? false : { opacity: 0, scaleY: 0 }}
									animate={{ opacity: 1, scaleY: 1 }}
									exit={{ opacity: 0, scaleY: 0 }}
									transition={reduce ? { duration: 0 } : spring.moderate}
									className="absolute top-0 bottom-0 left-[calc(16px+(var(--tree-depth)-1)*var(--tree-indent))] w-px origin-top bg-border/70"
								/>
							) : null}

							<m.span
								aria-hidden="true"
								animate={{ rotate: isOpen ? 90 : 0 }}
								transition={reduce ? { duration: 0 } : spring.fast}
								className={cn(
									"relative z-10 grid size-4 shrink-0 place-items-center",
									!isExpandable && "opacity-0",
								)}
							>
								<ChevronRight className="size-3.5" />
							</m.span>

							<span
								aria-hidden="true"
								className={cn(
									"relative z-10 grid size-4 shrink-0 place-items-center text-muted-foreground transition-colors group-hover/file-tree:text-foreground",
									isFolder && isOpen && "text-foreground",
									classNames?.icon,
								)}
							>
								{row.item.icon ?? <DefaultIcon item={row.item} open={isOpen} reduce={reduce} />}
							</span>

							<span className={cn("relative z-10 min-w-0 flex-1 truncate", classNames?.label)}>
								{row.item.name}
							</span>
						</Button>
					</m.div>
				);
			})}
		</m.div>
	);
}
