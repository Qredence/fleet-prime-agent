"use client";

import type { LucideIcon } from "lucide-react";
import { type ComponentProps, useMemo } from "react";
import { field, floating } from "@/lib/surfaces";
import { cn } from "@/lib/utils";

export interface ComposerCommand {
	name: string;
	description: string;
	icon: LucideIcon;
}

export interface ComposerPerson {
	name: string;
	role: "agent" | "human";
	id?: string;
	path?: string;
	kind?: "file" | "folder";
	description?: string;
}

/** Commands whose name starts with the slash query, or none when not typing one. */
export function useSlashMatches(value: string, commands: readonly ComposerCommand[] | undefined): ComposerCommand[] {
	return useMemo(() => {
		if (!commands || !value.startsWith("/")) return [];
		const query = value.slice(1).toLowerCase();
		return commands.filter((command) => command.name.startsWith(query));
	}, [commands, value]);
}

/** People matching a trailing @mention, or none when the caret is not in one. */
export function useMentionMatches(value: string, people: readonly ComposerPerson[] | undefined): ComposerPerson[] {
	return useMemo(() => {
		if (!people) return [];
		const match = /(?:^|\s)@([^\s@]*)$/.exec(value);
		if (!match) return [];
		const query = match[1]?.toLowerCase() ?? "";
		return people.filter((person) => {
			const haystack = [person.name, person.id, person.path, person.description]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
			return haystack.includes(query);
		});
	}, [people, value]);
}

export function ComposerMenu({
	open,
	align = "start",
	className,
	...props
}: ComponentProps<"div"> & { open: boolean; align?: "start" | "end" }) {
	return (
		<div
			data-slot="composer-menu"
			data-open={open || undefined}
			className={cn(
				floating,
				"absolute bottom-full z-10 mb-2 flex w-72 flex-col gap-0.5 rounded-2xl p-1.5",
				align === "start" ? "start-0 origin-bottom-left" : "end-0 origin-bottom-right",
				"transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
				open ? "scale-100 opacity-100" : "pointer-events-none scale-[0.97] opacity-0",
				className,
			)}
			{...props}
		/>
	);
}

export function ComposerMenuItem({
	active = false,
	className,
	...props
}: ComponentProps<"button"> & { active?: boolean }) {
	return (
		<button
			type="button"
			data-slot="composer-menu-item"
			data-active={active || undefined}
			// The listbox is driven from the textarea via aria-activedescendant, so
			// its items must not be tab stops. Without this, Tab out of an open menu
			// lands focus inside the popover chrome.
			tabIndex={-1}
			className={cn(
				"flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-body transition-colors",
				active ? field : "hover:bg-foreground/[0.04]",
				className,
			)}
			{...props}
		/>
	);
}
