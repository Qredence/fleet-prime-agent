import type { ChatPayloadPart } from "@prime-agent/web-protocol/chat-types"

function formatPayload(value: unknown): string {
  if (typeof value === "string") return value
  if (value === undefined) return ""
  try {
	return JSON.stringify(value, null, 2) ?? ""
  } catch {
    return String(value)
  }
}

/** Renders a non-tool Prime Agent payload that the TUI shows in its transcript. */
export function PayloadPart({ part }: { part: ChatPayloadPart }) {
  const payload = formatPayload(part.payload)
  return (
    <section
      data-payload-kind={part.kind}
      className="w-full min-w-0 overflow-hidden rounded-xl border border-border/60 bg-muted/40 text-sm"
    >
      <div className="border-b border-border/50 px-3 py-2 text-xs font-medium text-muted-foreground">
        {part.title}
      </div>
      {part.text ? (
        <pre className="m-0 whitespace-pre-wrap break-words px-3 py-3 font-mono text-xs leading-5 text-foreground/80">
          {part.text}
        </pre>
      ) : null}
      {payload ? (
        <details open className="border-t border-border/50 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Payload</summary>
          <pre className="m-0 mt-2 max-w-full whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/70">
            {payload}
          </pre>
        </details>
      ) : null}
    </section>
  )
}
