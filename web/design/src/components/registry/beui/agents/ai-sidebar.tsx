"use client";
// beui.dev/components/agents/chat-app

import {
  Bookmark,
  FileText,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MorphPopover,
  MorphPopoverContent,
  MorphPopoverTrigger,
} from "@prime-agent/web-design/components/registry/beui/motion/popover-morph";
import { EASE_OUT, SPRING_LAYOUT } from "@prime-agent/web-design/lib/ease";
import { cn } from "@prime-agent/web-design/lib/utils";

export type SidebarResourceKind =
  | "folder"
  | "project"
  | "file"
  | "bookmark"
  | "action";

export interface SidebarResource {
  id: string;
  label: string;
  kind: SidebarResourceKind;
  children?: SidebarResource[];
  disabled?: boolean;
  /** Extra visual nesting for relationships that stay in the flat resource list. */
  indent?: number;
}

export type SidebarResourceDropPosition = "before" | "inside" | "after";

export interface SidebarResourceMove {
  itemId: string;
  targetId: string | null;
  position: SidebarResourceDropPosition;
}

export interface SidebarResourceMenuControls {
  close: () => void;
  rename: () => void;
}

export interface AISidebarProps {
  items?: SidebarResource[];
  defaultItems?: SidebarResource[];
  onItemsChange?: (items: SidebarResource[]) => void;
  /** Reject the promise to roll the optimistic move back. */
  onMove?: (move: SidebarResourceMove) => void | Promise<void>;
  onMoveError?: (error: unknown, move: SidebarResourceMove) => void;
  /** Disable drag-and-drop when hierarchy changes are controlled elsewhere. */
  allowMove?: boolean;
  onRename?: (item: SidebarResource, label: string) => void | Promise<void>;
  activeId?: string | null;
  activeContainerId?: string | null;
  defaultActiveId?: string | null;
  onActiveChange?: (id: string) => void;
  onContainerSelect?: (id: string) => void;
  expandedIds?: readonly string[];
  defaultExpandedIds?: string[];
  onExpandedIdsChange?: (ids: string[]) => void;
  renderIcon?: (item: SidebarResource) => ReactNode;
  renderSecondaryAction?: (item: SidebarResource) => ReactNode;
  renderMenu?: (
    item: SidebarResource,
    controls: SidebarResourceMenuControls,
  ) => ReactNode;
  ariaLabel?: string;
  className?: string;
}

interface FlatResource {
  item: SidebarResource;
  depth: number;
  parentId: string | null;
}

interface DropTarget {
  id: string | null;
  position: SidebarResourceDropPosition;
}

const ROW_REVEAL = {
  duration: 0.16,
  ease: EASE_OUT,
} as const;
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
    return [
      row,
      ...flattenResources(item.children, expanded, depth + 1, item.id),
    ];
  });
}

function findResource(
  items: SidebarResource[],
  id: string,
): SidebarResource | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const child = item.children ? findResource(item.children, id) : undefined;
    if (child) return child;
  }
}

function containsResource(item: SidebarResource, id: string): boolean {
  return (
    item.id === id ||
    item.children?.some((child) => containsResource(child, id)) === true
  );
}

function removeResource(
  items: SidebarResource[],
  id: string,
): { items: SidebarResource[]; removed?: SidebarResource } {
  let removed: SidebarResource | undefined;
  const next: SidebarResource[] = [];

  for (const item of items) {
    if (item.id === id) {
      removed = item;
      continue;
    }

    if (item.children?.length) {
      const childResult = removeResource(item.children, id);
      if (childResult.removed) {
        removed = childResult.removed;
        next.push({ ...item, children: childResult.items });
        continue;
      }
    }

    next.push(item);
  }

  return { items: next, removed };
}

