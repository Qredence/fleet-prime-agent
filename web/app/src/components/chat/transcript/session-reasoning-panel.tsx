"use client";

import type { ChatReasoningPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { ChevronDownIcon } from "lucide-react";
import { type ComponentProps, useMemo, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { collapsePanel, mono, ShimmerLabel, SwapLabel } from "@/lib/surfaces";
import { cn } from "@/lib/utils";

type GenerationLoaderVariant = "dots" | "squares" | "rounded";

const CELL_SHAPES: Record<GenerationLoaderVariant, string> = {
	dots: "rounded-full",
	squares: "rounded-[1px]",
	rounded: "rounded-[3px]",
};

function GenerationLoader({
	label,
	tick,
	variant = "dots",
	className,
	...props
}: Omit<ComponentProps<"div">, "children"> & {
	label: string;
	tick: number;
	variant?: GenerationLoaderVariant;
}) {
	const pixelOffset = Math.floor(tick / 3);

	return (
		<div data-slot="generation-loader" className={cn("flex flex-col items-center gap-4", className)} {...props}>
			<div aria-hidden className="grid grid-cols-3 gap-1">
				{Array.from({ length: 9 }, (_, index) => {
					const active = (index * 2 + pixelOffset) % 9 < 3;

					return (
						<span
							key={index}
							className={cn(
								"bg-foreground size-2 transition-opacity duration-300 motion-reduce:transition-none",
								CELL_SHAPES[variant],
								active ? "opacity-90" : "opacity-15",
							)}
						/>
					);
				})}
			</div>
			<ShimmerLabel className="relative inline-block text-sm text-muted-foreground">{label}</ShimmerLabel>
		</div>
	);
}

function ThinkingIndicator({
	label,
	elapsed,
	className,
	...props
}: Omit<ComponentProps<"div">, "children" | "label" | "elapsed"> & {
	label: string;
	elapsed?: string;
}) {
	return (
		<div
			data-slot="thinking-indicator"
			className={cn("flex items-center gap-2.5 text-sm text-muted-foreground", className)}
			{...props}
		>
			<span
				aria-hidden
				className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
			/>
			<ShimmerLabel
				key={label}
				className="fade-in slide-in-from-bottom-1 animate-in relative inline-block leading-none duration-300"
			>
				{label}
			</ShimmerLabel>
			{elapsed !== undefined && <span className={cn(mono, "tabular-nums text-muted-foreground/70")}>{elapsed}</span>}
		</div>
	);
}

interface ReasoningStep {
	id?: string;
	title: string;
	body: string;
}

function ReasoningPanel({
	steps,
	visibleSteps,
	streaming,
	streamingLabel = "Thinking",
	open,
	onOpenChange,
	restingLabel,
	elapsed,
	className,
}: {
	steps: ReasoningStep[];
	visibleSteps: number;
	streaming: boolean;
	streamingLabel?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	restingLabel: string;
	elapsed?: string;
	className?: string;
}) {
	const count = Number.isNaN(visibleSteps) ? 0 : Math.floor(Math.min(steps.length, Math.max(0, visibleSteps)));
	const shown = steps.slice(0, count);

	return (
		<Collapsible
			data-slot="reasoning-panel"
			open={open}
			onOpenChange={onOpenChange}
			className={cn("w-full max-w-sm", className)}
		>
			<CollapsibleTrigger className="group/trigger flex items-center gap-1.5 py-1 text-sm text-muted-foreground outline-none transition-[color,scale] hover:text-foreground/90 focus-visible:ring-2 focus-visible:ring-ring enabled:active:scale-[0.96]">
				<SwapLabel active={streaming ? 0 : 1} className="text-start">
					<>
						<ShimmerLabel active={streaming} className="relative inline-block leading-none">
							{streamingLabel}
						</ShimmerLabel>
						{elapsed !== undefined && (
							<span className={cn(mono, "tabular-nums text-muted-foreground/70")}>{elapsed}</span>
						)}
					</>
					<>{restingLabel}</>
				</SwapLabel>
				<ChevronDownIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-180 group-data-panel-open/trigger:rotate-180 motion-reduce:transition-none" />
			</CollapsibleTrigger>
			<CollapsibleContent className={cn(collapsePanel, "outline-none")}>
				<ol className="flex flex-col gap-4 pt-3 pb-1">
					{shown.map((step, i) => {
						const active = streaming && i === shown.length - 1;
						return (
							<li
								key={step.id ?? `${step.title}-${i}`}
								className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex gap-3 duration-300"
							>
								<span
									aria-hidden
									className={cn(
										"mt-[7px] size-[5px] shrink-0 rounded-full transition-colors duration-300",
										active ? "animate-pulse bg-primary" : "bg-foreground/20",
									)}
								/>
								<span className="flex min-w-0 flex-1 flex-col">
									<p className="text-foreground/90 text-body font-medium">{step.title}</p>
									<p className="text-foreground/50 mt-0.5 text-body leading-relaxed break-words">
										{step.body}
									</p>
								</span>
							</li>
						);
					})}
				</ol>
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * Controlled reasoning adapter. It accepts only ChatReasoningPresentation—
 * never raw model thought, provider traces, tool inputs, or diagnostic payloads.
 */
export function SessionReasoningPanel({
	presentation,
	className,
	streamingOverride,
}: {
	presentation: ChatReasoningPresentation;
	className?: string;
	/** Live turn state from the caller; corrects parts reconciled before trailing `streaming:false` frames arrive. */
	streamingOverride?: boolean;
}) {
	const [userOpen, setUserOpen] = useState<boolean | undefined>(undefined);
	const streaming = streamingOverride ?? presentation.streaming;
	const open = userOpen ?? streaming;
	const steps = useMemo(
		() => presentation.steps.map((step) => ({ id: step.id, title: step.title, body: step.body })),
		[presentation.steps],
	);
	if (!streaming && steps.length === 0) return null;
	const visibleSteps = Math.min(Math.max(0, presentation.visibleSteps), steps.length);
	const activeStep = steps.at(visibleSteps - 1);
	const activeLabel = activeStep?.title ?? phaseLabel(presentation.phase);
	const elapsed = formatElapsed(presentation.elapsedMs);

	return (
		<section
			data-slot="reasoning-presentation"
			aria-label="Safe reasoning progress"
			className={cn(
				"w-full max-w-xl rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 shadow-sm shadow-black/[0.02] dark:shadow-black/15",
				className,
			)}
		>
			{streaming ? (
				<div className="mb-1.5 flex flex-col gap-1.5 border-b border-border/45 pb-2.5">
					{activeStep?.body ? (
						<>
							<ThinkingIndicator label={activeLabel} elapsed={elapsed} />
							<p className="pl-4 text-pretty text-caption font-normal text-muted-foreground">
								{activeStep.body}
							</p>
						</>
					) : (
						<GenerationLoader
							label={activeLabel}
							tick={Math.floor((presentation.elapsedMs ?? 0) / 250)}
							variant="dots"
							className="items-start gap-2 p-1 text-left"
						/>
					)}
				</div>
			) : null}
			<ReasoningPanel
				steps={steps}
				visibleSteps={visibleSteps}
				streaming={streaming}
				streamingLabel="Preparing response"
				open={open}
				onOpenChange={setUserOpen}
				restingLabel={presentation.restingLabel}
				elapsed={elapsed}
				className="max-w-none"
			/>
		</section>
	);
}

function phaseLabel(phase: string) {
	switch (phase) {
		case "waiting":
			return "Preparing run";
		case "context":
			return "Reviewing workspace context";
		case "planning":
			return "Organising the response";
		case "executing":
			return "Completing requested work";
		case "responding":
			return "Writing the response";
		case "recovering":
			return "Recovering the run";
		case "error":
			return "Run needs attention";
		case "complete":
			return "Completed";
		default:
			return "Working";
	}
}

function formatElapsed(elapsedMs: number | undefined) {
	if (elapsedMs === undefined) return undefined;
	const seconds = Math.max(0, Math.round(elapsedMs / 1000));
	if (seconds < 60) return `${String(seconds)}s`;
	return `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}
