import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toolActionIconForName } from "@/components/tools/tool-action-icon";
import { toolRegistry } from "@/components/tools/tool-registry";
import { ToolTextShimmer } from "@/components/tools/tool-text-shimmer";
import { formatElapsedTime, getToolStatus, useElapsedTime } from "@/components/tools/utils/format-tool";
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
import { cn } from "@/lib/utils";

export type ToolGroupProps = {
	part: any;
	nestedTools?: Array<any>;
	chatStatus?: string;
	completeLabel: string;
	shimmerLabel?: string;
	interruptedLabel: string;
	maxVisibleTools?: number;
	defaultOpen?: boolean;
	showElapsed?: boolean;
};

const EMPTY_NESTED_TOOLS: Array<any> = [];

function formatCount(value: number, label: string): string {
	return `${value} ${value === 1 ? label : `${label}s`}`;
}

function summarizeNestedTools(nestedTools: Array<any>): string {
	if (nestedTools.length === 0) return "";
	const fileTypes = new Set(["tool-Read", "tool-Edit", "tool-Write"]);
	const searchTypes = new Set(["tool-Search", "tool-Grep", "tool-Glob", "tool-WebSearch"]);
	const commandTypes = new Set(["tool-Bash"]);

	let fileCount = 0;
	let searchCount = 0;
	let commandCount = 0;

	for (const tool of nestedTools) {
		if (fileTypes.has(tool.type)) fileCount += 1;
		else if (searchTypes.has(tool.type)) searchCount += 1;
		else if (commandTypes.has(tool.type)) commandCount += 1;
	}

	const parts: Array<string> = [];
	if (fileCount > 0) parts.push(formatCount(fileCount, "file"));
	if (searchCount > 0) parts.push(`${searchCount} ${searchCount === 1 ? "search" : "searches"}`);
	if (commandCount > 0) parts.push(formatCount(commandCount, "command"));

	if (parts.length === 0) return "";
	if (parts.length === 1) return parts[0];
	if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
	return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function getNestedCounts(nestedTools: Array<any>) {
	const fileTypes = new Set(["tool-Read", "tool-Edit", "tool-Write"]);
	const searchTypes = new Set(["tool-Search", "tool-Grep", "tool-Glob", "tool-WebSearch"]);
	let fileCount = 0;
	let searchCount = 0;

	for (const tool of nestedTools) {
		if (fileTypes.has(tool.type)) fileCount += 1;
		else if (searchTypes.has(tool.type)) searchCount += 1;
	}

	return { fileCount, searchCount };
}

function formatStreamCounts(fileCount: number, searchCount: number): string {
	const parts: Array<string> = [];
	if (fileCount > 0) parts.push(formatCount(fileCount, "file"));
	if (searchCount > 0) parts.push(`${searchCount} ${searchCount === 1 ? "search" : "searches"}`);
	return parts.join(", ");
}

export const ToolGroup = memo(function ToolGroup({
	part,
	nestedTools = EMPTY_NESTED_TOOLS,
	chatStatus,
	completeLabel,
	shimmerLabel,
	interruptedLabel,
	maxVisibleTools = 5,
	defaultOpen,
	showElapsed = true,
}: ToolGroupProps) {
	const { isPending, isInterrupted } = getToolStatus(part, chatStatus);
	const description = part.input?.description || "";
	const [expanded, setExpanded] = useState(defaultOpen ?? false);
	const [visibleCount, setVisibleCount] = useState(0);
	const startedAt =
		(part.callProviderMetadata?.custom?.startedAt as number | undefined) ?? (part.startedAt as number | undefined);
	const hasNestedTools = nestedTools.length > 0;
	const streamKey = part.toolCallId ?? part.id ?? "";
	const outputDuration = part.output?.totalDurationMs || part.output?.duration || part.output?.duration_ms;
	const maskThreshold = 4;
	const streamHeight = Math.max(1, maxVisibleTools) * 28;
	const visibleToolCount = isPending ? Math.max(visibleCount, 0) : nestedTools.length;
	const wasPendingRef = useRef(isPending);
	const userToggledRef = useRef(false);
	const openTimerRef = useRef<number | null>(null);
	const { fileCount, searchCount } = useMemo(() => {
		const visibleTools = isPending ? nestedTools.slice(0, Math.max(visibleCount, 0)) : nestedTools;
		return getNestedCounts(visibleTools);
	}, [isPending, nestedTools, visibleCount]);
	const streamCounts = formatStreamCounts(fileCount, searchCount);
	const listRef = useRef<HTMLDivElement | null>(null);
	const elapsedMs = useElapsedTime(startedAt, isPending);

	useEffect(() => {
		const wasPending = wasPendingRef.current;
		if (openTimerRef.current) {
			window.clearTimeout(openTimerRef.current);
			openTimerRef.current = null;
		}
		if (isPending && !wasPending) {
			if (!userToggledRef.current && defaultOpen !== false) {
				setExpanded(false);
				openTimerRef.current = window.setTimeout(() => {
					setExpanded(true);
				}, 60);
			}
		}
		if (!isPending && wasPending) {
			setExpanded(false);
			userToggledRef.current = false;
		}
		wasPendingRef.current = isPending;
		return () => {
			if (openTimerRef.current) {
				window.clearTimeout(openTimerRef.current);
				openTimerRef.current = null;
			}
		};
	}, [defaultOpen, isPending]);

	useEffect(() => {
		if (!isPending || nestedTools.length === 0) {
			setVisibleCount(nestedTools.length);
			return;
		}
		let index = 1;
		setVisibleCount(Math.min(index, nestedTools.length));
		const interval = setInterval(() => {
			index += 1;
			setVisibleCount(Math.min(index, nestedTools.length));
			if (index >= nestedTools.length) clearInterval(interval);
		}, 450);
		return () => clearInterval(interval);
	}, [isPending, nestedTools.length, streamKey]);

	useEffect(() => {
		if (!isPending || !listRef.current) return;
		listRef.current.scrollTop = listRef.current.scrollHeight;
	}, [isPending, visibleCount]);

	const subtitle = (() => {
		if (isPending && hasNestedTools) {
			return streamCounts;
		}

		if (!isPending && hasNestedTools) {
			const summary = summarizeNestedTools(nestedTools);
			if (summary) return summary;
		}

		if (!description) return "";
		return description.length > 60 ? `${description.slice(0, 57)}…` : description;
	})();
	const elapsedTimeDisplay = formatElapsedTime(!isPending && outputDuration ? outputDuration : elapsedMs);
	const TaskIcon = toolActionIconForName(part.type === "tool-Agent" ? "agent" : "task");
	const statusText = isPending ? "running" : isInterrupted ? "interrupted" : "done";
	const summary = isPending && shimmerLabel ? shimmerLabel : completeLabel;
	const summaryLine = (
		<TraceLine status={isPending ? "running" : undefined}>
			<TraceIcon>
				<TaskIcon />
			</TraceIcon>
			<TraceTitle>
				{isPending && shimmerLabel ? (
					<ToolTextShimmer as="span" duration={1.2} className="m-0 inline-flex h-4 items-center leading-none">
						{summary}
					</ToolTextShimmer>
				) : (
					summary
				)}
			</TraceTitle>
			{subtitle ? <TraceDescription className="max-w-56 truncate">{subtitle}</TraceDescription> : null}
			<TraceDescription>{statusText}</TraceDescription>
			{showElapsed && elapsedTimeDisplay ? <TraceDescription>{elapsedTimeDisplay}</TraceDescription> : null}
		</TraceLine>
	);
	const childTrace = (
		<Trace className="gap-1">
			{(isPending ? nestedTools.slice(0, Math.max(visibleCount, 0)) : nestedTools).map((nestedPart, idx) => {
				const derivedPart = isPending
					? { ...nestedPart, state: idx === visibleCount - 1 ? "input-streaming" : "output-available" }
					: nestedPart;
				const nestedMeta = toolRegistry[derivedPart.type];
				if (!nestedMeta) return null;
				const { isPending: nestedIsPending, isError: nestedIsError } = getToolStatus(derivedPart, chatStatus);
				const NestedIcon = nestedMeta.icon;
				return (
					<TraceLine
						key={
							derivedPart.toolCallId ?? derivedPart.id ?? `${derivedPart.type}-${nestedMeta.title(derivedPart)}`
						}
						status={nestedIsPending ? "running" : nestedIsError ? "error" : undefined}
					>
						<TraceIcon>
							<NestedIcon />
						</TraceIcon>
						<TraceTitle>{nestedMeta.title(derivedPart)}</TraceTitle>
						{nestedMeta.subtitle?.(derivedPart) ? (
							<TraceDescription className="max-w-56 truncate">
								{nestedMeta.subtitle(derivedPart)}
							</TraceDescription>
						) : null}
					</TraceLine>
				);
			})}
		</Trace>
	);

	if (isInterrupted && !part.output) {
		return (
			<Trace>
				<TraceLine>
					<TraceIcon>
						<TaskIcon />
					</TraceIcon>
					<TraceTitle>{interruptedLabel}</TraceTitle>
					<TraceDescription>interrupted</TraceDescription>
				</TraceLine>
			</Trace>
		);
	}

	return (
		<Trace>
			{hasNestedTools ? (
				<TraceCollapsible
					open={expanded}
					onOpenChange={(next) => {
						userToggledRef.current = true;
						setExpanded(next);
					}}
				>
					<TraceCollapsibleTrigger
						aria-label={`${completeLabel}: ${subtitle || nestedTools.length} ${statusText}`}
					>
						{summaryLine}
					</TraceCollapsibleTrigger>
					<TraceCollapsibleContent>
						<div className="relative">
							{isPending && expanded && visibleToolCount > maskThreshold && (
								<div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-linear-to-b from-background to-transparent" />
							)}
							<div
								ref={listRef}
								className={cn(isPending && expanded && visibleToolCount > maskThreshold && "overflow-y-auto")}
								style={
									isPending && expanded && visibleToolCount > maskThreshold
										? { height: `${streamHeight}px` }
										: undefined
								}
							>
								{childTrace}
							</div>
						</div>
					</TraceCollapsibleContent>
				</TraceCollapsible>
			) : (
				summaryLine
			)}
		</Trace>
	);
});
