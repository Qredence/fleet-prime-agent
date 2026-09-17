import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInputBarState } from "./input-bar-state";

const slashCommands = [{ id: "settings", label: "/settings", value: "/settings" }];

describe("useInputBarState", () => {
	it("opens the slash menu from plus without inserting a slash", () => {
		const onSend = vi.fn();
		const { result } = renderHook(() =>
			useInputBarState({
				models: [],
				status: "ready",
				onModelChange: vi.fn(),
				onSend,
				slashCommands,
			}),
		);

		expect(result.current.triggerOpen).toBe(false);
		expect(result.current.value).toBe("");

		act(() => {
			result.current.openSlashMenu();
		});

		expect(result.current.value).toBe("");
		expect(result.current.triggerKind).toBe("slash");
		expect(result.current.triggerOpen).toBe(true);
	});

	it("opens the slash menu when the prompt value starts with a slash", () => {
		const { result, rerender } = renderHook(
			({ controlledValue }: { controlledValue: string }) =>
				useInputBarState({
					models: [],
					status: "ready",
					onModelChange: vi.fn(),
					onSend: vi.fn(),
					slashCommands,
					controlled: { value: controlledValue, onChange: vi.fn() },
				}),
			{ initialProps: { controlledValue: "" } },
		);

		rerender({ controlledValue: "/" });

		expect(result.current.value).toBe("/");
		expect(result.current.triggerKind).toBe("slash");
		expect(result.current.triggerOpen).toBe(true);
	});

	it("closes the pinned slash menu on outside click", () => {
		const { result } = renderHook(() =>
			useInputBarState({
				models: [],
				status: "ready",
				onModelChange: vi.fn(),
				onSend: vi.fn(),
				slashCommands,
			}),
		);

		act(() => {
			result.current.openSlashMenu();
		});
		expect(result.current.triggerOpen).toBe(true);

		act(() => {
			document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
		});

		expect(result.current.triggerOpen).toBe(false);
		expect(result.current.value).toBe("");
	});

	it("keeps the slash menu open when clicking the prompt textarea", () => {
		const prompt = document.createElement("textarea");
		prompt.id = "composer-prompt";
		document.body.appendChild(prompt);

		const { result } = renderHook(() =>
			useInputBarState({
				models: [],
				status: "ready",
				onModelChange: vi.fn(),
				onSend: vi.fn(),
				slashCommands,
			}),
		);

		act(() => {
			result.current.openSlashMenu();
		});

		act(() => {
			prompt.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
		});

		expect(result.current.triggerOpen).toBe(true);
		prompt.remove();
	});
});
