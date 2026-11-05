"use client";

import type { ChatReasoningPresentation } from "@prime-agent/web-protocol/chat-protocol";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { useState } from "react";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@/components/ui/trace";

/** A summary of typed lifecycle steps when detailed reasoning is unavailable. */
export function SessionReasoningPanel({
	presentation,
	className,
	streamingOverride,
}: {
	presentation: ChatReasoningPresentation;
	className?: string;
	streamingOverride?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const streaming = streamingOverride ?? presentation.streaming;
	const shown = presentation.steps.slice(0, Math.max(0, presentation.visibleSteps)).filter((step, index, all) => {
		const previous = all[index - 1];
		return !previous || previous.title !== step.title || previous.body !== step.body;
	});
	if (!streaming && shown.length === 0) return null;
	return (
		<Trace className={className} data-slot="reasoning-presentation" aria-label="Safe reasoning progress">
			<TraceCollapsible open={open} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger>
					<TraceLine status={streaming ? "running" : undefined}>
						<TraceIcon>
							{streaming ? (
								<LoaderCircle className="animate-spin motion-reduce:animate-none" />
							) : (
								<CircleCheck />
							)}
						</TraceIcon>
						<TraceTitle>{streaming ? "Preparing response" : presentation.restingLabel}</TraceTitle>
						{presentation.elapsedMs !== undefined ? (
							<TraceDescription>{Math.max(0, Math.round(presentation.elapsedMs / 1000))}s</TraceDescription>
						) : null}
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<ol className="flex flex-col gap-2">
						{shown.map((step) => (
							<li key={step.id}>
								<span className="font-medium">{step.title}</span>
								<p>{step.body}</p>
							</li>
						))}
					</ol>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
