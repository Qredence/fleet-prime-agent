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

/** Blank-line paragraphs → discrete Thought rows; last stays streaming when open. */
export function splitReasoningSegments(text: string, streaming: boolean): Array<{ text: string; streaming: boolean }> {
	const normalized = text.replace(/^\n+/, "").replace(/\n+$/, "");
	if (!normalized.trim()) return [];
	const segments = normalized
		.split(/\n{2,}/)
		.map((segment) => segment.trim())
		.filter(Boolean);
	if (segments.length === 0) return [];
	if (segments.length === 1) return [{ text: segments[0]!, streaming }];
	return segments.map((segment, index) => ({
		text: segment,
		streaming: streaming && index === segments.length - 1,
	}));
}

function ReasoningSegment({ text, streaming, durationMs }: { text: string; streaming: boolean; durationMs?: number }) {
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

export function ReasoningLine({
	text,
	streaming,
	durationMs,
}: {
	text: string;
	streaming: boolean;
	durationMs?: number;
}) {
	const segments = splitReasoningSegments(text, streaming);
	if (segments.length === 0) {
		return <ReasoningSegment text="" streaming={streaming} durationMs={durationMs} />;
	}
	if (segments.length === 1) {
		return <ReasoningSegment text={segments[0]!.text} streaming={segments[0]!.streaming} durationMs={durationMs} />;
	}
	return (
		<div className="flex w-full min-w-0 flex-col gap-2">
			{segments.map((segment, index) => (
				<ReasoningSegment
					key={`reasoning-segment-${index}`}
					text={segment.text}
					streaming={segment.streaming}
					durationMs={!segment.streaming && index === segments.length - 1 ? durationMs : undefined}
				/>
			))}
		</div>
	);
}
