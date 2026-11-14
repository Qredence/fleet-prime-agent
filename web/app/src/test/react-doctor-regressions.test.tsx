import type { ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatClient } from "@/lib/chat/chat-client";
import { usePiChat } from "@/hooks/chat/use-pi-chat";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

describe("React Doctor lifecycle and accessibility regressions", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("connects a Popover trigger to its popup with aria-controls", () => {
		const { getByRole } = render(
			<Popover defaultOpen>
				<PopoverTrigger render={<Button type="button">Choose model</Button>} />
				<PopoverContent>
					<div>Models</div>
				</PopoverContent>
			</Popover>,
		);

		const trigger = getByRole("button", { name: "Choose model" });
		const popupId = trigger.getAttribute("aria-controls");

		expect(popupId).toBeTruthy();
		const popup = document.getElementById(popupId ?? "");
		expect(popup).not.toBeNull();
		expect(popup?.className).toContain("bg-popover");
		expect(popup?.className).toContain("border");
		expect(popup?.className).toContain("shadow-surface-3");
	});

	it("opens a Popover from a shared product button", async () => {
		const { getByRole, queryByText } = render(
			<Popover>
				<PopoverTrigger
					render={
						<Button type="button" variant="ghost" size="compact" aria-label="Open account menu">
							Account
						</Button>
					}
				/>
				<PopoverContent>
					<div>Account settings</div>
				</PopoverContent>
			</Popover>,
		);

		expect(queryByText("Account settings")).toBeNull();
		fireEvent.click(getByRole("button", { name: "Open account menu" }));
		expect(getByRole("dialog").textContent).toContain("Account settings");
		fireEvent.click(getByRole("button", { name: "Open account menu" }));
		// The popup stays mounted through its exit animation.
		await waitFor(() => expect(queryByText("Account settings")).toBeNull());
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
