import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	type EditingState,
	ghostPaintText,
	INITIAL_EDITING_STATE,
	type InlineCompletion,
	type InlineCompletionContext,
	PROMPT_TEXT_METRICS,
	resolveInlineCompletion,
	sameEditingState,
	spliceCompletion,
} from "../inline-completion";
import { InputBar } from "../input-bar";

const READY: EditingState = { focused: true, composing: false, caretStart: 4, caretEnd: 4 };

/** A history completion, which extends the draft. */
function append(forValue: string, text: string, rest: Partial<InlineCompletion> = {}): InlineCompletion {
	return { forValue, text, mode: "append", ...rest };
}

/** A recognised command, which does not. */
function replace(forValue: string, text: string, rest: Partial<InlineCompletion> = {}): InlineCompletion {
	return { forValue, text, mode: "replace", ...rest };
}

function context(overrides: Partial<InlineCompletionContext> = {}): InlineCompletionContext {
	const base: InlineCompletionContext = {
		completion: append("ship", " it now"),
		value: "ship",
		editing: { ...READY, caretStart: 4, caretEnd: 4 },
		streaming: false,
		disabled: false,
		triggerOpen: false,
		dismissed: undefined,
	};
	return { ...base, ...overrides };
}

describe("resolveInlineCompletion", () => {
	it("offers the text when everything lines up", () => {
		expect(resolveInlineCompletion(context())).toEqual({ text: " it now", mode: "append" });
	});

	it("reports the mode it accepted, so the accept path cannot disagree", () => {
		expect(resolveInlineCompletion(context({ completion: replace("ship", "/compact") }))).toEqual({
			text: "/compact",
			mode: "replace",
		});
	});

	it("does not require a replacement to extend the draft", () => {
		// The history engine could never produce this; a command suggestion
		// always does, and it must not be rejected for that reason.
		const value = "make this shorter";
		const offered = resolveInlineCompletion(
			context({
				value,
				completion: replace(value, "/compact"),
				editing: { ...READY, caretStart: value.length, caretEnd: value.length },
			}),
		);
		expect(offered).toEqual({ text: "/compact", mode: "replace" });
	});

	it("still offers a replacement the draft merely ends with", () => {
		// The append guard is "already present: appending would duplicate it",
		// which cannot describe a replacement. A draft that happens to end with
		// the command is exactly the case replacing exists for, and the chip this
		// replaced had no such gate — so applying it here would silently take the
		// offer away.
		const value = "please run the /compact";
		const offered = resolveInlineCompletion(
			context({
				value,
				completion: replace(value, "/compact"),
				editing: { ...READY, caretStart: value.length, caretEnd: value.length },
			}),
		);
		expect(offered).toEqual({ text: "/compact", mode: "replace" });
		expect(spliceCompletion(value, offered!.text, offered!.mode)).toBe("/compact");
	});

	it.each<[string, Partial<InlineCompletionContext>]>([
		["no completion at all", { completion: undefined }],
		["a completion for an older draft", { completion: append("shi", " it now") }],
		["empty text", { completion: append("ship", "") }],
		["whitespace-only text", { completion: append("ship", "   ") }],
		["text already present", { completion: append("ship", "ship"), value: "ship ship" }],
		["an empty draft", { value: "", completion: append("", " something") }],
		["a run in flight", { streaming: true }],
		["a disabled composer", { disabled: true }],
		["an open trigger menu", { triggerOpen: true }],
		["this draft's completion already dismissed", { dismissed: { forValue: "ship", text: " it now" } }],
		["an unfocused composer", { editing: { ...READY, focused: false } }],
		["an IME composition", { editing: { ...READY, composing: true } }],
		["an unknown caret", { editing: { ...INITIAL_EDITING_STATE, focused: true } }],
		["a selection", { editing: { ...READY, caretStart: 1, caretEnd: 3 } }],
		["a caret before the end of the draft", { editing: { ...READY, caretStart: 2, caretEnd: 2 } }],
	])("offers nothing for %s", (_label, overrides) => {
		expect(resolveInlineCompletion(context(overrides))).toBeNull();
	});

	it("re-offers once the draft moves past a dismissal", () => {
		const dismissed: InlineCompletionContext["dismissed"] = { forValue: "ship", text: " it now" };
		expect(resolveInlineCompletion(context({ dismissed }))).toBeNull();
		// Typing on produces a fresh completion against the new draft, and the
		// latch on the old draft no longer applies.
		expect(
			resolveInlineCompletion(
				context({
					dismissed,
					value: "ship it",
					completion: append("ship it", " now"),
					editing: { ...READY, caretStart: 7, caretEnd: 7 },
				}),
			),
		).toEqual({ text: " now", mode: "append" });
	});
});

