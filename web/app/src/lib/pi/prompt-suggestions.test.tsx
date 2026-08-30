import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PromptSuggestions } from "@prime-agent/web-design/components/registry/assistant-ui/elements/prompt-suggestions"

describe("PromptSuggestions", () => {
  it("preserves selected suggestion contrast across hover and focus states", () => {
    render(
      <PromptSuggestions
        suggestions={["Go deeper on this"]}
        selectedSuggestion="Go deeper on this"
        cycle={1}
        onSuggestion={vi.fn()}
      />,
    )

    const suggestion = screen.getByRole("button", { name: "Go deeper on this" })
    expect(suggestion.className).toContain("!text-background")
    expect(suggestion.className).toContain("hover:!text-background")
    expect(suggestion.className).toContain("focus-visible:!text-background")
  })
})
