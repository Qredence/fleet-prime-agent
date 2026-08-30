import { lazy, Suspense, useMemo } from "react"
import { LazyMarkdown } from "../../../registry/beui/agents/lazy-markdown"
import { segmentOpenUIContent } from "../../../openui/openui-utils"
import type { OpenUIArtifactCandidate } from "../../../openui/html-artifact"

const LazyGenerativeTextRenderer = lazy(() =>
  import("../../../openui/openui-renderer").then(
    ({ GenerativeTextRenderer }) => ({ default: GenerativeTextRenderer })
  )
)
function PlainTextFallback({ className, content }: { className?: string; content: string }) {
  return <div className={className ? `${className} whitespace-pre-wrap` : "whitespace-pre-wrap"}>{content}</div>
}

export type FleetGenerativeTextRendererProps = {
  content: string
  className?: string
  isStreaming?: boolean
  messageId?: string
  onOpenUIAction?: (message: string) => void
  onOpenUIArtifactReady?: (
    candidate: OpenUIArtifactCandidate
  ) => void | Promise<string | undefined>
  onOpenArtifact?: (artifactId: string) => void
}

export function FleetGenerativeTextRenderer(
  props: FleetGenerativeTextRendererProps
) {
  const containsOpenUI = useMemo(
    () => segmentOpenUIContent(props.content).some((segment) => segment.type === "openui"),
    [props.content]
  )

  if (!containsOpenUI) {
    return (
      <LazyMarkdown className={props.className} content={props.content} />
    )
  }

  return (
    <Suspense fallback={<PlainTextFallback className={props.className} content={props.content} />}>
      <LazyGenerativeTextRenderer {...props} />
    </Suspense>
  )
}
