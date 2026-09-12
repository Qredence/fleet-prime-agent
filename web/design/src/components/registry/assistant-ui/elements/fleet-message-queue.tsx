"use client";

import { Pencil, X } from "lucide-react";
import { useState } from "react";

import { notify } from "../../../../lib/notify";
import { cn } from "../../../../lib/utils";

export type FleetQueueLane = "steering" | "followUp";

export type FleetMessageQueueProps = {
	queue: {
		steering: readonly string[];
		followUp: readonly string[];
	};
	onDelete?: (lane: FleetQueueLane, index: number, text: string) => void | Promise<unknown>;
	onEdit?: (lane: FleetQueueLane, index: number, expectedText: string, nextText: string) => void | Promise<unknown>;
	className?: string;
};

const LANES: ReadonlyArray<{ key: FleetQueueLane; label: string }> = [
	{ key: "steering", label: "Next" },
	{ key: "followUp", label: "After run" },
];

function queueItemKey(lane: FleetQueueLane, index: number): string {
	return `${lane}:${index}`;
}

/**
 * Displays queued fleet messages grouped by their execution lane.
 *
 * @param queue - The steering and follow-up messages to display
 * @param onDelete - Optional callback invoked when a queued message is removed
 * @param onEdit - Optional callback invoked when a queued message is edited in place
 * @returns The queued message list, or `null` when both lanes are empty
 */
export function FleetMessageQueue({ queue, onDelete, onEdit, className }: FleetMessageQueueProps) {
	const count = queue.steering.length + queue.followUp.length;
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const [draftText, setDraftText] = useState("");

	if (count === 0) return null;

	const cancelEdit = () => {
		setEditingKey(null);
		setDraftText("");
	};

	const startEdit = (lane: FleetQueueLane, index: number, text: string) => {
		setEditingKey(queueItemKey(lane, index));
		setDraftText(text);
	};

	const handleDelete = async (lane: FleetQueueLane, index: number, text: string) => {
		if (editingKey === queueItemKey(lane, index)) cancelEdit();
		try {
			const deleted = await onDelete?.(lane, index, text);
			if (deleted === false) notify.error("Unable to remove queued message");
		} catch {
			notify.error("Unable to remove queued message");
		}
	};

	const handleSaveEdit = async (lane: FleetQueueLane, index: number, expectedText: string) => {
		const trimmed = draftText.trim();
		if (trimmed.length === 0) {
			await handleDelete(lane, index, expectedText);
			return;
		}
		if (trimmed === expectedText) {
			cancelEdit();
			return;
		}
		try {
			const saved = await onEdit?.(lane, index, expectedText, trimmed);
			if (saved === false) notify.error("Unable to update queued message");
			else cancelEdit();
		} catch {
			notify.error("Unable to update queued message");
		}
	};

	return (
		<section aria-label="Queued messages" className={cn("mx-auto mb-2 w-full max-w-an px-3", className)}>
			<div className="rounded-xl border border-border/60 bg-muted/30 p-2">
				<div className="mb-1 flex items-baseline justify-between px-1 text-xs text-muted-foreground">
					<span>{count} queued</span>
					<span>Sent when the run reaches its lane</span>
				</div>
				<div className="space-y-1">
					{LANES.flatMap(({ key, label }) =>
						queue[key].map((text, index) => {
							const itemKey = queueItemKey(key, index);
							const isEditing = editingKey === itemKey;
							return (
								<div
									key={`${key}:${index}:${text}`}
									className="flex min-w-0 items-start gap-2 rounded-lg bg-background/80 px-2 py-1.5 text-sm"
								>
									<span className="mt-0.5 shrink-0 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground">
										{label}
									</span>
									{isEditing ? (
										<div className="flex min-w-0 flex-1 flex-col gap-1.5">
											<textarea
												value={draftText}
												onChange={(event) => setDraftText(event.target.value)}
												onKeyDown={(event) => {
													if (event.key === "Escape") {
														event.preventDefault();
														cancelEdit();
														return;
													}
													if (event.key === "Enter" && !event.shiftKey) {
														event.preventDefault();
														void handleSaveEdit(key, index, text);
													}
												}}
												aria-label={`Edit queued message: ${text}`}
												rows={2}
												className="min-h-10 w-full resize-y rounded-md border border-border/70 bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												autoFocus
											/>
											<div className="flex flex-wrap gap-1">
												<button
													type="button"
													onClick={() => void handleSaveEdit(key, index, text)}
													className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												>
													Save
												</button>
												<button
													type="button"
													onClick={cancelEdit}
													className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												>
													Cancel
												</button>
											</div>
										</div>
									) : (
										<>
											<span className="min-w-0 flex-1 truncate text-foreground/80">{text}</span>
											<div className="flex shrink-0 items-center gap-0.5">
												{onEdit ? (
													<button
														type="button"
														aria-label={`Edit queued message: ${text}`}
														onClick={() => startEdit(key, index, text)}
														className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													>
														<Pencil className="size-3.5" />
													</button>
												) : null}
												{onDelete ? (
													<button
														type="button"
														aria-label={`Remove queued message: ${text}`}
														onClick={() => void handleDelete(key, index, text)}
														className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
													>
														<X className="size-3.5" />
													</button>
												) : null}
											</div>
										</>
									)}
								</div>
							);
						}),
					)}
				</div>
			</div>
		</section>
	);
}