function insertResource(
  items: SidebarResource[],
  resource: SidebarResource,
  targetId: string | null,
  position: SidebarResourceDropPosition,
): SidebarResource[] {
  if (targetId === null) return [...items, resource];

  const next: SidebarResource[] = [];
  for (const item of items) {
    if (item.id === targetId) {
      if (position === "before") next.push(resource, item);
      else if (position === "after") next.push(item, resource);
      else next.push({ ...item, children: [...(item.children ?? []), resource] });
      continue;
    }

    if (item.children?.length) {
      next.push({
        ...item,
        children: insertResource(item.children, resource, targetId, position),
      });
    } else {
      next.push(item);
    }
  }
  return next;
}

function moveResource(
  items: SidebarResource[],
  move: SidebarResourceMove,
): SidebarResource[] | null {
  const source = findResource(items, move.itemId);
  if (!source || source.disabled) return null;
  if (move.targetId && containsResource(source, move.targetId)) return null;

  const target = move.targetId ? findResource(items, move.targetId) : undefined;
  if (
    move.position === "inside" &&
    (!target || target.disabled || !canContain(target))
  )
    return null;

  const removed = removeResource(items, move.itemId);
  if (!removed.removed) return null;
  return insertResource(
    removed.items,
    removed.removed,
    move.targetId,
    move.position,
  );
}

function renameResource(
  items: SidebarResource[],
  id: string,
  label: string,
): SidebarResource[] {
  return items.map((item) => ({
    ...item,
    label: item.id === id ? label : item.label,
    children: item.children
      ? renameResource(item.children, id, label)
      : undefined,
  }));
}

function defaultIcon(item: SidebarResource, expanded: boolean) {
  if (item.kind === "action") return null;
  const Icon =
    item.kind === "folder" || item.kind === "project"
      ? expanded
        ? FolderOpen
        : Folder
      : item.kind === "bookmark"
          ? Bookmark
          : FileText;
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
    <span ref={viewportRef} className="block min-w-0 flex-1 overflow-hidden">
      <m.span
        className="flex w-max items-center gap-6 whitespace-nowrap"
        animate={{ x: running ? [0, -distance] : 0 }}
        transition={
          running
            ? {
                duration: Math.max(2.4, distance / 34),
                ease: "linear",
                repeat: Number.POSITIVE_INFINITY,
                repeatDelay: 2,
              }
            : ROW_REVEAL
        }
      >
        <span ref={labelRef}>{children}</span>
        {running ? <span aria-hidden="true">{children}</span> : null}
      </m.span>
    </span>
  );
}

interface ResourceRowProps {
  row: FlatResource;
  active: boolean;
  containerActive: boolean;
  expanded: boolean;
  focused: boolean;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  menuOpen: boolean;
  renaming: boolean;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, row: FlatResource) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMenuOpenChange: (open: boolean) => void;
  onRenameCancel: () => void;
  onRenameCommit: (label: string) => void;
  onRenameStart: () => void;
  onSelect: () => void;
  onContainerSelect: () => void;
  allowMove: boolean;
  renderIcon?: (item: SidebarResource) => ReactNode;
  renderSecondaryAction?: AISidebarProps["renderSecondaryAction"];
  renderMenu?: AISidebarProps["renderMenu"];
  setRef: (node: HTMLDivElement | null) => void;
}

