import { afterEach, describe, expect, it, vi } from "vitest";
import { createReconnectingEventSource, createSseCursorStore, parseSseEventId } from "@/hooks/chat/chat-sse";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	window.sessionStorage.clear();
});

describe("parseSseEventId", () => {
	it("accepts positive integers and ignores empty, zero, or invalid values", () => {
		expect(parseSseEventId("14")).toBe(14);
		expect(parseSseEventId("0")).toBeUndefined();
		expect(parseSseEventId("-2")).toBeUndefined();
		expect(parseSseEventId("")).toBeUndefined();
		expect(parseSseEventId(undefined)).toBeUndefined();
	});
});

describe("createSseCursorStore", () => {
	it("supports legacy integer cursors and JSON generation persistence", () => {
		const key = "pi:sse:test:session";
		window.sessionStorage.setItem(key, "9");
		const legacy = createSseCursorStore({ key, allowLegacyInteger: true });
		expect(legacy.current()).toEqual({ lastEventId: 9 });

		legacy.persist(14, "gen-1");
		expect(window.sessionStorage.getItem(key)).toBe(JSON.stringify({ generation: "gen-1", lastEventId: 14 }));

		legacy.reset("gen-2");
		expect(window.sessionStorage.getItem(key)).toBe(JSON.stringify({ generation: "gen-2", lastEventId: 0 }));
	});

	it("removes invalid or generationless entries in strict subagent mode", () => {
		const key = "pi:sse:test:subagent";
		window.sessionStorage.setItem(key, "{invalid");
		const store = createSseCursorStore({ key, allowZeroLastEventId: true, removeWhenNoGeneration: true });
		expect(store.current()).toEqual({ lastEventId: 0 });
		expect(window.sessionStorage.getItem(key)).toBeNull();

		store.persist(3, "gen-a");
		expect(window.sessionStorage.getItem(key)).toBe(JSON.stringify({ generation: "gen-a", lastEventId: 3 }));
		store.persist(0, undefined);
		expect(window.sessionStorage.getItem(key)).toBeNull();
	});
});

describe("createReconnectingEventSource", () => {
	it("guards stale EventSource instances across reconnects and teardown", () => {
		vi.useFakeTimers();
		class StubEventSource {
			static instances: StubEventSource[] = [];
			readonly close = vi.fn();
			onopen: (() => void) | null = null;
			onmessage: ((event: MessageEvent<string>) => void) | null = null;
			onerror: (() => void) | null = null;
			constructor(readonly url: string) {
				StubEventSource.instances.push(this);
			}
		}
		vi.stubGlobal("EventSource", StubEventSource);

		const messages: Array<{ data: unknown; id?: number; reconnected: boolean }> = [];
		const errors: number[] = [];
		const malformed = vi.fn();

		const controller = createReconnectingEventSource({
			getUrl: () => "/api/chat/events?sessionId=s-1",
			onMessage: (data, id, context) => messages.push({ data, id, reconnected: context.reconnected }),
			onMalformedJson: malformed,
			onError: ({ attempt, scheduleReconnect }) => {
				errors.push(attempt);
				scheduleReconnect();
			},
		});

		controller.connect();
		const first = StubEventSource.instances[0]!;
		first.onerror?.();
		expect(errors).toEqual([1]);

		vi.advanceTimersByTime(2_000);
		expect(StubEventSource.instances).toHaveLength(2);
		const second = StubEventSource.instances[1]!;

		// Stale source emissions must be dropped cleanly.
		first.onmessage?.(new MessageEvent("message", { lastEventId: "1", data: JSON.stringify({ stale: true }) }));
		expect(messages).toEqual([]);

		second.onmessage?.(new MessageEvent("message", { lastEventId: "2", data: JSON.stringify({ ok: true }) }));
		expect(messages).toEqual([{ data: { ok: true }, id: 2, reconnected: true }]);

		second.onmessage?.(new MessageEvent("message", { data: "{bad-json" }));
		expect(malformed).toHaveBeenCalledOnce();

		controller.close();
		expect(second.close).toHaveBeenCalledOnce();
		second.onerror?.();
		expect(errors).toEqual([1]);
	});
});
