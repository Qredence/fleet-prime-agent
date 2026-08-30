import { lazy, Suspense } from "react"
import type { MarkdownProps } from "./markdown"

const MarkdownContent = lazy(() =>
  import("./markdown").then(({ Markdown }) => ({ default: Markdown }))
)

export function LazyMarkdown(props: MarkdownProps) {
  return (
    <Suspense
      fallback={
        <div className={props.className ? `${props.className} whitespace-pre-wrap` : "whitespace-pre-wrap"}>
          {props.content}
        </div>
      }
    >
      <MarkdownContent {...props} />
    </Suspense>
  )
}