describe("spliceCompletion", () => {
	it("appends the accepted text", () => {
		expect(spliceCompletion("ship", " it now")).toBe("ship it now");
	});

	it("replaces the draft with an accepted command", () => {
		expect(spliceCompletion("make this shorter", "/compact", "replace")).toBe("/compact");
	});

	it("replaces without carrying the display separator into the draft", () => {
		expect(spliceCompletion("make this shorter", "/compact", "replace")).not.toContain(" ");
	});
});

describe("ghostPaintText", () => {
	it("paints an append completion flush against the draft", () => {
		expect(ghostPaintText("ship", { text: " it now", mode: "append" })).toBe(" it now");
	});

	it("separates a replacement from the draft it would replace", () => {
		expect(ghostPaintText("make this shorter", { text: "/compact", mode: "replace" })).toBe(" /compact");
	});

	it("does not double the separator on a draft already ending in whitespace", () => {
		expect(ghostPaintText("make this shorter ", { text: "/compact", mode: "replace" })).toBe("/compact");
	});

	it("paints nothing when there is nothing to paint", () => {
		expect(ghostPaintText("ship", null)).toBeUndefined();
	});
});

describe("sameEditingState", () => {
	it("compares by value so the caret publisher can skip no-op renders", () => {
		expect(sameEditingState(READY, { ...READY })).toBe(true);
		expect(sameEditingState(READY, { ...READY, caretStart: 5, caretEnd: 5 })).toBe(false);
		expect(sameEditingState(READY, { ...READY, composing: true })).toBe(false);
	});
});

describe("composer ghost layer", () => {
	function renderComposer(props: Partial<React.ComponentProps<typeof InputBar>> = {}) {
		return render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				placeholder="Send a message…"
				{...props}
			/>,
		);
	}

	/** The ghost is gated on focus, which happy-dom does not establish on render. */
	function focusComposer() {
		const textarea = screen.getByRole("textbox", { name: "Prompt" });
		textarea.focus();
		fireEvent.focus(textarea);
		return textarea;
	}

	it("does not mount the ghost layer when nothing is offered", () => {
		renderComposer();
		focusComposer();
		expect(document.querySelector('[data-slot="composer-ghost-layer"]')).toBeNull();
	});

	it("paints the ghost without putting it in the draft or the measured node", () => {
		const { container } = renderComposer({
			inlineCompletion: append("ship", " it now"),
			controlled: { value: "ship", onChange: vi.fn() },
		});
		const textarea = focusComposer() as HTMLTextAreaElement;

		const ghost = document.querySelector('[data-slot="composer-ghost"]');
		expect(ghost?.textContent).toBe(" it now");

		// The draft itself is untouched.
		expect(textarea.value).toBe("ship");

		// The layer is inert and hidden from assistive technology.
		expect(document.querySelector('[data-slot="composer-ghost-layer"]')?.getAttribute("aria-hidden")).toBe("true");
		expect(ghost?.className).toContain("text-foreground/55");

		// The auto-resize measurement must not see the ghost, or the composer grows
		// while the user types.
		const measure = container.querySelector('[data-slot="composer-measure"]');
		expect(measure?.textContent).toBe("ship\u200b");
	});

	it("paints a command ghost separated from the draft it would replace", () => {
		renderComposer({
			inlineCompletion: replace("make this shorter", "/compact"),
			controlled: { value: "make this shorter", onChange: vi.fn() },
		});
		focusComposer();
		expect(document.querySelector('[data-slot="composer-ghost"]')?.textContent).toBe(" /compact");
	});

	it("keeps the textarea, the measurement node and the mirror on one metric recipe", () => {
		renderComposer({
			inlineCompletion: append("ship", " it now"),
			controlled: { value: "ship", onChange: vi.fn() },
		});
		const textarea = focusComposer();
		const tokens = PROMPT_TEXT_METRICS.split(" ");
		const nodes = [
			textarea,
			document.querySelector('[data-slot="composer-measure"]'),
			document.querySelector('[data-slot="composer-ghost-mirror"]'),
		];
		for (const node of nodes) {
			expect(node).not.toBeNull();
			for (const token of tokens) expect(node?.className).toContain(token);
		}
	});

	it("hides the ghost for the duration of IME composition", () => {
		renderComposer({
			inlineCompletion: append("ship", " it now"),
			controlled: { value: "ship", onChange: vi.fn() },
		});
		const textarea = focusComposer();
		expect(document.querySelector('[data-slot="composer-ghost"]')?.textContent).toBe(" it now");

		fireEvent.compositionStart(textarea);
		expect(document.querySelector('[data-slot="composer-ghost-layer"]')).toBeNull();

		// Caret input during composition must not thrash editing state back to a painted ghost.
		fireEvent.input(textarea);
		fireEvent.keyUp(textarea, { key: "e" });
		expect(document.querySelector('[data-slot="composer-ghost-layer"]')).toBeNull();

		fireEvent.compositionEnd(textarea);
		expect(document.querySelector('[data-slot="composer-ghost"]')?.textContent).toBe(" it now");
	});
});

