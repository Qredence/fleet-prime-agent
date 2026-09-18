import { COMPOSER_COMPLETION_MAX_CHARS, composerCompletionGhost } from "@prime-agent/web-protocol/composer-completion";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposerInlineCompletion } from "./composer-inline-completion";

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
		const { result } = renderHook(() => useComposerInlineCompletion(true));
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
		const { result } = renderHook(() => useComposerInlineCompletion(true));
		result.current.onDraftChange("deploy");
		await waitFor(() => expect(result.current.inlineCompletion).toBeDefined());
		expect(result.current.inlineCompletion?.text.length).toBeLessThanOrEqual(COMPOSER_COMPLETION_MAX_CHARS + 1);
	});

	it("never asks for a draft the trigger popovers own", async () => {
		const { result } = renderHook(() => useComposerInlineCompletion(true));
		result.current.onDraftChange("/sett");
		result.current.onDraftChange("look at @src/lib");
		result.current.onDraftChange("hi");
		await Promise.resolve();
		expect(mockFetch()).not.toHaveBeenCalled();
		expect(result.current.inlineCompletion).toBeUndefined();
	});

	it("makes no request when the host has completions switched off", async () => {
		const { result } = renderHook(() => useComposerInlineCompletion(false));
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
		const { result } = renderHook(() => useComposerInlineCompletion(true));
		result.current.onDraftChange("refactor the auth");
		result.current.onDraftChange("something else entirely");
		release?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(result.current.inlineCompletion).toBeUndefined();
	});

	it("offers nothing when the server has nothing to add", async () => {
		mockFetch().mockResolvedValue(jsonResponse({}));
		const { result } = renderHook(() => useComposerInlineCompletion(true));
		result.current.onDraftChange("nothing matches this prefix");
		await waitFor(() => expect(mockFetch()).toHaveBeenCalled());
		await waitFor(() => expect(result.current.inlineCompletion).toBeUndefined());
	});

	it("dismissal is idempotent and clears the offer", async () => {
		mockFetch().mockResolvedValue(jsonResponse({ completion: "refactor the auth middleware and add tests" }));
		const { result } = renderHook(() => useComposerInlineCompletion(true));
		result.current.onDraftChange("refactor the auth");
		await waitFor(() => expect(result.current.inlineCompletion).toBeDefined());
		result.current.inlineCompletion?.onDismiss?.();
		await waitFor(() => expect(result.current.inlineCompletion).toBeUndefined());
	});
});
