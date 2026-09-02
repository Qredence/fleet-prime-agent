"use client"

import { X } from "lucide-react"

import { notify } from "../../../../lib/notify"
import { cn } from "../../../../lib/utils"

export type FleetQueueLane = "steering" | "followUp"

export type FleetMessageQueueProps = {
	queue: {
		steering: readonly string[]
		followUp: readonly string[]
	}
	onDelete?: (lane: FleetQueueLane, index: number, text: string) => void | Promise<unknown>
	className?: string
}

const LANES: ReadonlyArray<{ key: FleetQueueLane; label: string }> = [
	{ key: "steering", label: "Next" },
	{ key: "followUp", label: "After run" },
]

/**
 * Displays queued fleet messages grouped by their execution lane.
 *
 * @param queue - The steering and follow-up messages to display
 * @param onDelete - Optional callback invoked when a queued message is removed
 * @returns The queued message list, or `null` when both lanes are empty
 */
export function FleetMessageQueue({ queue, onDelete, className }: FleetMessageQueueProps) {
	const count = queue.steering.length + queue.followUp.length
	if (count === 0) return null

	const handleDelete = async (lane: FleetQueueLane, index: number, text: string) => {
		try {
			const deleted = await onDelete?.(lane, index, text)
			if (deleted === false) notify.error("Unable to remove queued message")
		} catch {
			notify.error("Unable to remove queued message")
		}
	}

	return (
		<section aria-label="Queued messages" className={cn("mx-auto mb-2 w-full max-w-an px-3", className)}>
			<div className="rounded-xl border border-border/60 bg-muted/30 p-2">
				<div className="mb-1 flex items-baseline justify-between px-1 text-xs text-muted-foreground">
					<span>{count} queued</span>
					<span>Sent when the run reaches its lane</span>
				</div>
				<div className="space-y-1">
					{LANES.flatMap(({ key, label }) =>
						queue[key].map((text, index) => (
							<div
								key={`${key}:${index}:${text}`}
								className="flex min-w-0 items-center gap-2 rounded-lg bg-background/80 px-2 py-1.5 text-sm"
							>
								<span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
									{label}
								</span>
								<span className="min-w-0 flex-1 truncate text-foreground/80">{text}</span>
								{onDelete ? (
									<button
										type="button"
										aria-label={`Remove queued message: ${text}`}
										onClick={() => void handleDelete(key, index, text)}
										className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<X className="size-3.5" />
									</button>
								) : null}
							</div>
						)),
					)}
				</div>
			</div>
		</section>
	)
}
