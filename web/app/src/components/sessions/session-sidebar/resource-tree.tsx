"use client";

import { FileText, Folder, FolderOpen, MoreHorizontal, Pencil } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export type SidebarResourceKind = "folder" | "project" | "file" | "action";

export interface SidebarResource {
	id: string;
	label: string;
	kind: SidebarResourceKind;
	children?: SidebarResource[];
	disabled?: boolean;
	/** Extra visual nesting for relationships that stay in the flat resource list. */
	indent?: number;
}

export interface SidebarResourceMenuControls {
	close: () => void;
	rename: () => void;
}

export interface AISidebarProps {
	items?: SidebarResource[];
	onRename?: (item: SidebarResource, label: string) => void | Promise<void>;
	activeId?: string | null;
	activeContainerId?: string | null;
	onActiveChange?: (id: string) => void;
	onContainerSelect?: (id: string) => void;
	expandedIds?: readonly string[];
	onExpandedIdsChange?: (ids: string[]) => void;
	renderIcon?: (item: SidebarResource) => ReactNode;
	renderSecondaryAction?: (item: SidebarResource) => ReactNode;
	renderMenu?: (item: SidebarResource, controls: SidebarResourceMenuControls) => ReactNode;
	className?: string;
}

interface FlatResource {
	item: SidebarResource;
	depth: number;
	parentId: string | null;
}

const EMPTY_SIDEBAR_RESOURCES: SidebarResource[] = [];
const EMPTY_EXPANDED_IDS: string[] = [];

function canContain(item: SidebarResource) {
	return item.kind === "folder" || item.kind === "project";
}

function flattenResources(
	items: SidebarResource[],
	expanded: Set<string>,
	depth = 0,
	parentId: string | null = null,
): FlatResource[] {
	return items.flatMap((item) => {
		const row = { item, depth, parentId };
		if (!item.children?.length || !expanded.has(item.id)) return [row];
		return [row, ...flattenResources(item.children, expanded, depth + 1, item.id)];
	});
}

function renameResource(items: SidebarResource[], id: string, label: string): SidebarResource[] {
	return items.map((item) => ({
		...item,
		label: item.id === id ? label : item.label,
		children: item.children ? renameResource(item.children, id, label) : undefined,
	}));
}

function defaultIcon(item: SidebarResource, expanded: boolean) {
	if (item.kind === "action") return null;
	const Icon = item.kind === "folder" || item.kind === "project" ? (expanded ? FolderOpen : Folder) : FileText;
	return <Icon className="size-4" />;
}

function MarqueeLabel({ active, children }: { active: boolean; children: string }) {
	const reduce = useReducedMotion() ?? false;
	const viewportRef = useRef<HTMLSpanElement>(null);
	const labelRef = useRef<HTMLSpanElement>(null);
	const [distance, setDistance] = useState(0);

	useEffect(() => {
		const measure = () => {
			const viewport = viewportRef.current;
			const label = labelRef.current;
			if (!viewport || !label) return;
			setDistance(label.scrollWidth > viewport.clientWidth ? label.scrollWidth + 24 : 0);
		};
		measure();
		const observer = new ResizeObserver(measure);
		if (viewportRef.current) observer.observe(viewportRef.current);
		if (labelRef.current) observer.observe(labelRef.current);
		return () => observer.disconnect();
	}, []);

	const running = active && distance > 0 && !reduce;

	return (
		<span
			ref={viewportRef}
			className={cn("block min-w-0 flex-1 overflow-hidden", !running && "truncate")}
			title={children}
		>
			{running ? (
				<m.span
					className="flex w-max items-center gap-6 whitespace-nowrap"
					animate={{ x: [0, -distance] }}
					transition={{
						duration: Math.max(2.4, distance / 34),
						ease: "linear",
						repeat: Number.POSITIVE_INFINITY,
						repeatDelay: 2,
					}}
				>
					<span ref={labelRef}>{children}</span>
					<span aria-hidden="true">{children}</span>
				</m.span>
			) : (
				<span ref={labelRef}>{children}</span>
			)}
		</span>
	);
}