interface ResourceRenameInputProps {
  label: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

/**
 * Renders an inline input for editing a resource label.
 *
 * @param label - The current resource label
 * @param onCommit - Callback invoked with the edited label
 * @param onCancel - Callback invoked when renaming is canceled
 */
function ResourceRenameInput({ label, onCommit, onCancel }: ResourceRenameInputProps) {
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
      draggable={false}
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

interface ResourceActionMenuProps {
  item: SidebarResource;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onRenameStart: () => void;
  renderMenu?: AISidebarProps["renderMenu"];
}

/**
 * Renders an action menu for a resource, with customizable content and rename support.
 *
 * @param renderMenu - Optional function that provides custom menu content and actions.
 */
function ResourceActionMenu({
  item,
  menuOpen,
  onMenuOpenChange,
  onRenameStart,
  renderMenu,
}: ResourceActionMenuProps) {
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
      className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Pencil aria-hidden="true" className="size-3.5" />
      Rename
    </button>
  );

  return (
    <MorphPopover open={menuOpen} onOpenChange={onMenuOpenChange}>
      <MorphPopoverTrigger>
        <button
          type="button"
          draggable={false}
          tabIndex={-1}
          aria-label={`Actions for ${item.label}`}
          onClick={(event) => event.stopPropagation()}
          className="grid size-7 shrink-0 place-items-center rounded-lg opacity-0 outline-none transition-opacity hover:bg-foreground/5 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/resource:opacity-100 group-data-[menu-open=true]/resource:opacity-100"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </button>
      </MorphPopoverTrigger>
      <MorphPopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        radius={12}
        className="w-40 p-1.5"
      >
        <div data-sidebar-resource-menu={item.id}>{menu}</div>
      </MorphPopoverContent>
    </MorphPopover>
  );
}

/**
 * Builds the CSS class name for a resource row based on its interaction state and kind.
 *
 * @param acceptsChildren - Whether the resource can contain child resources
 * @param active - Whether the resource is selected
 * @param containerActive - Whether the resource's container state is active
 * @param kind - The resource kind
 * @param disabled - Whether the resource is disabled
 * @returns The combined CSS class name for the resource row
 */
function getResourceRowClassName(
  acceptsChildren: boolean,
  active: boolean,
  containerActive: boolean,
  kind: SidebarResourceKind,
  disabled?: boolean,
) {
  return cn(
    "group/resource relative flex min-h-8 min-w-0 cursor-pointer items-center gap-2 rounded-lg pr-2 text-[13px] outline-none",
    "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
    "focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
    "data-[menu-open=true]:bg-muted data-[menu-open=true]:text-foreground",
    "data-[dragging=true]:opacity-40",
    "data-[drop=inside]:bg-primary/10 data-[drop=inside]:ring-1 data-[drop=inside]:ring-primary/45",
    "data-[drop=before]:before:absolute data-[drop=before]:before:-top-0.5 data-[drop=before]:before:right-2 data-[drop=before]:before:left-2 data-[drop=before]:before:h-0.5 data-[drop=before]:before:rounded-full data-[drop=before]:before:bg-primary",
    "data-[drop=after]:after:absolute data-[drop=after]:after:-bottom-0.5 data-[drop=after]:after:right-2 data-[drop=after]:after:left-2 data-[drop=after]:after:h-0.5 data-[drop=after]:after:rounded-full data-[drop=after]:after:bg-primary",
    !acceptsChildren && active && "bg-muted text-foreground",
    acceptsChildren && containerActive && "bg-muted/55 text-foreground ring-1 ring-border/70",
    kind === "action" && "text-xs text-muted-foreground",
    disabled && "cursor-not-allowed opacity-45",
  );
}

/**
 * Creates event handlers for selecting, renaming, and moving a sidebar resource row.
 *
 * @param acceptsChildren - Whether the row represents a container.
 * @param allowMove - Whether the row supports drag-and-drop movement.
 * @param disabled - Whether row interactions are disabled.
 * @param kind - The resource kind used to determine rename behavior.
 * @param renaming - Whether the row is currently being renamed.
 * @param row - The flattened resource row associated with the handlers.
 * @returns Event handlers for click, double-click, drag, and drop interactions.
 */
function useResourceRowEvents({
  acceptsChildren,
  allowMove,
  disabled,
  kind,
  onContainerSelect,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onRenameStart,
  onSelect,
  renaming,
  row,
}: {
  acceptsChildren: boolean;
  allowMove: boolean;
  disabled?: boolean;
  kind: SidebarResourceKind;
  onContainerSelect: () => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, row: FlatResource) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onRenameStart: () => void;
  onSelect: () => void;
  renaming: boolean;
  row: FlatResource;
}) {
  const draggedRef = useRef(false);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || draggedRef.current || renaming || disabled) return;
    if (acceptsChildren) onContainerSelect();
    else onSelect();
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (acceptsChildren || kind === "action" || disabled) return;
    event.preventDefault();
    onRenameStart();
  };

  const handleDragStartCapture = (event: DragEvent<HTMLDivElement>) => {
    if (!allowMove) return;
    draggedRef.current = true;
    onDragStart(event, row.item.id);
  };

  const handleDragEndCapture = () => {
    onDragEnd();
    requestAnimationFrame(() => {
      draggedRef.current = false;
    });
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (allowMove) onDragOver(event, row);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (allowMove) onDrop(event);
  };

  return {
    handleClick,
    handleDoubleClick,
    handleDragStartCapture,
    handleDragEndCapture,
    handleDragOver,
    handleDrop,
  };
}

