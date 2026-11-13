import { Command as CommandIcon, File, Folder } from "lucide-react";
import { memo, useCallback, useId, useMemo, useState } from "react";
import type { InputBarProps } from "@/components/chat/composer/input-bar";
import type { SuggestionItem } from "@/components/chat/types";
import { Popover, PopoverContent, type PopoverOpenChangeDetails } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Matching for the composer's two trigger tokens, plus the option ids the
 * trigger list needs.
 *
 * Plain functions rather than hooks: the caller already memoises the `items`
 * array, and these are pure filters over it. They work on `SuggestionItem`
 * directly, so the composer no longer converts its suggestions into a second
 * shape only to convert the matches back.
 */

/** Stable DOM id for a trigger option, so `aria-activedescendant` can name it. */
function composerOptionId(listId: string, itemId: string): string {
	return `${listId}-${itemId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** The command token an item offers: `/name arg` becomes `name`. */
function suggestionCommandName(item: SuggestionItem): string {
	return (item.value ?? item.id).trim().replace(/^\/+/, "").split(/\s+/, 1)[0] ?? item.id;
}

/** The argument hint an item advertises, from metadata or an inline `/name hint` value. */
function suggestionArgumentHint(item: SuggestionItem): string | undefined {
	const fromMetadata = item.metadata?.argumentHint?.trim();
	if (fromMetadata) return fromMetadata;
	const value = item.value?.trim() ?? "";
	return value.match(/^\/\S+\s+(.+)$/)?.[1];
}

/** Commands whose name starts with the slash query, or none when not typing one. */
function matchSlashCommands(value: string, items: readonly SuggestionItem[]): SuggestionItem[] {
	if (!value.startsWith("/")) return [];
	const query = value.slice(1).toLowerCase();
	return items.filter((item) => suggestionCommandName(item).toLowerCase().startsWith(query));
}

/** Items matching a trailing @mention, or none when the caret is not in one. */
function matchWorkspaceMentions(value: string, items: readonly SuggestionItem[]): SuggestionItem[] {
	const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
	if (!match) return [];
	const query = (match[1] ?? "").toLowerCase();
	return items.filter((item) =>
		[item.label, item.id, item.value, item.description].filter(Boolean).join(" ").toLowerCase().includes(query),
	);
}

/**
 * Replaces the trigger token that produced a match with the item's insert text.
 *
 * @param value - The live draft.
 * @param match - The trigger match to drop, from the caller's own regex.
 */
function removeTriggerToken(value: string, match: RegExpMatchArray | null): string {
	if (!match) return value;
	const leadingWhitespace = match[0].length - match[0].trimStart().length;
	return value.slice(0, value.length - match[0].length + leadingWhitespace);
}

const GROUP_LABELS: Record<string, string> = {
	builtin: "Built-in",
	extension: "Extensions",
	prompt: "Prompts",
	skill: "Skills",
};

function suggestionItems(config: InputBarProps["slashCommands"]): Array<SuggestionItem> {
	if (!config) return [];
	return Array.isArray(config) ? config : config.items;
}

/** Groups the filtered commands by their category, in catalog order. */
function buildCommandGroups(commands: Array<SuggestionItem>): Array<ComposerTriggerGroup> {
	const groups = new Map<string, Array<SuggestionItem>>();
	for (const item of commands) {
		const category = item.category ?? "builtin";
		const group = groups.get(category) ?? [];
		group.push(item);
		groups.set(category, group);
	}
	return [...groups.entries()].map(([id, group]) => ({
		id,
		label: GROUP_LABELS[id] ?? id,
		items: group.map((item) => ({
			...item,
			description: [item.description, suggestionArgumentHint(item)].filter(Boolean).join(" · "),
		})),
	}));
}

/**
 * Owns the `/` and `@` trigger menus.
 *
 * One menu at a time: the latest token in the draft decides which. `@` wins over
 * `/` because a mention can only be trailing, while a pinned slash menu can stay
 * open behind typed text.
 */
export function useComposerTriggers({
	value,
	setValue,
	slashCommands,
	workspaceSuggestions,
	onSlashCommandSelect,
	onWorkspaceReferenceSelect,
	disabled,
	streaming,
	onOpen,
}: {
	value: string;
	setValue: (next: string) => void;
	slashCommands: InputBarProps["slashCommands"];
	workspaceSuggestions: InputBarProps["workspaceSuggestions"];
	onSlashCommandSelect: InputBarProps["onSlashCommandSelect"];
	onWorkspaceReferenceSelect: InputBarProps["onWorkspaceReferenceSelect"];
	disabled: boolean | undefined;
	streaming: boolean;
	onOpen?: (trigger: ComposerTriggerKind) => void;
}) {
	const listId = useId();
	const blocked = streaming || disabled;
	const [slashMenuPinned, setSlashMenuPinned] = useState(false);
	const commands = suggestionItems(slashCommands);
	const workspaceItems = suggestionItems(workspaceSuggestions);

	const slashMatch = value.match(/^\/([^\s/]*)$/);
	const workspaceMentionMatch = value.match(/(?:^|\s)@([^\s@]*)$/);
	const slashMenuActive = slashMenuPinned && !blocked;
	const slashQuery = slashMatch?.[1]?.toLowerCase() ?? (slashMenuActive ? "" : undefined);
	const workspaceQuery = workspaceMentionMatch?.[1]?.toLowerCase();
	const kind: ComposerTriggerKind | undefined =
		workspaceQuery !== undefined ? "mention" : slashMatch || slashMenuActive ? "slash" : undefined;

	const filteredCommands = useMemo(() => {
		if (slashMenuActive && !value.startsWith("/")) return commands;
		return matchSlashCommands(value, commands);
	}, [commands, slashMenuActive, value]);
	const filteredWorkspaceItems = useMemo(() => matchWorkspaceMentions(value, workspaceItems), [value, workspaceItems]);

	const commandGroups = useMemo(
		() => (kind === "slash" ? buildCommandGroups(filteredCommands) : []),
		[filteredCommands, kind],
	);

	const items = useMemo(
		() => (kind === "slash" ? commandGroups.flatMap((group) => group.items) : filteredWorkspaceItems),
		[commandGroups, filteredWorkspaceItems, kind],
	);

	// Selection resets whenever the menu's identity changes (kind, query, or
	// result count), so a stale index can never point past the new list. Stored
	// as a keyed value rather than adjusted in an effect.
	const query = kind === "slash" ? slashQuery : workspaceQuery;
	const menuEpoch = `${kind}\0${query}\0${items.length}`;
	const [selection, setSelection] = useState({ epoch: menuEpoch, index: 0 });
	const activeIndex = selection.epoch === menuEpoch ? Math.min(selection.index, Math.max(0, items.length - 1)) : 0;
	const setActiveIndex = useCallback((index: number) => setSelection({ epoch: menuEpoch, index }), [menuEpoch]);

	const close = useCallback(() => {
		if (slashMenuPinned) {
			setSlashMenuPinned(false);
			return;
		}
		const match = kind === "mention" ? workspaceMentionMatch : slashMatch;
		if (match) setValue(removeTriggerToken(value, match));
	}, [kind, setValue, slashMatch, slashMenuPinned, value, workspaceMentionMatch]);

	const selectItem = useCallback(
		(item: SuggestionItem) => {
			if (item.disabled) return;
			setSlashMenuPinned(false);
			if (kind === "mention") {
				onWorkspaceReferenceSelect?.(item);
				setValue(removeTriggerToken(value, workspaceMentionMatch));
				return;
			}
			setValue(onSlashCommandSelect?.(item) === true ? "" : (item.value ?? item.label));
		},
		[kind, onSlashCommandSelect, onWorkspaceReferenceSelect, setValue, value, workspaceMentionMatch],
	);

	const openSlashMenu = useCallback(() => {
		if (blocked) return;
		setSlashMenuPinned(true);
		setSelection({ epoch: menuEpoch, index: 0 });
		onOpen?.("slash");
	}, [blocked, menuEpoch, onOpen]);

	const activeItem = items[activeIndex];
	return {
		listId,
		activeDescendant: activeItem ? composerOptionId(listId, activeItem.id) : undefined,
		kind,
		query,
		open: Boolean(kind && !blocked),
		items,
		commandGroups,
		activeIndex,
		setActiveIndex,
		openSlashMenu,
		close,
		selectItem,
	};
}

export type ComposerTriggerKind = "slash" | "mention";

export type ComposerTriggerGroup = {
	id: string;
	label: string;
	items: readonly SuggestionItem[];
};

export type ComposerTriggerPopoverProps = {
	open: boolean;
	kind: ComposerTriggerKind;
	/** Closes the menu from outside it: Escape, outside press, or focus loss. */
	onOpenChange: (open: boolean) => void;
	/** The textarea the list is positioned against and driven from. */
	anchor: HTMLElement | null;
	query?: string;
	items: readonly SuggestionItem[];
	groups?: readonly ComposerTriggerGroup[];
	activeIndex?: number;
	onActiveIndexChange?: (index: number) => void;
	onSelect: (item: SuggestionItem) => void;
	listId: string;
};

function defaultIcon(kind: ComposerTriggerKind, item: SuggestionItem) {
	if (item.icon) return item.icon;
	if (kind === "mention") {
		return item.metadata?.kind === "folder" ? (
			<Folder aria-hidden="true" className="size-4" />
		) : (
			<File aria-hidden="true" className="size-4" />
		);
	}
	return <CommandIcon aria-hidden="true" className="size-4" />;
}

/**
 * The `/` and `@` suggestion list.
 *
 * Positioning, outside-press dismissal, Escape, and focus containment are the
 * popover's; the textarea keeps focus and drives the highlight through
 * `aria-activedescendant`, so this is a listbox the keyboard walks rather than
 * a focus trap. `initialFocus`/`finalFocus` are off for exactly that reason.
 */
export const ComposerTriggerPopover = memo(function ComposerTriggerPopover({
	open,
	kind,
	onOpenChange,
	anchor,
	query,
	items,
	groups,
	activeIndex = 0,
	onActiveIndexChange,
	onSelect,
	listId,
}: ComposerTriggerPopoverProps) {
	const title = kind === "slash" ? "Commands" : "Workspace references";
	// Each group's position in the flattened list, so a grouped render and the
	// keyboard walk agree on what index an item has.
	const groupOffsets = useMemo(() => {
		const offsets = new Map<string, number>();
		let offset = 0;
		for (const group of groups ?? []) {
			offsets.set(group.id, offset);
			offset += group.items.length;
		}
		return offsets;
	}, [groups]);

	/**
	 * The textarea is not a popover trigger (it must keep focus and own the
	 * highlight), so Base UI sees a press on it as an outside press. Cancel those:
	 * clicking the prompt while the menu is open keeps the menu open.
	 */
	const handleOpenChange = (nextOpen: boolean, details: PopoverOpenChangeDetails) => {
		if (!nextOpen && details.reason === "outside-press") {
			const target = details.event.target;
			if (target instanceof Node && anchor?.contains(target)) {
				details.cancel();
				return;
			}
		}
		onOpenChange(nextOpen);
	};

	const renderItem = (item: SuggestionItem, index: number) => {
		const selected = index === activeIndex;
		return (
			<button
				key={item.id}
				id={composerOptionId(listId, item.id)}
				type="button"
				role="option"
				tabIndex={-1}
				aria-selected={selected}
				disabled={item.disabled}
				data-active={selected ? "true" : undefined}
				onMouseDown={(event) => event.preventDefault()}
				onMouseEnter={() => onActiveIndexChange?.(index)}
				onClick={() => {
					if (!item.disabled) onSelect(item);
				}}
				className={cn(
					"flex min-h-10 w-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2 text-start text-body transition-colors",
					selected ? "bg-accent text-accent-foreground" : "hover:bg-foreground/[0.04]",
					item.disabled && "pointer-events-none opacity-50",
				)}
			>
				<span className="mt-0.5 shrink-0 text-muted-foreground">{defaultIcon(kind, item)}</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium">{item.label}</span>
					{item.description ? (
						<span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.description}</span>
					) : null}
				</span>
			</button>
		);
	};

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverContent
				anchor={anchor}
				side="top"
				align="start"
				sideOffset={8}
				initialFocus={false}
				finalFocus={false}
				id={listId}
				role="listbox"
				aria-label={title}
				data-slot="composer-trigger-popover"
				data-kind={kind}
				className="max-h-[min(42dvh,360px)] w-(--anchor-width) min-w-[16rem] gap-0 overflow-hidden p-0"
			>
				<div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
					<span className="font-medium">{title}</span>
					{query ? <span className="ms-auto max-w-[50%] truncate font-mono text-caption">{query}</span> : null}
				</div>
				<div className="max-h-[min(42dvh,360px)] overflow-y-auto overscroll-contain p-1.5">
					{items.length === 0 ? (
						<div className="px-3 py-6 text-center text-sm text-muted-foreground">No matching items</div>
					) : null}
					{(groups && groups.length > 0 ? groups : undefined)?.map((group) => (
						<div key={group.id} role="group" aria-label={group.label}>
							<div className="px-3 pb-1 pt-2 text-micro font-medium uppercase tracking-wide text-muted-foreground">
								{group.label}
							</div>
							{group.items.map((item, index) => renderItem(item, (groupOffsets.get(group.id) ?? 0) + index))}
						</div>
					))}
					{groups && groups.length > 0 ? null : items.map((item, index) => renderItem(item, index))}
				</div>
			</PopoverContent>
		</Popover>
	);
});
