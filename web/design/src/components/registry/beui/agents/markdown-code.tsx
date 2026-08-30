import { createCodePlugin } from "@streamdown/code"
import { Streamdown } from "streamdown"
import {
  fixNumberedListBreaks,
  MarkdownFrame,
  markdownComponents,
  normalizeCodeFenceLanguages,
} from "./markdown"
import type { MarkdownProps } from "./markdown"

const code = createCodePlugin({
  themes: ["github-light", "github-dark"],
})

export function HighlightedMarkdown({ content, className, codeControls }: MarkdownProps) {
  const safeContent = normalizeCodeFenceLanguages(
    fixNumberedListBreaks(content)
  )

  return (
    <MarkdownFrame className={className}>
      <Streamdown
        components={markdownComponents}
        controls={{ code: codeControls }}
        plugins={{ code }}
      >
        {safeContent}
      </Streamdown>
    </MarkdownFrame>
  )
}