interface ResourceRowContentProps {
  icon: ReactNode;
  renaming: boolean;
  label: string;
  onCommit: (label: string) => void;
  onCancel: () => void;
  activeLabel: boolean;
  item: SidebarResource;
  secondaryAction?: ReactNode;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onRenameStart: () => void;
  renderMenu?: AISidebarProps["renderMenu"];
}

/**
 * Renders a resource row's icon, label, rename input, and contextual actions.
 *
 * @param renaming - Whether to render the inline rename input instead of the label and actions.
 * @param activeLabel - Whether the label should animate when it overflows.
 * @param item - Resource metadata used to determine available actions.
 * @returns The rendered resource row content.
 */
function ResourceRowContent({
  icon,
  renaming,
  label,
  onCommit,
  onCancel,
  activeLabel,
  item,
  secondaryAction,
  menuOpen,
  onMenuOpenChange,
  onRenameStart,
  renderMenu,
}: ResourceRowContentProps) {
  if (renaming) {
    return (
      <>
        {icon !== null && (
          <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
            {icon}
          </span>
        )}
        <ResourceRenameInput
          label={label}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </>
    );
  }

  return (
    <>
      {icon !== null && (
        <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
          {icon}
        </span>
      )}
      <MarqueeLabel active={activeLabel}>{label}</MarqueeLabel>
      {secondaryAction}
      {!item.disabled && item.kind !== "action" && (
        <ResourceActionMenu
          item={item}
          menuOpen={menuOpen}
          onMenuOpenChange={onMenuOpenChange}
          onRenameStart={onRenameStart}
          renderMenu={renderMenu}
        />
      )}
    </>
  );
}

/**
 * Builds accessibility and interaction attributes for a resource row.
 *
 * @returns The row's ARIA, focus, drag-and-drop, and state attributes.
 */
function getResourceRowAriaProps(
  row: FlatResource,
  acceptsChildren: boolean,
  active: boolean,
  expanded: boolean,
  focused: boolean,
  allowMove: boolean,
  renaming: boolean,
  menuOpen: boolean,
  dropPosition: SidebarResourceDropPosition | null,
  isDragging: boolean,
) {
  return {
    "aria-level": row.depth + 1,
    "aria-selected": acceptsChildren ? undefined : active,
    "aria-expanded": acceptsChildren ? expanded : undefined,
    "aria-disabled": row.item.disabled || undefined,
    tabIndex: focused ? 0 : -1,
    draggable: allowMove && !row.item.disabled && !renaming,
    "data-menu-open": menuOpen || undefined,
    "data-kind": row.item.kind,
    "data-drop": dropPosition ?? undefined,
    "data-dragging": isDragging || undefined,
  };
}

/**
 * Renders an accessible tree row for a sidebar resource, including its label, icon, actions, menus, and drag-and-drop state.
 *
 * @param props - The row data, interaction handlers, and rendering customizations.
 */
