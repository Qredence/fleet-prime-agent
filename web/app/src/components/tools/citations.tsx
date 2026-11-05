"use client";

import { ArrowUpRight, Globe2 } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useId, useState } from "react";
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
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { isSafeExternalUrl } from "@/lib/safe-external-url";
import { cn } from "@/lib/utils";

function getFaviconUrl(value: string) {
	try {
		return new URL("/favicon.ico", value).toString();
	} catch {
		return null;
	}
}

export interface CitationItem {
	id: string;
	title: ReactNode;
	domain?: ReactNode;
	url?: string;
}

export interface CitationsProps {
	citations: CitationItem[];
	title?: ReactNode;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	idPrefix?: string;
	className?: string;
}

export interface CitationProps {
	citationId: string;
	index: number;
	/** Must match the related Citations idPrefix. */
	idPrefix: string;
	className?: string;
}

export interface CitationListProps {
	citations: CitationItem[];
	idPrefix?: string;
	className?: string;
}

function citationTargetId(prefix: string, citationId: string) {
	return `${prefix}-${citationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function CitationFavicon({ url, className }: { url?: string; className?: string }) {
	const favicon = url && isSafeExternalUrl(url) ? getFaviconUrl(url) : null;
	const [failedUrl, setFailedUrl] = useState<string | null>(null);

	return (
		<span
			aria-hidden="true"
			className={cn("grid size-5 shrink-0 place-items-center text-muted-foreground", className)}
		>
			{favicon && failedUrl !== favicon ? (
				<img
					src={favicon}
					alt=""
					width={16}
					height={16}
					loading="lazy"
					referrerPolicy="no-referrer"
					onError={() => setFailedUrl(favicon)}
					className="size-4 rounded-sm object-contain"
				/>
			) : (
				<Globe2 className="size-3.5" />
			)}
		</span>
	);
}

function CitationRow({ citation, index, idPrefix }: { citation: CitationItem; index: number; idPrefix: string }) {
	const safeUrl = citation.url && isSafeExternalUrl(citation.url) ? citation.url : undefined;
	const content = (
		<TraceLine className="w-full max-w-full rounded-md px-1.5 py-1 text-sm group-hover/citation:text-foreground">
			<TraceIcon>
				<CitationFavicon url={citation.url} />
			</TraceIcon>
			<TraceTitle className="font-medium text-foreground/80 transition-colors group-hover/citation:text-foreground">
				{citation.title}
				{safeUrl ? <span className="sr-only"> (opens in a new tab)</span> : null}
			</TraceTitle>
			{citation.domain ? <TraceDescription className="max-w-40 truncate">{citation.domain}</TraceDescription> : null}
			<TraceDescription className="rounded-md bg-foreground/[0.05] px-1.5 py-0.5 text-micro font-semibold">
				{index}
			</TraceDescription>
			{safeUrl ? (
				<TraceIcon>
					<ArrowUpRight />
				</TraceIcon>
			) : null}
		</TraceLine>
	);
	const className = "group/citation block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring";
	const id = citationTargetId(idPrefix, citation.id);

	return safeUrl ? (
		<a id={id} href={safeUrl} target="_blank" rel="noreferrer noopener" className={className}>
			{content}
		</a>
	) : (
		<div id={id} className={className}>
			{content}
		</div>
	);
}

function CitationList({ citations, idPrefix, className }: CitationListProps) {
	const reduce = useReducedMotion() ?? false;
	const baseId = useId();
	const resolvedPrefix = idPrefix ?? `citation-list-${baseId.replace(/:/g, "")}`;

	return (
		<Trace className={cn("gap-0.5", className)}>
			<AnimatePresence mode="popLayout">
				{citations.map((citation, index) => (
					<m.div
						layout="position"
						key={citation.id}
						initial={reduce ? { opacity: 1 } : { opacity: 0, y: 6 }}
						animate={{ opacity: 1, y: 0 }}
						exit={reduce ? { opacity: 0 } : { opacity: 0, y: -3 }}
						transition={
							reduce
								? { duration: 0 }
								: {
										opacity: { duration: 0.18, ease: EASE_OUT },
										y: SPRING_LAYOUT,
										layout: SPRING_LAYOUT,
									}
						}
					>
						<CitationRow citation={citation} index={index + 1} idPrefix={resolvedPrefix} />
					</m.div>
				))}
			</AnimatePresence>
		</Trace>
	);
}

export function Citations({
	citations,
	title = "Sources",
	open,
	defaultOpen = false,
	onOpenChange,
	idPrefix,
	className,
}: CitationsProps) {
	const baseId = useId();
	const resolvedPrefix = idPrefix ?? `citation-${baseId.replace(/:/g, "")}`;
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const currentOpen = open ?? internalOpen;
	const setOpen = useCallback(
		(next: boolean) => {
			if (open === undefined) setInternalOpen(next);
			onOpenChange?.(next);
		},
		[onOpenChange, open],
	);

	return (
		<Trace className={cn("text-sm", className)} data-testid="sources-trace">
			<TraceCollapsible open={currentOpen} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger
					aria-label={`${typeof title === "string" || typeof title === "number" ? title : "Sources"} ${citations.length}`}
				>
					<TraceLine>
						<TraceIcon>
							<Globe2 />
						</TraceIcon>
						<TraceTitle>
							{title} ({citations.length})
						</TraceTitle>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<CitationList citations={citations} idPrefix={resolvedPrefix} />
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
