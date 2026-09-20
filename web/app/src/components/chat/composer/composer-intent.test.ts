import type { ComposerIntentResponse } from "@prime-agent/web-protocol/composer-intent";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerIntentRouting } from "@/components/chat/composer/composer-intent";

/** The hook's debounce window. */
const DEBOUNCE_MS = 300;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function intentResponse(overrides: Partial<ComposerIntentResponse> = {}): ComposerIntentResponse {
	return { enabled: true, outcome: "matched", command: "compact", disposition: "suggest", ...overrides };
}

describe("useComposerIntentRouting", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

	/** Publishes a draft and flushes the debounce plus any pending response. */
	async function settle(result: { current: ReturnType<typeof useComposerIntentRouting> }, text: string) {
		await act(async () => {
			result.current.onDraftChange(text);
		});
		await act(async () => {
			vi.advanceTimersByTime(DEBOUNCE_MS);
		});
	}

	it("offers a suggest-band match as a command", async () => {
		mockFetch().mockResolvedValue(jsonResponse(intentResponse({ disposition: "suggest" })));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		expect(result.current.command).toEqual({ forValue: "make this shorter", command: "compact" });
	});

	it("offers an execute-band match too: the ghost must precede the run Enter will make", async () => {
		mockFetch().mockResolvedValue(jsonResponse(intentResponse({ disposition: "execute" })));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		expect(result.current.command).toEqual({ forValue: "make this shorter", command: "compact" });
	});

	it("offers nothing when nothing matched", async () => {
		mockFetch().mockResolvedValue(jsonResponse({ enabled: true, outcome: "none" }));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "an ordinary engineering question");
		expect(result.current.command).toBeUndefined();
	});

	it("offers nothing for a command outside the catalog", async () => {
		mockFetch().mockResolvedValue(jsonResponse(intentResponse({ command: "does-not-exist" })));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		expect(result.current.command).toBeUndefined();
	});

	it("drops an offer that arrives after the draft moved on", async () => {
		let release: (() => void) | undefined;
		mockFetch().mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () => resolve(jsonResponse(intentResponse()));
				}),
		);
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		await act(async () => {
			result.current.onDraftChange("something else entirely");
		});
		await act(async () => {
			release?.();
		});
		expect(result.current.command).toBeUndefined();
	});

	it("waits for the debounce before asking", async () => {
		mockFetch().mockResolvedValue(jsonResponse(intentResponse()));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await act(async () => {
			result.current.onDraftChange("make this shorter");
		});
		await act(async () => {
			vi.advanceTimersByTime(DEBOUNCE_MS - 1);
		});
		expect(mockFetch()).not.toHaveBeenCalled();
		await act(async () => {
			vi.advanceTimersByTime(1);
		});
		expect(mockFetch()).toHaveBeenCalledTimes(1);
	});

	it("resolves a repeated draft from the cache without asking again", async () => {
		mockFetch().mockResolvedValue(jsonResponse(intentResponse()));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		await act(async () => {
			result.current.onDraftChange("make   this shorter");
		});
		expect(result.current.command).toEqual({ forValue: "make   this shorter", command: "compact" });
		expect(mockFetch()).toHaveBeenCalledTimes(1);
	});

	it("never classifies drafts the composer owns", async () => {
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await act(async () => {
			result.current.onDraftChange("/compact");
			result.current.onDraftChange("@src/lib");
			result.current.onDraftChange("hi");
		});
		await act(async () => {
			vi.advanceTimersByTime(DEBOUNCE_MS);
		});
		expect(mockFetch()).not.toHaveBeenCalled();
		expect(result.current.command).toBeUndefined();
	});

	it("returns only an execution-band match from takeCached", async () => {
		mockFetch().mockResolvedValue(jsonResponse(intentResponse({ disposition: "execute" })));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		const response = result.current.takeCached("make this shorter");
		expect(response).toMatchObject({ outcome: "matched", command: "compact", disposition: "execute" });

		mockFetch().mockResolvedValue(jsonResponse(intentResponse({ disposition: "suggest" })));
		const { result: suggest } = renderHook(() => useComposerIntentRouting(true));
		await settle(suggest, "make this shorter");
		expect(suggest.current.takeCached("make this shorter")).toBeNull();
		expect(suggest.current.takeCached("never classified")).toBeNull();
	});

	it("dismissCommand clears the offer and suppresses execute for that draft", async () => {
		mockFetch().mockResolvedValue(jsonResponse(intentResponse({ disposition: "execute" })));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		expect(result.current.command).toEqual({ forValue: "make this shorter", command: "compact" });
		expect(result.current.takeCached("make this shorter")).not.toBeNull();

		await act(async () => {
			result.current.dismissCommand();
		});
		expect(result.current.command).toBeUndefined();
		expect(result.current.takeCached("make this shorter")).toBeNull();

		// Same normalized draft from cache must not revive the offer or execute.
		await act(async () => {
			result.current.onDraftChange("make   this shorter");
		});
		expect(result.current.command).toBeUndefined();
		expect(result.current.takeCached("make   this shorter")).toBeNull();
	});

	it("lifts execute suppress once the draft changes", async () => {
		mockFetch()
			.mockResolvedValueOnce(jsonResponse(intentResponse({ disposition: "execute" })))
			.mockResolvedValueOnce(jsonResponse(intentResponse({ disposition: "execute", command: "compact" })));
		const { result } = renderHook(() => useComposerIntentRouting(true));
		await settle(result, "make this shorter");
		await act(async () => {
			result.current.dismissCommand();
		});

		await settle(result, "compact the context please");
		expect(result.current.command).toEqual({ forValue: "compact the context please", command: "compact" });
		expect(result.current.takeCached("compact the context please")).not.toBeNull();
	});

	it("re-asks for a draft typed before availability resolved", async () => {
		// Availability is checked server-side while the composer keeps whatever was
		// already typed, and no keystroke follows the flip — so without the re-ask a
		// draft typed during the check would never be classified at all.
		mockFetch().mockResolvedValue(jsonResponse(intentResponse()));
		const { result, rerender } = renderHook(
			({ available }: { available: boolean }) => useComposerIntentRouting(available),
			{ initialProps: { available: false } },
		);
		await settle(result, "make this shorter");
		expect(mockFetch()).not.toHaveBeenCalled();

		rerender({ available: true });
		await act(async () => {
			vi.advanceTimersByTime(DEBOUNCE_MS);
		});
		expect(mockFetch()).toHaveBeenCalledTimes(1);
		expect(result.current.command).toEqual({ forValue: "make this shorter", command: "compact" });
	});

	it("makes no request and answers nothing when routing is unavailable", async () => {
		const { result } = renderHook(() => useComposerIntentRouting(false));
		await settle(result, "make this shorter");
		expect(mockFetch()).not.toHaveBeenCalled();
		expect(result.current.command).toBeUndefined();
		expect(result.current.takeCached("make this shorter")).toBeNull();
	});
});
