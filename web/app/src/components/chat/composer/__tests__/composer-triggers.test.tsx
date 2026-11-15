import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SuggestionItem } from "@/lib/chat/types";
import { useComposerTriggers } from "@/components/chat/composer/composer-triggers";

const COMMANDS: Array<SuggestionItem> = [
	{ id: "settings", label: "/settings", value: "/settings", category: "builtin", description: "Open settings" },
	{ id: "review", label: "/review", value: "/review <path>", category: "builtin", description: "Review a file" },
	{ id: "compact", label: "/compact", value: "/compact", category: "prompt" },
];

const CONTACTS: Array<SuggestionItem> = [
	{ id: "src/a.ts", label: "a.ts", value: "src/a.ts", metadata: { kind: "file" } },
	{ id: "src/b.ts", label: "b.ts", value: "src/b.ts", metadata: { kind: "file" } },
	{ id: "docs", label: "docs", value: "docs", metadata: { kind: "folder" } },
];

/** The hook under test, driven by a live draft the caller owns. */
function renderTriggers(initialValue = "", overrides: Partial<Parameters<typeof useComposerTriggers>[0]> = {}) {
	return renderHook(
		({ initial }: { initial: string }) => {
			const [value, setValue] = useState(initial);
			const triggers = useComposerTriggers({
				value,
				setValue,
				slashCommands: COMMANDS,
				workspaceSuggestions: CONTACTS,
				onSlashCommandSelect: undefined,
				onWorkspaceReferenceSelect: undefined,
				disabled: false,
				streaming: false,
				...overrides,
			});
			return { value, setValue, triggers };
		},
		{ initialProps: { initial: initialValue } },
	);
}

describe("useComposerTriggers — slash", () => {
	it("opens on a leading slash and filters by what follows", () => {
		const { result } = renderTriggers("/");

		expect(result.current.triggers.kind).toBe("slash");
		expect(result.current.triggers.open).toBe(true);
		expect(result.current.triggers.items.map((item) => item.id)).toEqual(["settings", "review", "compact"]);

		act(() => result.current.setValue("/re"));

		expect(result.current.triggers.items.map((item) => item.id)).toEqual(["review"]);
	});

	it("groups commands by category and appends the argument hint", () => {
		const { result } = renderTriggers("/");

		const groups = result.current.triggers.commandGroups;
		expect(groups.map((group) => group.id)).toEqual(["builtin", "prompt"]);
		expect(groups[0]?.label).toBe("Built-in");
		expect(groups[0]?.items[1]?.description).toBe("Review a file · <path>");
	});

	it("opens the whole list from the plus control without typing a slash", () => {
		const onOpen = vi.fn();
		const { result } = renderTriggers("", { onOpen });

		expect(result.current.triggers.open).toBe(false);

		act(() => result.current.triggers.openSlashMenu());

		expect(onOpen).toHaveBeenCalledWith("slash");
		expect(result.current.value).toBe("");
		expect(result.current.triggers.kind).toBe("slash");
		expect(result.current.triggers.items).toHaveLength(COMMANDS.length);
	});

	it("keeps typed slash filtering when the menu is also pinned", () => {
		const { result } = renderTriggers("/rev");
		act(() => result.current.triggers.openSlashMenu());
		expect(result.current.triggers.kind).toBe("slash");
		expect(result.current.triggers.query).toBe("rev");
		expect(result.current.triggers.items.map((item) => item.id)).toEqual(["review"]);
		act(() => result.current.setValue("/review src/a.ts"));
		expect(result.current.triggers.items).toHaveLength(0);
		act(() => result.current.triggers.close());
		expect(result.current.value).toBe("/review src/a.ts");
		expect(result.current.triggers.open).toBe(false);
	});

	it("unpins a plus-opened list on close without touching the draft", () => {
		const { result } = renderTriggers();

		act(() => result.current.triggers.openSlashMenu());
		act(() => result.current.triggers.close());

		expect(result.current.triggers.open).toBe(false);
		expect(result.current.value).toBe("");
	});

	it("strips the typed token on close", () => {
		const { result } = renderTriggers("/rev");

		act(() => result.current.triggers.close());

		expect(result.current.value).toBe("");
		expect(result.current.triggers.open).toBe(false);
	});

	it("inserts the command's value and closes on selection", () => {
		const onSelect = vi.fn();
		const { result } = renderTriggers("/rev", { onSlashCommandSelect: onSelect });

		act(() => result.current.triggers.selectItem(result.current.triggers.items[0] as SuggestionItem));

		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "review" }));
		expect(result.current.value).toBe("/review <path>");
		expect(result.current.triggers.open).toBe(false);
	});

	it("lets the host consume a command and clears the draft instead", () => {
		const { result } = renderTriggers("/set", { onSlashCommandSelect: () => true });

		act(() => result.current.triggers.selectItem(result.current.triggers.items[0] as SuggestionItem));

		expect(result.current.value).toBe("");
	});

	it("stays closed while the composer is disabled or streaming", () => {
		for (const overrides of [{ disabled: true }, { streaming: true }]) {
			const { result } = renderTriggers("/", overrides);
			expect(result.current.triggers.open).toBe(false);
		}
	});
});

describe("useComposerTriggers — mention", () => {
	it("opens on a trailing mention and filters workspace items", () => {
		const { result } = renderTriggers("please read @");

		expect(result.current.triggers.kind).toBe("mention");
		expect(result.current.triggers.query).toBe("");
		expect(result.current.triggers.items).toHaveLength(CONTACTS.length);

		act(() => result.current.setValue("please read @b"));

		expect(result.current.triggers.items.map((item) => item.id)).toEqual(["src/b.ts"]);
	});

	it("matches a folder by its path as well as its label", () => {
		const { result } = renderTriggers("@doc");

		expect(result.current.triggers.items.map((item) => item.id)).toEqual(["docs"]);
	});

	it("does not treat a mid-word @ as a mention", () => {
		const { result } = renderTriggers("mail me at foo@bar");

		expect(result.current.triggers.kind).toBeUndefined();
	});

	it("reports the mention even when a slash was typed earlier", () => {
		const { result } = renderTriggers("/settings @a");

		expect(result.current.triggers.kind).toBe("mention");
	});

	it("removes the mention token on selection and keeps the rest of the draft", () => {
		const onSelect = vi.fn();
		const { result } = renderTriggers("read src/a.ts and @b", { onWorkspaceReferenceSelect: onSelect });

		act(() => result.current.triggers.selectItem(result.current.triggers.items[0] as SuggestionItem));

		expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "src/b.ts" }));
		expect(result.current.value).toBe("read src/a.ts and ");
	});
});

describe("useComposerTriggers — active index", () => {
	it("resets to the first item when the query changes", () => {
		const { result } = renderTriggers("/");

		act(() => result.current.triggers.setActiveIndex(2));
		expect(result.current.triggers.activeIndex).toBe(2);

		act(() => result.current.setValue("/r"));

		expect(result.current.triggers.activeIndex).toBe(0);
	});

	it("clamps an index past the end of a shrinking list", () => {
		const { result } = renderTriggers("/");

		act(() => result.current.triggers.setActiveIndex(2));
		// Same epoch is not guaranteed, so force the shrink without a new query.
		act(() => result.current.triggers.setActiveIndex(99));

		expect(result.current.triggers.activeIndex).toBe(COMMANDS.length - 1);
	});
});