function ResourceRenameInput({
	label,
	onCommit,
	onCancel,
}: {
	label: string;
	onCommit: (next: string) => void;
	onCancel: () => void;
}) {
	const [draft, setDraft] = useState(label);
	const inputRef = useRef<HTMLInputElement>(null);
	const skipBlurRef = useRef(false);

	useEffect(() => {
		skipBlurRef.current = false;
		setDraft(label);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	}, [label]);

	return (
		<input
			ref={inputRef}
			value={draft}
			aria-label={`Rename ${label}`}
			onChange={(event) => setDraft(event.target.value)}
			onClick={(event) => event.stopPropagation()}
			onDoubleClick={(event) => event.stopPropagation()}
			onBlur={() => {
				if (!skipBlurRef.current) onCommit(draft);
			}}
			onKeyDown={(event) => {
				event.stopPropagation();
				if (event.key === "Enter") {
					skipBlurRef.current = true;
					onCommit(draft);
				}
				if (event.key === "Escape") {
					skipBlurRef.current = true;
					onCancel();
				}
			}}
			className="mx-1 h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
		/>
	);
}

function ResourceActionMenu({
	item,
	menuOpen,
	onMenuOpenChange,
	onRenameStart,
	renderMenu,
}: {
	item: SidebarResource;
	menuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
	onRenameStart: () => void;
	renderMenu?: AISidebarProps["renderMenu"];
}) {
	const menu = renderMenu?.(item, {
		close: () => onMenuOpenChange(false),
		rename: () => {
			onMenuOpenChange(false);
			onRenameStart();
		},
	}) ?? (
		<button
			type="button"
			onClick={() => {
				onMenuOpenChange(false);
				onRenameStart();
			}}
			className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-start text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
		>
			<Pencil aria-hidden="true" className="size-3.5" />
			Rename
		</button>
	);

	return (
		<Popover open={menuOpen} onOpenChange={onMenuOpenChange}>
			<PopoverTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={`Actions for ${item.label}`}
						onClick={(event) => event.stopPropagation()}
						className="size-8 shrink-0 opacity-0 outline-none transition-opacity hover:bg-foreground/5 focus-visible:opacity-100 group-hover/resource:opacity-100 group-data-[menu-open=true]/resource:opacity-100"
					>
						<MoreHorizontal aria-hidden="true" className="size-4" />
					</Button>
				}
			/>
			<PopoverContent side="bottom" align="end" sideOffset={8} className="w-40 p-1.5">
				<div data-sidebar-resource-menu={item.id}>{menu}</div>
			</PopoverContent>
		</Popover>
	);
}

function getResourceRowClassName(
	acceptsChildren: boolean,
	active: boolean,
	containerActive: boolean,
	kind: SidebarResourceKind,
	disabled?: boolean,
) {
	return cn(
		"group/resource relative flex min-h-8 min-w-0 cursor-pointer items-center gap-2 rounded-sm pe-0 text-body outline-none",
		"text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
		"focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
		"data-[menu-open=true]:bg-muted data-[menu-open=true]:text-foreground",
		!acceptsChildren && active && "bg-muted text-foreground",
		acceptsChildren && containerActive && "bg-muted/55 text-foreground ring-1 ring-border/70",
		kind === "action" && "text-xs text-muted-foreground",
		disabled && "cursor-not-allowed opacity-45",
	);
}

interface ResourceRowProps {
	row: FlatResource;
	active: boolean;
	containerActive: boolean;
	expanded: boolean;
	focused: boolean;
	menuOpen: boolean;
	renaming: boolean;
	onFocus: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
	onMenuOpenChange: (open: boolean) => void;
	onRenameCancel: () => void;
	onRenameCommit: (label: string) => void;
	onRenameStart: () => void;
	onSelect: () => void;
	onContainerSelect: () => void;
	renderIcon?: (item: SidebarResource) => ReactNode;
	renderSecondaryAction?: AISidebarProps["renderSecondaryAction"];
	renderMenu?: AISidebarProps["renderMenu"];
	setRef: (node: HTMLDivElement | null) => void;
}

