import { COMPOSER_COMPLETION_MAX_CHARS, composerCompletionGhost } from "@prime-agent/web-protocol/composer-completion";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerInlineCompletion } from "@/components/chat/composer/composer-inline-completion";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("useComposerInlineCompletion", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

	it("offers a ghost suffix measured against the server's normalised draft", async () => {
		// The server matches and returns in normalised form, so the client must
		// measure the suffix the same way. Typing irregular spacing here is the
		// case that breaks naive `completion.slice(draft.length)`.
		mockFetch().mockResolvedValue(jsonResponse({ completion: "refactor the auth middleware and add tests" }));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("refactor   the auth");

		await waitFor(() => expect(result.current.inlineCompletion).toBeDefined());
		const offer = result.current.inlineCompletion;
		expect(offer?.forValue).toBe("refactor   the auth");
		// The suffix must extend the normalised draft without duplicating any of it.
		expect(offer?.text).toBe(" middleware and add tests");
		expect(`${offer?.forValue}${offer?.text}`).not.toContain("auth  ");
		// And the protocol's own ghost check agrees with what we handed over.
		expect(composerCompletionGhost("refactor   the auth", "refactor the auth middleware and add tests")).toBe(
			offer?.text,
		);
	});

	it("keeps the offered text inside the server's cap", async () => {
		const long = `deploy ${"x".repeat(COMPOSER_COMPLETION_MAX_CHARS)}`;
		mockFetch().mockResolvedValue(jsonResponse({ completion: long }));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("deploy");
		await waitFor(() => expect(result.current.inlineCompletion).toBeDefined());
		expect(result.current.inlineCompletion?.text.length).toBeLessThanOrEqual(COMPOSER_COMPLETION_MAX_CHARS + 1);
	});

	it("never asks for a draft the trigger popovers own", async () => {
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("/sett");
		result.current.onDraftChange("look at @src/lib");
		result.current.onDraftChange("hi");
		await Promise.resolve();
		expect(mockFetch()).not.toHaveBeenCalled();
		expect(result.current.inlineCompletion).toBeUndefined();
	});

	it("makes no request when the host has completions switched off", async () => {
		const { result } = renderHook(() => useComposerInlineCompletion({ available: false }));
		result.current.onDraftChange("refactor the auth middleware");
		await Promise.resolve();
		expect(mockFetch()).not.toHaveBeenCalled();
		expect(result.current.inlineCompletion).toBeUndefined();
	});

	it("drops an offer that arrives after the draft moved on", async () => {
		let release: (() => void) | undefined;
		mockFetch().mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					release = () => resolve(jsonResponse({ completion: "refactor the auth middleware" }));
				}),
		);
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("refactor the auth");
		result.current.onDraftChange("something else entirely");
		release?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(result.current.inlineCompletion).toBeUndefined();
	});

	it("offers nothing when the server has nothing to add", async () => {
		mockFetch().mockResolvedValue(jsonResponse({}));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("nothing matches this prefix");
		await waitFor(() => expect(mockFetch()).toHaveBeenCalled());
		await waitFor(() => expect(result.current.inlineCompletion).toBeUndefined());
	});

	it("sends the session it is typing in, so the session's own history can win", async () => {
		mockFetch().mockResolvedValue(jsonResponse({}));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true, sessionId: "session-a" }));
		result.current.onDraftChange("refactor the auth");
		await waitFor(() => expect(mockFetch()).toHaveBeenCalled());
		expect(JSON.parse(String(mockFetch().mock.calls[0]?.[1]?.body))).toEqual({
			text: "refactor the auth",
			sessionId: "session-a",
		});
	});

	it("omits the session when the composer has no identity yet", async () => {
		mockFetch().mockResolvedValue(jsonResponse({}));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("refactor the auth");
		await waitFor(() => expect(mockFetch()).toHaveBeenCalled());
		expect(JSON.parse(String(mockFetch().mock.calls[0]?.[1]?.body))).toEqual({ text: "refactor the auth" });
	});

	it("marks every history completion as an append", async () => {
		mockFetch().mockResolvedValue(jsonResponse({ completion: "refactor the auth middleware" }));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("refactor the auth");
		await waitFor(() => expect(result.current.inlineCompletion).toBeDefined());
		expect(result.current.inlineCompletion?.mode).toBe("append");
	});

	it("ignores a wire mode: replace and still treats history as append", async () => {
		// A buggy or hostile local response must not make Tab wipe the draft.
		mockFetch().mockResolvedValue(jsonResponse({ completion: "make this shorter please", mode: "replace" }));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("make this shorter");
		await waitFor(() => expect(result.current.inlineCompletion).toBeDefined());
		expect(result.current.inlineCompletion).toMatchObject({
			forValue: "make this shorter",
			text: " please",
			mode: "append",
		});
	});

	it("keeps a stale session response from replacing the current session's offer", async () => {
		// The same prefix resolves differently in a different session, so an offer
		// cached for one session must not be replayed in the next — least of all in a
		// brand-new chat, where it would present another session's history as the
		// corpus. Resolve the aborted first request last to prove it cannot publish.
		let resolveSessionA: ((response: Response) => void) | undefined;
		let resolveSessionB: ((response: Response) => void) | undefined;
		mockFetch()
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						resolveSessionA = resolve;
					}),
			)
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						resolveSessionB = resolve;
					}),
			);
		const { result, rerender } = renderHook(
			({ sessionId }: { sessionId: string }) => useComposerInlineCompletion({ available: true, sessionId }),
			{ initialProps: { sessionId: "session-a" } },
		);
		result.current.onDraftChange("refactor the auth");
		await waitFor(() => expect(mockFetch()).toHaveBeenCalledTimes(1));

		rerender({ sessionId: "session-b" });
		await waitFor(() => expect(mockFetch()).toHaveBeenCalledTimes(2));
		await act(async () => {
			resolveSessionB?.(jsonResponse({ completion: "refactor the auth middleware in session b" }));
		});
		await waitFor(() => expect(result.current.inlineCompletion?.text).toBe(" middleware in session b"));

		await act(async () => {
			resolveSessionA?.(jsonResponse({ completion: "refactor the auth middleware in session a" }));
		});
		expect(result.current.inlineCompletion?.text).toBe(" middleware in session b");
		expect(JSON.parse(String(mockFetch().mock.calls[1]?.[1]?.body))).toEqual({
			text: "refactor the auth",
			sessionId: "session-b",
		});
	});

	it("dismissal is idempotent and clears the offer", async () => {
		mockFetch().mockResolvedValue(jsonResponse({ completion: "refactor the auth middleware and add tests" }));
		const { result } = renderHook(() => useComposerInlineCompletion({ available: true }));
		result.current.onDraftChange("refactor the auth");
		await waitFor(() => expect(result.current.inlineCompletion).toBeDefined());
		result.current.inlineCompletion?.onDismiss?.();
		await waitFor(() => expect(result.current.inlineCompletion).toBeUndefined());
	});
});
