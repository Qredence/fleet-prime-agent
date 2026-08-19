import { render, renderHook, act } from "@testing-library/react"
import { useRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Popover } from "@prime-agent/web-design/components/agent-elements/input/popover"
import { useProximityHover } from "@prime-agent/web-design/hooks/use-proximity-hover"
import type { ChatProviderOAuthLoginRequest, ChatProviderOAuthLoginResponse, ChatSessionMetadata } from "@prime-agent/web-protocol/chat-protocol"
import type { ChatClient } from "./chat-client"
import { useOAuthLoginFlow } from "@prime-agent/web-design/components/fleet-pi/pi/config-panel/sections/use-oauth-login-flow"
import { usePiChat } from "./use-pi-chat"

describe("React Doctor lifecycle and accessibility regressions", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("connects a Popover trigger to its popup with aria-controls", () => {
    const { getByRole } = render(
      <Popover trigger={<button type="button">Choose model</button>} defaultOpen>
        <div>Models</div>
      </Popover>,
    )

    const trigger = getByRole("button", { name: "Choose model" })
    const popupId = trigger.getAttribute("aria-controls")

    expect(popupId).toBeTruthy()
    expect(document.getElementById(popupId ?? "")).not.toBeNull()
  })

  it("uses the latest provider id after OAuth callback props change", async () => {
    const requests: ChatProviderOAuthLoginRequest[] = []
    const onOAuthLogin = vi.fn(
      async (request: ChatProviderOAuthLoginRequest): Promise<ChatProviderOAuthLoginResponse> => {
        requests.push(request)
        return { status: "success" }
      },
    )

    const { result, rerender } = renderHook(
      ({ providerId }: { providerId: string }) =>
        useOAuthLoginFlow({ providerId, onOAuthLogin }),
      { initialProps: { providerId: "provider-a" } },
    )

    rerender({ providerId: "provider-b" })
    await act(async () => {
      await result.current.start()
    })

    expect(requests).toEqual([{ providerId: "provider-b" }])
  })

  it("keeps busy when a stale OAuth attempt resolves after a restart", async () => {
    const pending: Array<(value: ChatProviderOAuthLoginResponse) => void> = []
    const onOAuthLogin = vi.fn((request: ChatProviderOAuthLoginRequest) => {
      if (request.cancel) return Promise.resolve({ status: "success" } as ChatProviderOAuthLoginResponse)
      return new Promise<ChatProviderOAuthLoginResponse>((resolve) => pending.push(resolve))
    })

    const { result } = renderHook(() => useOAuthLoginFlow({ providerId: "provider-a", onOAuthLogin }))

    // Attempt A: leave the start request in flight.
    await act(async () => {
      void result.current.start()
    })
    expect(result.current.busy).toBe(true)

    // Cancel, then immediately restart; attempt B also stays in flight.
    await act(async () => {
      await result.current.cancel()
    })
    await act(async () => {
      void result.current.start()
    })
    expect(result.current.busy).toBe(true)

    // Attempt A resolves late: its stale finally must not clear attempt B's busy.
    await act(async () => {
      pending[0]?.({ status: "waiting", loginId: "login-a" } as ChatProviderOAuthLoginResponse)
      await Promise.resolve()
    })
    expect(result.current.busy).toBe(true)

    await act(async () => {
      pending[1]?.({ status: "success" })
      await Promise.resolve()
    })
    expect(result.current.busy).toBe(false)
  })

  it("disconnects every registered ResizeObserver on unmount", () => {
    class TestResizeObserver {
      static instances: TestResizeObserver[] = []
      readonly disconnect = vi.fn()
      readonly observe = vi.fn()

      constructor() {
        TestResizeObserver.instances.push(this)
      }
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver)

    function Harness() {
      const containerRef = useRef<HTMLDivElement>(null)
      const { registerItem } = useProximityHover(containerRef)
      return (
        <div ref={containerRef} data-testid="container">
          <div ref={(node) => registerItem(0, node)} />
        </div>
      )
    }

    const { unmount } = render(<Harness />)
    unmount()

    expect(TestResizeObserver.instances.length).toBeGreaterThan(0)
    expect(
      TestResizeObserver.instances.every((observer) => observer.disconnect.mock.calls.length > 0),
    ).toBe(true)
  })

  it("closes the EventSource owned by the visible session on unmount", async () => {
    class TestEventSource {
      static instances: TestEventSource[] = []
      readonly close = vi.fn()
      onmessage: ((event: MessageEvent<string>) => void) | null = null
      onerror: (() => void) | null = null

      constructor(readonly url: string) {
        TestEventSource.instances.push(this)
      }
    }
    vi.stubGlobal("EventSource", TestEventSource)

    const metadata: ChatSessionMetadata = { sessionId: "session-1" }
    const client = {
      listSessions: vi.fn().mockResolvedValue([]),
      loadSession: vi.fn().mockResolvedValue({ session: metadata, messages: [] }),
    } as unknown as ChatClient

    const { unmount } = renderHook(() =>
      usePiChat(undefined, {
        client,
        initialSessionMetadata: metadata,
        persistSession: vi.fn(),
      }),
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(TestEventSource.instances.length).toBeGreaterThan(0)
    unmount()
    expect(
      TestEventSource.instances.every((source) => source.close.mock.calls.length > 0),
    ).toBe(true)
  })
})