function ResourceRow(props: ResourceRowProps) {
	const reduce = useReducedMotion() ?? false;
	const [hovered, setHovered] = useState(false);
	const acceptsChildren = canContain(props.row.item);
	const renderedIcon = props.renderIcon?.(props.row.item);
	const icon = renderedIcon === undefined ? defaultIcon(props.row.item, props.expanded) : renderedIcon;
	const { item } = props.row;

	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		if (event.defaultPrevented || props.renaming || item.disabled) return;
		if (acceptsChildren) props.onContainerSelect();
		else props.onSelect();
	};

	const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
		if (acceptsChildren || item.kind === "action" || item.disabled) return;
		event.preventDefault();
		props.onRenameStart();
	};

	return (
		<m.div
			ref={props.setRef}
			layout="position"
			transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
			role="treeitem"
			aria-level={props.row.depth + 1}
			aria-selected={acceptsChildren ? undefined : props.active}
			aria-expanded={acceptsChildren ? props.expanded : undefined}
			aria-disabled={item.disabled || undefined}
			tabIndex={props.focused ? 0 : -1}
			data-menu-open={props.menuOpen || undefined}
			data-kind={item.kind}
			onFocus={props.onFocus}
			onKeyDown={props.onKeyDown}
			onClick={handleClick}
			onDoubleClick={handleDoubleClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className={getResourceRowClassName(
				acceptsChildren,
				props.active,
				props.containerActive,
				item.kind,
				item.disabled,
			)}
			style={{ paddingInlineStart: `${8 + (props.row.depth + (item.indent ?? 0)) * 14}px` }}
		>
			{icon !== null && (
				<span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
					{icon}
				</span>
			)}
			{props.renaming ? (
				<ResourceRenameInput label={item.label} onCommit={props.onRenameCommit} onCancel={props.onRenameCancel} />
			) : (
				<>
					<MarqueeLabel active={hovered || props.menuOpen}>{item.label}</MarqueeLabel>
					{props.renderSecondaryAction?.(item)}
					{!item.disabled && item.kind !== "action" && (
						<ResourceActionMenu
							item={item}
							menuOpen={props.menuOpen}
							onMenuOpenChange={props.onMenuOpenChange}
							onRenameStart={props.onRenameStart}
							renderMenu={props.renderMenu}
						/>
					)}
				</>
			)}
		</m.div>
	);
}

