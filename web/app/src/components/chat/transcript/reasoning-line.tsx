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

function reasoningBody(text: string) {
	return text.replace(/^(?:\r?\n)+/, "").trimEnd();
}

/**
 * Renders a contiguous reasoning run as one shadcn Trace row.
 * Follows Trace open-state: open while streaming (`open ?? streaming`),
 * TraceLine alone until text arrives, then TraceCollapsible with the line in the trigger.
 */
export function ReasoningLine({
	text,
	streaming,
	durationMs,
}: {
	text: string;
	streaming: boolean;
	durationMs?: number;
}) {
	const [open, setOpen] = useState<boolean | undefined>();
	const body = reasoningBody(text);
	const line = (
		<TraceLine status={streaming ? "running" : undefined}>
			<TraceIcon>
				{streaming ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <CircleCheck />}
			</TraceIcon>
			<TraceTitle>{streaming ? "Thinking" : "Thought"}</TraceTitle>
			{durationMs !== undefined ? (
				<TraceDescription>{Math.max(0, Math.round(durationMs / 1000))}s</TraceDescription>
			) : null}
		</TraceLine>
	);

	if (!body.trim()) {
		return <Trace data-testid="reasoning-line">{line}</Trace>;
	}

	return (
		<Trace data-testid="reasoning-line">
			<TraceCollapsible open={open ?? streaming} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
				<TraceCollapsibleContent className="whitespace-pre-wrap">{body}</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
