import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import {
  AgentTabBar,
  type AgentTabItem,
} from "@prime-agent/web-design/components/product/fleet-pi/layout/agent-tab-bar"

const initialTabs: Array<AgentTabItem> = [
  { id: "main", label: "Main agent", kind: "main" },
  { id: "research", label: "Research worker", kind: "subagent", status: "running" },
  { id: "writer", label: "Writer worker", kind: "subagent", status: "done" },
]

function ControlledTabBar({ onClose, onNewSession }: { onClose: (id: string) => void; onNewSession: () => void }) {
  const [tabs, setTabs] = useState(initialTabs)
  const [value, setValue] = useState("main")
  return (
    <AgentTabBar
      tabs={tabs}
      value={value}
      onValueChange={setValue}
      onClose={(id) => {
        onClose(id)
        setTabs((current) => current.filter((tab) => tab.id !== id))
        setValue((current) => (current === id ? "main" : current))
      }}
      onNewSession={onNewSession}
    />
  )
}

describe("AgentTabBar", () => {
  it("keeps tree order, exposes tab state, and roves focus with arrows", () => {
    render(<ControlledTabBar onClose={vi.fn()} onNewSession={vi.fn()} />)

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.trim())).toEqual([
      "Main agent",
      "Research worker",
      "Writer worker",
    ])
    expect(screen.getByRole("tab", { name: "Main agent, ready" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("tab", { name: "Research worker, streaming" }).getAttribute("aria-selected")).toBe("false")
    expect(screen.getByRole("tab", { name: "Main agent, ready" }).className).toContain("bg-[#2c2c2c]")
    expect(screen.getByRole("tab", { name: "Research worker, streaming" }).className).toContain("bg-transparent")

    fireEvent.keyDown(screen.getByRole("tab", { name: "Main agent, ready" }), { key: "ArrowRight" })

    expect(screen.getByRole("tab", { name: "Research worker, streaming" }).getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Research worker, streaming" }))
  })

  it("dismisses only child tabs and keeps the main tab permanent", () => {
    const onClose = vi.fn()
    const onNewSession = vi.fn()
    render(<ControlledTabBar onClose={onClose} onNewSession={onNewSession} />)

    expect(screen.queryByRole("button", { name: "Close Main agent tab" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Close Research worker tab" }))
    fireEvent.click(screen.getByRole("button", { name: "New chat" }))

    expect(onClose).toHaveBeenCalledWith("research")
    expect(screen.queryByRole("tab", { name: "Research worker, streaming" })).toBeNull()
    expect(screen.getByRole("tab", { name: "Main agent, ready" })).toBeTruthy()
    expect(onNewSession).toHaveBeenCalledOnce()
  })
})