function ResourceRow(props: ResourceRowProps) {
  const reduce = useReducedMotion() ?? false;
  const [hovered, setHovered] = useState(false);
  const acceptsChildren = canContain(props.row.item);
  const renderedIcon = props.renderIcon?.(props.row.item);
  const icon =
    renderedIcon === undefined
      ? defaultIcon(props.row.item, props.expanded)
      : renderedIcon;
  const isDragging = props.draggingId === props.row.item.id;
  const dropPosition = props.dropTarget?.id === props.row.item.id ? props.dropTarget.position : null;

  const events = useResourceRowEvents({
    acceptsChildren,
    allowMove: props.allowMove,
    disabled: props.row.item.disabled,
    kind: props.row.item.kind,
    onContainerSelect: props.onContainerSelect,
    onDragEnd: props.onDragEnd,
    onDragOver: props.onDragOver,
    onDragStart: props.onDragStart,
    onDrop: props.onDrop,
    onRenameStart: props.onRenameStart,
    onSelect: props.onSelect,
    renaming: props.renaming,
    row: props.row,
  });

  const ariaProps = getResourceRowAriaProps(
    props.row,
    acceptsChildren,
    props.active,
    props.expanded,
    props.focused,
    props.allowMove,
    props.renaming,
    props.menuOpen,
    dropPosition,
    isDragging,
  );

  return (
    <m.div
      ref={props.setRef}
      layout="position"
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      role="treeitem"
      {...ariaProps}
      onFocus={props.onFocus}
      onKeyDown={props.onKeyDown}
      onClick={events.handleClick}
      onDoubleClick={events.handleDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragStartCapture={events.handleDragStartCapture}
      onDragEndCapture={events.handleDragEndCapture}
      onDragOver={events.handleDragOver}
      onDrop={events.handleDrop}
      className={getResourceRowClassName(
        acceptsChildren,
        props.active,
        props.containerActive,
        props.row.item.kind,
        props.row.item.disabled,
      )}
      style={{ paddingLeft: `${8 + (props.row.depth + (props.row.item.indent ?? 0)) * 14}px` }}
    >
      <ResourceRowContent
        icon={icon}
        renaming={props.renaming}
        label={props.row.item.label}
        onCommit={props.onRenameCommit}
        onCancel={props.onRenameCancel}
        activeLabel={hovered || props.menuOpen}
        item={props.row.item}
        secondaryAction={!props.renaming ? props.renderSecondaryAction?.(props.row.item) : null}
        menuOpen={props.menuOpen}
        onMenuOpenChange={props.onMenuOpenChange}
        onRenameStart={props.onRenameStart}
        renderMenu={props.renderMenu}
      />
    </m.div>
  );
}

interface ResourceListProps {
  flat: FlatResource[];
  selectedId: string | null;
  activeContainerId?: string | null;
  expandedIds: Set<string>;
  focusedId: string | null;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  menuOpenId: string | null;
  renamingId: string | null;
  allowMove: boolean;
  announcement: string;
  ariaLabel: string;
  className?: string;
  renderIcon?: AISidebarProps["renderIcon"];
  renderSecondaryAction?: AISidebarProps["renderSecondaryAction"];
  renderMenu?: AISidebarProps["renderMenu"];
  onFocus: (id: string) => void;
  onSelect: (id: string) => void;
  onContainerSelect: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: FlatResource) => void;
  onRenameStart: (id: string) => void;
  onRenameCancel: () => void;
  onRenameCommit: (row: FlatResource, label: string) => void;
  onMenuOpenChange: (id: string, open: boolean) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, id: string) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, row: FlatResource) => void;
  onRootDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  setRef: (id: string, node: HTMLDivElement | null) => void;
}

