import { Switch } from "../../../../../ui/switch"
import { Select } from "../../../../../ui/select"
import { ItemRow } from "../../../primitives/item-row"
import type {
  ChatDeliveryMode,
  ChatPiSettings,
  ChatTransport,
} from "@prime-agent/web-protocol/chat-protocol"

const TRANSPORT_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "sse", label: "SSE" },
  { value: "websocket", label: "WebSocket" },
] as const

const DELIVERY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "one-at-a-time", label: "One at a time" },
] as const

export function HarnessRuntimeSection({
  draft,
  updateDraft,
}: {
  draft: ChatPiSettings | null
  updateDraft: (updater: (current: ChatPiSettings) => ChatPiSettings) => void
}) {
  const disabled = !draft

  return (
    <div className="flex flex-col gap-2">
      <ItemRow
        title="Compaction"
        subtitle="Summarize old turns when context fills up"
        trailing={
          <Switch
            aria-label="Compaction"
            checked={draft?.compaction.enabled ?? false}
            disabled={disabled}
            onCheckedChange={(enabled) =>
              updateDraft((current) => ({
                ...current,
                compaction: { ...current.compaction, enabled },
              }))
            }
          />
        }
      />
      <ItemRow
        title="Auto-retry"
        subtitle="Retry failed provider requests"
        trailing={
          <Switch
            aria-label="Auto-retry"
            checked={draft?.retry.enabled ?? false}
            disabled={disabled}
            onCheckedChange={(enabled) =>
              updateDraft((current) => ({
                ...current,
                retry: { ...current.retry, enabled },
              }))
            }
          />
        }
      />
      <ItemRow
        title="Transport"
        trailing={
          <Select
            aria-label="Transport"
            className="w-[160px]"
            disabled={disabled}
            onValueChange={(value) =>
              updateDraft((current) => ({
                ...current,
                transport: value as ChatTransport,
              }))
            }
            options={[...TRANSPORT_OPTIONS]}
            value={draft?.transport ?? "auto"}
          />
        }
      />
      <ItemRow
        title="Steering"
        subtitle="How queued steers are delivered mid-turn"
        trailing={
          <Select
            aria-label="Steering"
            className="w-[160px]"
            disabled={disabled}
            onValueChange={(value) =>
              updateDraft((current) => ({
                ...current,
                steeringMode: value as ChatDeliveryMode,
              }))
            }
            options={[...DELIVERY_OPTIONS]}
            value={draft?.steeringMode ?? "all"}
          />
        }
      />
      <ItemRow
        title="Follow-up"
        subtitle="How queued follow-ups run after the turn"
        trailing={
          <Select
            aria-label="Follow-up"
            className="w-[160px]"
            disabled={disabled}
            onValueChange={(value) =>
              updateDraft((current) => ({
                ...current,
                followUpMode: value as ChatDeliveryMode,
              }))
            }
            options={[...DELIVERY_OPTIONS]}
            value={draft?.followUpMode ?? "all"}
          />
        }
      />
    </div>
  )
}
