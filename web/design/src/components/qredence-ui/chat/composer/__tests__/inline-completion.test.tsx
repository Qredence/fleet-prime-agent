import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	type EditingState,
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

function context(overrides: Partial<InlineCompletionContext> = {}): InlineCompletionContext {
	const base: InlineCompletionContext = {
		completion: { forValue: "ship", text: " it now" },
		value: "ship",
		editing: { ...READY, caretStart: 4, caretEnd: 4 },
		streaming: false,
		disabled: false,
		triggerOpen: false,
		intentSuggestion: false,
		dismissed: undefined,
	};
	return { ...base, ...overrides };
}

describe("resolveInlineCompletion", () => {
	it("offers the text when everything lines up", () => {
		expect(resolveInlineCompletion(context())).toEqual({ text: " it now" });
	});

	it.each<[string, Partial<InlineCompletionContext>]>([
		["no completion at all", { completion: undefined }],
		["a completion for an older draft", { completion: { forValue: "shi", text: " it now" } }],
		["empty text", { completion: { forValue: "ship", text: "" } }],
		["whitespace-only text", { completion: { forValue: "ship", text: "   " } }],
		["text already present", { completion: { forValue: "ship", text: "ship" }, value: "ship ship" }],
		["an empty draft", { value: "", completion: { forValue: "", text: " something" } }],
		["a run in flight", { streaming: true }],
		["a disabled composer", { disabled: true }],
		["an open trigger menu", { triggerOpen: true }],
		["a command suggestion chip", { intentSuggestion: true }],
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
					completion: { forValue: "ship it", text: " now" },
					editing: { ...READY, caretStart: 7, caretEnd: 7 },
				}),
			),
		).toEqual({ text: " now" });
	});
});

describe("spliceCompletion", () => {
	it("appends the accepted text", () => {
		expect(spliceCompletion("ship", " it now")).toBe("ship it now");
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
		const textarea = screen.getByRole("combobox", { name: "Prompt" });
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
			inlineCompletion: { forValue: "ship", text: " it now" },
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
		expect(measure?.textContent).toBe("ship​");
	});

	it("keeps the textarea, the measurement node and the mirror on one metric recipe", () => {
		renderComposer({
			inlineCompletion: { forValue: "ship", text: " it now" },
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
		const textarea = screen.getByRole("combobox", { name: "Prompt" }) as HTMLTextAreaElement;
		// happy-dom focuses nothing by default; the ghost is gated on focus.
		textarea.focus();
		fireEvent.focus(textarea);
		return { onChange, textarea };
	}

	it("accepts the ghost into the draft", () => {
		const { onChange, textarea } = setup({ forValue: "ship", text: " it now" });
		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(onChange).toHaveBeenCalledWith("ship it now");
	});

	it("leaves Tab alone when nothing is offered", () => {
		const { onChange, textarea } = setup(undefined);
		fireEvent.keyDown(textarea, { key: "Tab" });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("leaves Shift+Tab to focus navigation", () => {
		const { onChange, textarea } = setup({ forValue: "ship", text: " it now" });
		fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("dismisses on Escape without touching the draft or re-offering", () => {
		const onDismiss = vi.fn();
		const { onChange, textarea } = setup({ forValue: "ship", text: " it now", onDismiss });
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
				inlineCompletion={{ forValue: "/set", text: "tings" }}
				controlled={{ value: "/set", onChange }}
			/>,
		);
		const textarea = screen.getByRole("combobox", { name: "Prompt" });
		textarea.focus();
		fireEvent.focus(textarea);
		fireEvent.keyDown(textarea, { key: "Tab" });
		// The popover's selection wins; the ghost is never appended to a slash draft.
		expect(onChange).not.toHaveBeenCalledWith("/settings");
		expect(onChange).not.toHaveBeenCalledWith("/settings" + "tings");
	});
});
