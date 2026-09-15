import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInputBarState } from "./input-bar-state";

describe("useInputBarState", () => {
	it("opens the slash menu by inserting / through the same value path as typing", () => {
		const onSend = vi.fn();
		const { result } = renderHook(() =>
			useInputBarState({
				models: [],
				status: "ready",
				onModelChange: vi.fn(),
				onSend,
				slashCommands: [{ id: "settings", label: "/settings", value: "/settings" }],
			}),
		);

		expect(result.current.triggerOpen).toBe(false);

		act(() => {
			result.current.openSlashMenu();
		});

		expect(result.current.value).toBe("/");
		expect(result.current.triggerKind).toBe("slash");
		expect(result.current.triggerOpen).toBe(true);
	});

	it("does not replace an existing slash query when reopening the menu", () => {
		const { result } = renderHook(() =>
			useInputBarState({
				models: [],
				status: "ready",
				onModelChange: vi.fn(),
				onSend: vi.fn(),
				slashCommands: [{ id: "settings", label: "/settings", value: "/settings" }],
				controlled: { value: "/set", onChange: vi.fn() },
			}),
		);

		act(() => {
			result.current.openSlashMenu();
		});

		expect(result.current.triggerKind).toBe("slash");
	});
});