describe("Tab acceptance", () => {
	function setup(completion: InlineCompletion | undefined, value = "ship") {
		const onChange = vi.fn();
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				placeholder="Send a message…"
				inlineCompletion={completion}
				controlled={{ value, onChange }}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: "Prompt" }) as HTMLTextAreaElement;
		// happy-dom focuses nothing by default; the ghost is gated on focus.
		textarea.focus();
		fireEvent.focus(textarea);
		return { onChange, textarea };
	}

	it("accepts the ghost into the draft", () => {
		const { onChange, textarea } = setup(append("ship", " it now"));
		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(onChange).toHaveBeenCalledWith("ship it now");
	});

	it("replaces the draft when the ghost is a command", () => {
		const { onChange, textarea } = setup(replace("make this shorter", "/compact"), "make this shorter");
		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(onChange).toHaveBeenCalledWith("/compact");
		// The display separator must not survive into the draft.
		expect(onChange).not.toHaveBeenCalledWith(" /compact");
	});

	it("leaves Tab alone when nothing is offered", () => {
		const { onChange, textarea } = setup(undefined);
		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("leaves Shift+Tab to focus navigation", () => {
		const { onChange, textarea } = setup(append("ship", " it now"));
		fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("dismisses on Escape without touching the draft or re-offering", () => {
		const onDismiss = vi.fn();
		const { onChange, textarea } = setup(append("ship", " it now", { onDismiss }));
		fireEvent.keyDown(textarea, { key: "Escape" });
		expect(onDismiss).toHaveBeenCalled();
		expect(onChange).not.toHaveBeenCalled();
		// Still dismissed after another render with the identical offer.
		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("defers Tab to an open trigger menu", () => {
		const onChange = vi.fn();
		render(
			<InputBar
				modelKey={undefined}
				models={[]}
				onModelChange={vi.fn()}
				onSend={vi.fn()}
				onStop={vi.fn()}
				status="ready"
				placeholder="Send a message…"
				slashCommands={[{ id: "settings", label: "/settings", value: "/settings" }]}
				onSlashCommandSelect={vi.fn(() => true)}
				inlineCompletion={append("/set", "tings")}
				controlled={{ value: "/set", onChange }}
			/>,
		);
		const textarea = screen.getByRole("textbox", { name: "Prompt" });
		textarea.focus();
		fireEvent.focus(textarea);
		fireEvent.keyDown(textarea, { key: "Tab" });
		// The popover's selection wins; the ghost is never appended to a slash draft.
		expect(onChange).not.toHaveBeenCalledWith("/settings");
		expect(onChange).not.toHaveBeenCalledWith("/settings" + "tings");
	});
});
