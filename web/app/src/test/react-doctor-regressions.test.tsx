import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "@/components/chat/chat-client";
import { Popover } from "@/components/chat/composer/input/input-popover";
import { usePiChat } from "@/components/chat/use-pi-chat";
import { ChromePillButton } from "@/components/layout/chrome-pill";

describe("React Doctor lifecycle and accessibility regressions", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("connects a Popover trigger to its popup with aria-controls", () => {
		const { getByRole } = render(
			<Popover trigger={<button type="button">Choose model</button>} defaultOpen>
				<div>Models</div>
			</Popover>,
		);

		const trigger = getByRole("button", { name: "Choose model" });
		const popupId = trigger.getAttribute("aria-controls");

		expect(popupId).toBeTruthy();
		const popup = document.getElementById(popupId ?? "");
		expect(popup).not.toBeNull();
		expect(popup?.className).toContain("bg-popover");
		expect(popup?.className).toContain("border");
		expect(popup?.className).toContain("shadow-lg");
	});

	it("opens a Popover from a shared product button", () => {
		const { container, getByRole, queryByText } = render(
			<Popover overlay trigger={<ChromePillButton ariaLabel="Open account menu">Account</ChromePillButton>}>
				<div>Account settings</div>
			</Popover>,
		);

		expect(queryByText("Account settings")).toBeNull();
		expect(container.querySelector(".fixed.inset-0.z-40")).toBeNull();
		fireEvent.click(getByRole("button", { name: "Open account menu" }));
		expect(getByRole("dialog").textContent).toContain("Account settings");
		expect(container.querySelector(".fixed.inset-0.z-40")).not.toBeNull();
		fireEvent.click(getByRole("button", { name: "Open account menu" }));
		expect(container.querySelector(".fixed.inset-0.z-40")).toBeNull();
	});

	it("closes the EventSource owned by the visible session on unmount", async () => {
		class TestEventSource {
			static instances: TestEventSource[] = [];
			readonly close = vi.fn();
			onmessage: ((event: MessageEvent<string>) => void) | null = null;
			onerror: (() => void) | null = null;

			constructor(readonly url: string) {
				TestEventSource.instances.push(this);
			}
		}
		vi.stubGlobal("EventSource", TestEventSource);

		const metadata: ChatSessionMetadata = { sessionId: "session-1" };
		const client = {
			listSessions: vi.fn().mockResolvedValue([]),
			loadSession: vi.fn().mockResolvedValue({ session: metadata, messages: [] }),
		} as unknown as ChatClient;
		const persistSession = vi.fn();

		const { unmount } = renderHook(() =>
			usePiChat(undefined, {
				client,
				initialSessionMetadata: metadata,
				persistSession,
			}),
		);

		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(TestEventSource.instances.length).toBeGreaterThan(0);
		unmount();
		expect(TestEventSource.instances.every((source) => source.close.mock.calls.length > 0)).toBe(true);
	});
});