export function AISidebar({
	items = EMPTY_SIDEBAR_RESOURCES,
	onRename,
	activeId = null,
	activeContainerId,
	onActiveChange,
	onContainerSelect,
	expandedIds: controlledExpandedIds,
	onExpandedIdsChange,
	renderIcon,
	renderSecondaryAction,
	renderMenu,
	className,
}: AISidebarProps) {
	const [internalItems, setInternalItems] = useState(items);
	const [internalExpandedIds, setInternalExpandedIds] = useState(() => new Set(EMPTY_EXPANDED_IDS));
	const [focusedId, setFocusedId] = useState<string | null>(activeId);
	const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const rowRefs = useRef(new Map<string, HTMLDivElement>());
	const expandedIds = useMemo(
		() => (controlledExpandedIds === undefined ? internalExpandedIds : new Set(controlledExpandedIds)),
		[controlledExpandedIds, internalExpandedIds],
	);

	useEffect(() => {
		setInternalItems(items);
	}, [items]);

	const flat = useMemo(() => flattenResources(internalItems, expandedIds), [expandedIds, internalItems]);

	useEffect(() => {
		if (focusedId && flat.some((row) => row.item.id === focusedId)) return;
		setFocusedId(flat[0]?.item.id ?? null);
	}, [flat, focusedId]);

	useEffect(() => {
		if (!menuOpenId) return;
		const frame = requestAnimationFrame(() => {
			const menus = Array.from(document.querySelectorAll<HTMLElement>("[data-sidebar-resource-menu]"));
			menus
				.find((menu) => menu.dataset.sidebarResourceMenu === menuOpenId)
				?.querySelector<HTMLElement>("button, a[href]")
				?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [menuOpenId]);

	const focusRow = useCallback((id: string) => {
		setFocusedId(id);
		requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
	}, []);

	const toggle = useCallback(
		(id: string) => {
			const next = new Set(expandedIds);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			if (controlledExpandedIds === undefined) setInternalExpandedIds(next);
			onExpandedIdsChange?.([...next]);
		},
		[controlledExpandedIds, expandedIds, onExpandedIdsChange],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>, row: FlatResource) => {
			const index = flat.findIndex(({ item }) => item.id === row.item.id);
			const previous = flat[index - 1];
			const next = flat[index + 1];

			if (event.key === "ArrowDown" && next) {
				event.preventDefault();
				focusRow(next.item.id);
				return;
			}
			if (event.key === "ArrowUp" && previous) {
				event.preventDefault();
				focusRow(previous.item.id);
				return;
			}
			if (event.key === "Home" && flat[0]) {
				event.preventDefault();
				focusRow(flat[0].item.id);
				return;
			}
			if (event.key === "End" && flat.at(-1)) {
				event.preventDefault();
				focusRow(flat.at(-1)?.item.id ?? row.item.id);
				return;
			}

			if (row.item.disabled) {
				if (event.key === "ArrowLeft" && row.parentId) {
					event.preventDefault();
					focusRow(row.parentId);
				} else if (
					["ArrowRight", "Enter", " ", "F2", "ContextMenu"].includes(event.key) ||
					(event.shiftKey && event.key === "F10")
				) {
					event.preventDefault();
				}
				return;
			}

			if (event.key === "ArrowRight" && canContain(row.item)) {
				event.preventDefault();
				if (!expandedIds.has(row.item.id)) toggle(row.item.id);
				else if (next?.parentId === row.item.id) focusRow(next.item.id);
			} else if (event.key === "ArrowLeft") {
				event.preventDefault();
				if (expandedIds.has(row.item.id)) toggle(row.item.id);
				else if (row.parentId) focusRow(row.parentId);
			} else if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				if (canContain(row.item)) {
					if (onContainerSelect) onContainerSelect(row.item.id);
					else toggle(row.item.id);
				} else onActiveChange?.(row.item.id);
			} else if (event.key === "F2" && row.item.kind !== "action") {
				event.preventDefault();
				setRenamingId(row.item.id);
			} else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
				event.preventDefault();
				setMenuOpenId(row.item.id);
			}
		},
		[expandedIds, flat, focusRow, onActiveChange, onContainerSelect, toggle],
	);

	return (
		<>
			<div
				role="tree"
				aria-label="Projects and sessions"
				aria-multiselectable="false"
				className={cn(
					"relative flex min-w-0 flex-col gap-0.5 [overflow-anchor:none] group-data-[state=collapsed]/sidebar:hidden",
					className,
				)}
			>
				<AnimatePresence initial={false}>
					{flat.map((row) => (
						<ResourceRow
							key={row.item.id}
							row={row}
							active={activeId === row.item.id}
							containerActive={activeContainerId === row.item.id}
							expanded={expandedIds.has(row.item.id)}
							focused={focusedId === row.item.id}
							menuOpen={menuOpenId === row.item.id}
							renaming={renamingId === row.item.id}
							onFocus={() => setFocusedId(row.item.id)}
							onSelect={() => onActiveChange?.(row.item.id)}
							onContainerSelect={() => {
								if (onContainerSelect) onContainerSelect(row.item.id);
								else toggle(row.item.id);
							}}
							onKeyDown={(event) => handleKeyDown(event, row)}
							onRenameStart={() => setRenamingId(row.item.id)}
							onRenameCancel={() => setRenamingId(null)}
							onRenameCommit={(label) => {
								const trimmed = label.trim();
								setRenamingId(null);
								if (!trimmed || trimmed === row.item.label) return;
								const before = internalItems;
								setInternalItems(renameResource(before, row.item.id, trimmed));
								void Promise.resolve(onRename?.(row.item, trimmed)).catch(() => {
									setInternalItems(before);
									setAnnouncement(`Rename failed. ${row.item.label} was restored.`);
								});
							}}
							onMenuOpenChange={(open) => {
								setMenuOpenId(open ? row.item.id : null);
								if (!open) focusRow(row.item.id);
							}}
							renderIcon={renderIcon}
							renderSecondaryAction={renderSecondaryAction}
							renderMenu={renderMenu}
							setRef={(node) => {
								if (node) rowRefs.current.set(row.item.id, node);
								else rowRefs.current.delete(row.item.id);
							}}
						/>
					))}
				</AnimatePresence>
			</div>
			<span className="sr-only" aria-live="polite">
				{announcement}
			</span>
		</>
	);
}