function ResourceList({
  flat,
  selectedId,
  activeContainerId,
  expandedIds,
  focusedId,
  draggingId,
  dropTarget,
  menuOpenId,
  renamingId,
  allowMove,
  announcement,
  ariaLabel,
  className,
  renderIcon,
  renderSecondaryAction,
  renderMenu,
  onFocus,
  onSelect,
  onContainerSelect,
  onKeyDown,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
  onMenuOpenChange,
  onDragStart,
  onDragEnd,
  onDragOver,
  onRootDragOver,
  onDrop,
  setRef,
}: ResourceListProps) {
  return (
    <>
      <div
        role="tree"
        aria-label={ariaLabel}
        aria-multiselectable="false"
        onDragOver={onRootDragOver}
        onDrop={onDrop}
        className={cn(
          "relative flex min-w-0 flex-col gap-0.5 [overflow-anchor:none] group-data-[state=collapsed]/sidebar:hidden",
          draggingId && "select-none pb-9",
          className,
        )}
      >
        <AnimatePresence initial={false}>
          {flat.map((row) => (
            <ResourceRow
              key={row.item.id}
              row={row}
              active={selectedId === row.item.id}
              containerActive={activeContainerId === row.item.id}
              expanded={expandedIds.has(row.item.id)}
              focused={focusedId === row.item.id}
              draggingId={draggingId}
              dropTarget={dropTarget}
              menuOpen={menuOpenId === row.item.id}
              renaming={renamingId === row.item.id}
              onFocus={() => onFocus(row.item.id)}
              onSelect={() => onSelect(row.item.id)}
              onContainerSelect={() => onContainerSelect(row.item.id)}
              allowMove={allowMove}
              onKeyDown={(event) => onKeyDown(event, row)}
              onRenameStart={() => onRenameStart(row.item.id)}
              onRenameCancel={onRenameCancel}
              onRenameCommit={(label) => onRenameCommit(row, label)}
              onMenuOpenChange={(open) => onMenuOpenChange(row.item.id, open)}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={(event, targetRow) => onDragOver(event, targetRow)}
              onDrop={onDrop}
              renderIcon={renderIcon}
              renderSecondaryAction={renderSecondaryAction}
              renderMenu={renderMenu}
              setRef={(node) => setRef(row.item.id, node)}
            />
          ))}
        </AnimatePresence>

        {draggingId ? (
          <div
            aria-hidden="true"
            data-active={dropTarget?.id === null || undefined}
            className="absolute inset-x-1 bottom-0 flex h-8 items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground data-[active=true]:border-primary/50 data-[active=true]:bg-primary/10 data-[active=true]:text-foreground"
          >
            Move to top level
          </div>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

function useResourceKeyboardNavigation({
  expandedIds,
  flat,
  focusRow,
  onContainerSelect,
  performMove,
  select,
  setMenuOpenId,
  setRenamingId,
  toggle,
  updateExpandedIds,
}: {
  expandedIds: Set<string>;
  flat: FlatResource[];
  focusRow: (id: string) => void;
  onContainerSelect?: (id: string) => void;
  performMove: (move: SidebarResourceMove) => void;
  select: (id: string) => void;
  setMenuOpenId: (id: string | null) => void;
  setRenamingId: (id: string | null) => void;
  toggle: (id: string) => void;
  updateExpandedIds: (update: (current: Set<string>) => Set<string>) => void;
}) {
  return useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: FlatResource) => {
      const index = flat.findIndex(({ item }) => item.id === row.item.id);
      const previous = flat[index - 1];
      const next = flat[index + 1];
      const moveModifier = event.altKey && event.shiftKey;

      if (event.key === "ArrowDown" && !moveModifier && next) {
        event.preventDefault();
        focusRow(next.item.id);
        return;
      }
      if (event.key === "ArrowUp" && !moveModifier && previous) {
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
          moveModifier ||
          ["ArrowRight", "Enter", " ", "F2", "ContextMenu"].includes(event.key) ||
          (event.shiftKey && event.key === "F10")
        ) {
          event.preventDefault();
        }
        return;
      }

      if (moveModifier && event.key === "ArrowUp" && previous) {
        event.preventDefault();
        performMove({ itemId: row.item.id, targetId: previous.item.id, position: "before" });
        return;
      }
      if (moveModifier && event.key === "ArrowDown" && next) {
        event.preventDefault();
        performMove({ itemId: row.item.id, targetId: next.item.id, position: "after" });
        return;
      }
      if (moveModifier && event.key === "ArrowRight" && previous && canContain(previous.item)) {
        event.preventDefault();
        updateExpandedIds((current) => new Set(current).add(previous.item.id));
        performMove({ itemId: row.item.id, targetId: previous.item.id, position: "inside" });
        return;
      }
      if (moveModifier && event.key === "ArrowLeft" && row.parentId) {
        event.preventDefault();
        performMove({ itemId: row.item.id, targetId: row.parentId, position: "after" });
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
        } else select(row.item.id);
      } else if (event.key === "F2" && row.item.kind !== "action") {
        event.preventDefault();
        setRenamingId(row.item.id);
      } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        setMenuOpenId(row.item.id);
      }
    },
    [
      expandedIds,
      flat,
      focusRow,
      onContainerSelect,
      performMove,
      select,
      setMenuOpenId,
      setRenamingId,
      toggle,
      updateExpandedIds,
    ],
  );
}

