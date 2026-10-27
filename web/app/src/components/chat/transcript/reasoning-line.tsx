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

export function ReasoningLine({
	text,
	streaming,
	durationMs,
}: {
	text: string;
	streaming: boolean;
	durationMs?: number;
}) {
	const [userOpen, setUserOpen] = useState<boolean | undefined>();
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
	return (
		<Trace data-testid="reasoning-line">
			{text ? (
				<TraceCollapsible open={userOpen ?? streaming} onOpenChange={setUserOpen}>
					<TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
					<TraceCollapsibleContent className="whitespace-pre-wrap text-foreground">{text}</TraceCollapsibleContent>
				</TraceCollapsible>
			) : (
				line
			)}
		</Trace>
	);
}
