import type { ChatDeliveryMode, ChatPiSettings, ChatTransport } from "@prime-agent/web-protocol/chat-protocol";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const TRANSPORT_OPTIONS = [
	{ value: "auto", label: "Auto" },
	{ value: "sse", label: "SSE" },
	{ value: "websocket", label: "WebSocket" },
] as const;

const DELIVERY_OPTIONS = [
	{ value: "all", label: "All" },
	{ value: "one-at-a-time", label: "One at a time" },
] as const;

export function HarnessRuntimeSection({
	draft,
	updateDraft,
}: {
	draft: ChatPiSettings | null;
	updateDraft: (updater: (current: ChatPiSettings) => ChatPiSettings) => void;
}) {
	const disabled = !draft;

	return (
		<div className="flex flex-col gap-2">
			<Item
				variant="outline"
				size="sm"
				className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
			>
				<ItemContent className="min-w-0 gap-0.5">
					<ItemTitle className="w-full truncate text-sm font-medium text-foreground">Compaction</ItemTitle>
					<ItemDescription className="truncate text-xs text-muted-foreground">
						Summarize old turns when context fills up
					</ItemDescription>
				</ItemContent>
				<ItemActions className="shrink-0">
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
				</ItemActions>
			</Item>
			<Item
				variant="outline"
				size="sm"
				className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
			>
				<ItemContent className="min-w-0 gap-0.5">
					<ItemTitle className="w-full truncate text-sm font-medium text-foreground">Auto-retry</ItemTitle>
					<ItemDescription className="truncate text-xs text-muted-foreground">
						Retry failed provider requests
					</ItemDescription>
				</ItemContent>
				<ItemActions className="shrink-0">
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
				</ItemActions>
			</Item>
			<Item
				variant="outline"
				size="sm"
				className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
			>
				<ItemContent className="min-w-0 gap-0.5">
					<ItemTitle className="w-full truncate text-sm font-medium text-foreground">Transport</ItemTitle>
				</ItemContent>
				<ItemActions className="shrink-0">
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
				</ItemActions>
			</Item>
			<Item
				variant="outline"
				size="sm"
				className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
			>
				<ItemContent className="min-w-0 gap-0.5">
					<ItemTitle className="w-full truncate text-sm font-medium text-foreground">Steering</ItemTitle>
					<ItemDescription className="truncate text-xs text-muted-foreground">
						How queued steers are delivered mid-turn
					</ItemDescription>
				</ItemContent>
				<ItemActions className="shrink-0">
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
				</ItemActions>
			</Item>
			<Item
				variant="outline"
				size="sm"
				className="flex-nowrap gap-3 rounded-lg border-border/50 bg-muted/20 px-2.5 py-2"
			>
				<ItemContent className="min-w-0 gap-0.5">
					<ItemTitle className="w-full truncate text-sm font-medium text-foreground">Follow-up</ItemTitle>
					<ItemDescription className="truncate text-xs text-muted-foreground">
						How queued follow-ups run after the turn
					</ItemDescription>
				</ItemContent>
				<ItemActions className="shrink-0">
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
				</ItemActions>
			</Item>
		</div>
	);
}