export function AISidebar({
  items,
  defaultItems = EMPTY_SIDEBAR_RESOURCES,
  onItemsChange,
  onMove,
  onMoveError,
  allowMove = true,
  onRename,
  activeId,
  activeContainerId,
  defaultActiveId = null,
  onActiveChange,
  onContainerSelect,
  expandedIds: controlledExpandedIds,
  defaultExpandedIds = EMPTY_EXPANDED_IDS,
  onExpandedIdsChange,
  renderIcon,
  renderSecondaryAction,
  renderMenu,
  ariaLabel = "Resources",
  className,
}: AISidebarProps) {
  const [internalItems, setInternalItems] = useState(items ?? defaultItems);
  const [internalActiveId, setInternalActiveId] = useState(defaultActiveId);
  const [internalExpandedIds, setInternalExpandedIds] = useState(
    () => new Set(defaultExpandedIds),
  );
  const [focusedId, setFocusedId] = useState<string | null>(
    activeId ?? defaultActiveId,
  );
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const movePendingRef = useRef(false);
  const renderedItems = internalItems;
  const selectedId = activeId ?? internalActiveId;
  const expandedIds = useMemo(
    () =>
      controlledExpandedIds === undefined
        ? internalExpandedIds
        : new Set(controlledExpandedIds),
    [controlledExpandedIds, internalExpandedIds],
  );

  useEffect(() => {
    if (items) setInternalItems(items);
  }, [items]);

  useEffect(() => {
    if (controlledExpandedIds !== undefined) return;
    if (defaultExpandedIds.length === 0) return;
    setInternalExpandedIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of defaultExpandedIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [controlledExpandedIds, defaultExpandedIds]);

  const flat = useMemo(
    () => flattenResources(renderedItems, expandedIds),
    [expandedIds, renderedItems],
  );

  useEffect(() => {
    if (focusedId && flat.some((row) => row.item.id === focusedId)) return;
    setFocusedId(flat[0]?.item.id ?? null);
  }, [flat, focusedId]);

  useEffect(() => {
    if (!menuOpenId) return;
    const frame = requestAnimationFrame(() => {
      const menus = Array.from(
        document.querySelectorAll<HTMLElement>("[data-sidebar-resource-menu]"),
      );
      menus
        .find((menu) => menu.dataset.sidebarResourceMenu === menuOpenId)
        ?.querySelector<HTMLElement>("button, a[href]")
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menuOpenId]);

  const updateItems = useCallback(
    (next: SidebarResource[]) => {
      setInternalItems(next);
      onItemsChange?.(next);
    },
    [onItemsChange],
  );

  const performMove = useCallback(
    async (move: SidebarResourceMove) => {
      if (movePendingRef.current) {
        setAnnouncement("Wait for the current move to finish.");
        return;
      }
      const before = renderedItems;
      const next = moveResource(before, move);
      if (!next || next === before) return;

      movePendingRef.current = true;
      updateItems(next);
      setDropTarget(null);
      setDraggingId(null);
      const moved = findResource(before, move.itemId);
      const target = move.targetId ? findResource(before, move.targetId) : null;
      setAnnouncement(
        target
          ? `Moved ${moved?.label ?? "item"} ${move.position} ${target.label}.`
          : `Moved ${moved?.label ?? "item"} to the top level.`,
      );

      try {
        await onMove?.(move);
      } catch (error) {
        updateItems(before);
        setAnnouncement(`Move failed. ${moved?.label ?? "Item"} was restored.`);
        onMoveError?.(error, move);
      } finally {
        movePendingRef.current = false;
      }
    },
    [onMove, onMoveError, renderedItems, updateItems],
  );

  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }, []);

  const select = useCallback(
    (id: string) => {
      if (activeId === undefined) setInternalActiveId(id);
      onActiveChange?.(id);
    },
    [activeId, onActiveChange],
  );

  const updateExpandedIds = useCallback(
    (update: (current: Set<string>) => Set<string>) => {
      const next = update(new Set(expandedIds));
      if (controlledExpandedIds === undefined) setInternalExpandedIds(next);
      onExpandedIdsChange?.([...next]);
    },
    [controlledExpandedIds, expandedIds, onExpandedIdsChange],
  );

  const toggle = useCallback((id: string) => {
    updateExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [updateExpandedIds]);

  const handleKeyDown = useResourceKeyboardNavigation({
    expandedIds,
    flat,
    focusRow,
    onContainerSelect,
    performMove,
    select,
    setMenuOpenId,
    setRenamingId,
    toggle,
    updateExpandedIds,
  })

  return (
    <ResourceList
      flat={flat}
      selectedId={selectedId}
      activeContainerId={activeContainerId}
      expandedIds={expandedIds}
      focusedId={focusedId}
      draggingId={draggingId}
      dropTarget={dropTarget}
      menuOpenId={menuOpenId}
      renamingId={renamingId}
      allowMove={allowMove}
      announcement={announcement}
      ariaLabel={ariaLabel}
      className={className}
      renderIcon={renderIcon}
      renderSecondaryAction={renderSecondaryAction}
      renderMenu={renderMenu}
      onFocus={setFocusedId}
      onSelect={select}
      onContainerSelect={(id) => {
        if (onContainerSelect) onContainerSelect(id);
        else toggle(id);
      }}
      onKeyDown={handleKeyDown}
      onRenameStart={setRenamingId}
      onRenameCancel={() => setRenamingId(null)}
      onRenameCommit={(row, label) => {
        const trimmed = label.trim();
        setRenamingId(null);
        if (!trimmed || trimmed === row.item.label) return;
        const before = renderedItems;
        updateItems(renameResource(before, row.item.id, trimmed));
        void Promise.resolve(onRename?.(row.item, trimmed)).catch(() => {
          updateItems(before);
          setAnnouncement(`Rename failed. ${row.item.label} was restored.`);
        });
      }}
      onMenuOpenChange={(id, open) => {
        setMenuOpenId(open ? id : null);
        if (!open) focusRow(id);
      }}
      onDragStart={(event, id) => {
        setDraggingId(id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      }}
      onDragEnd={() => {
        setDraggingId(null);
        setDropTarget(null);
      }}
      onDragOver={(event, targetRow) => {
        if (!draggingId || draggingId === targetRow.item.id) return;
        const source = findResource(renderedItems, draggingId);
        if (source && containsResource(source, targetRow.item.id)) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientY - rect.top) / rect.height;
        const position =
          !targetRow.item.disabled &&
          canContain(targetRow.item) &&
          ratio >= 0.25 &&
          ratio <= 0.75
            ? "inside"
            : ratio < 0.5
              ? "before"
              : "after";
        setDropTarget({ id: targetRow.item.id, position });
      }}
      onRootDragOver={(event) => {
        if (!draggingId || event.target !== event.currentTarget) return;
        event.preventDefault();
        setDropTarget({ id: null, position: "after" });
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (draggingId && dropTarget) {
          void performMove({
            itemId: draggingId,
            targetId: dropTarget.id,
            position: dropTarget.position,
          });
        }
      }}
      setRef={(id, node) => {
        if (node) rowRefs.current.set(id, node);
        else rowRefs.current.delete(id);
      }}
    />
  );
}
