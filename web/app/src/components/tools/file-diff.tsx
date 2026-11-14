"use client";

import { Ban, Check, ChevronDown, CircleX, Copy, FileCode2, LoaderCircle } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AgentCodeLine } from "@/components/tools/tool-code-block";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SPRING_SWAP } from "@/lib/ease";
import { type AgentCodeLanguage, useAgentCodeTokens } from "@/lib/shiki-highlight";
import { cn } from "@/lib/utils";

export type FileDiffStatus = "streaming" | "complete" | "error" | "cancelled";
export type FileDiffLineType = "added" | "removed" | "context";

export interface FileDiffLine {
	id: string;
	type?: FileDiffLineType;
	oldLine?: number;
	newLine?: number;
	content: string;
}

export interface FileDiffProps {
	file: ReactNode;
	lines: FileDiffLine[];
	status?: FileDiffStatus;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	collapseOnComplete?: boolean;
	maxHeight?: number;
	language?: AgentCodeLanguage;
	copyText?: string;
	onCopy?: () => void | Promise<void>;
	className?: string;
}

function ChangeCount({ value, type }: { value: number; type: "added" | "removed" }) {
	if (!value) return null;
	return (
		<span
			className={cn(
				"font-mono text-xs tabular-nums",
				type === "added" ? "text-product-diff-added" : "text-product-diff-removed",
			)}
		>
			{type === "added" ? "+" : "−"}
			{value}
		</span>
	);
}

export function FileDiff({
	file,
	lines,
	status = "streaming",
	open,
	defaultOpen = true,
	onOpenChange,
	collapseOnComplete = true,
	maxHeight = 220,
	language = "typescript",
	copyText,
	onCopy,
	className,
}: FileDiffProps) {
	const reduce = useReducedMotion() ?? false;
	const baseId = useId();
	const triggerId = `${baseId}-trigger`;
	const contentId = `${baseId}-content`;
	const viewportRef = useRef<HTMLDivElement>(null);
	const previousStatus = useRef(status);
	const copyTimer = useRef<number | undefined>(undefined);
	const [copied, setCopied] = useState(false);
	const [internalOpen, setInternalOpen] = useState(defaultOpen);
	const currentOpen = open ?? internalOpen;
	const streaming = status === "streaming";
	const additions = lines.filter((line) => line.type === "added").length;
	const deletions = lines.filter((line) => line.type === "removed").length;
	const canCopy = Boolean(copyText || onCopy);
	const code = lines.map((line) => line.content).join("\n");
	const tokens = useAgentCodeTokens(code, language);

	const setOpen = useCallback(
		(next: boolean) => {
			if (open === undefined) setInternalOpen(next);
			onOpenChange?.(next);
		},
		[onOpenChange, open],
	);

	useEffect(() => {
		if (previousStatus.current !== "streaming" && status === "streaming") {
			setOpen(true);
		}
		if (previousStatus.current === "streaming" && status !== "streaming" && collapseOnComplete) {
			setOpen(false);
		}
		previousStatus.current = status;
	}, [collapseOnComplete, setOpen, status]);

	useEffect(
		() => () => {
			if (copyTimer.current) window.clearTimeout(copyTimer.current);
		},
		[],
	);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || !currentOpen || !streaming) return;

		const frame = requestAnimationFrame(() => {
			if (viewport.scrollHeight <= viewport.clientHeight) return;
			if (typeof viewport.scrollTo === "function") {
				viewport.scrollTo({
					top: viewport.scrollHeight,
					behavior: reduce ? "auto" : "smooth",
				});
			} else {
				viewport.scrollTop = viewport.scrollHeight;
			}
		});
		return () => cancelAnimationFrame(frame);
	});

	const handleCopy = useCallback(async () => {
		if (onCopy) await onCopy();
		else if (copyText) await navigator.clipboard?.writeText(copyText);

		setCopied(true);
		if (copyTimer.current) window.clearTimeout(copyTimer.current);
		copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
	}, [copyText, onCopy]);

	return (
		<Collapsible
			open={currentOpen}
			onOpenChange={setOpen}
			data-state={status}
			aria-busy={streaming}
			className={cn("w-full text-sm", className)}
		>
			<CollapsibleTrigger
				render={
					<Button
						id={triggerId}
						type="button"
						variant="ghost"
						className="group flex h-auto min-h-9 w-full justify-start gap-2 rounded-md px-0 py-1 text-left font-normal text-foreground hover:bg-transparent [&>span]:w-full [&>span>span]:w-full"
					/>
				}
			>
				<FileCode2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80">{file}</span>
				<span className="flex shrink-0 items-center gap-2">
					<ChangeCount value={additions} type="added" />
					<ChangeCount value={deletions} type="removed" />
				</span>
				<span className="grid size-4 shrink-0 place-items-center text-muted-foreground/60">
					{streaming ? (
						<LoaderCircle aria-label="Applying changes" className={cn("size-3.5", !reduce && "animate-spin")} />
					) : status === "error" ? (
						<CircleX aria-label="Changes failed" className="size-3.5" />
					) : status === "cancelled" ? (
						<Ban aria-label="Changes cancelled" className="size-3.5" />
					) : (
						<Check aria-label="Changes applied" className="size-3.5" />
					)}
				</span>
				<m.span
					aria-hidden="true"
					animate={{ rotate: currentOpen ? 180 : 0 }}
					transition={reduce ? { duration: 0 } : SPRING_SWAP}
					className="shrink-0 text-muted-foreground/45 transition-colors group-hover:text-muted-foreground"
				>
					<ChevronDown className="size-3.5" />
				</m.span>
			</CollapsibleTrigger>

			<CollapsibleContent
				id={contentId}
				keepMounted
				role="region"
				aria-labelledby={triggerId}
				className="overflow-hidden"
			>
				<div className="pl-6 pt-1.5">
					<div className="overflow-hidden rounded-xl bg-muted/80">
						<div
							ref={viewportRef}
							data-slot="file-diff-viewport"
							aria-live={streaming ? "off" : "polite"}
							className="no-scrollbar overflow-auto"
							style={{ maxHeight }}
						>
							<div className="font-mono text-xs leading-5">
								<span className="sr-only">File changes</span>
								{lines.map((line, index) => {
									const type = line.type ?? "context";
									return (
										<div
											key={line.id}
											className={cn(
												"grid grid-cols-[2.25rem_2.25rem_1rem_minmax(0,1fr)]",
												type === "added" && "bg-success/[0.07]",
												type === "removed" && "bg-destructive/[0.07]",
											)}
										>
											<span className="select-none pr-2 text-right tabular-nums text-muted-foreground/40">
												{line.oldLine}
											</span>
											<span className="select-none pr-2 text-right tabular-nums text-muted-foreground/40">
												{line.newLine}
											</span>
											<span
												className={cn(
													"select-none text-center text-muted-foreground/45",
													type === "added" && "text-product-diff-added",
													type === "removed" && "text-product-diff-removed",
												)}
											>
												{type === "added" ? "+" : type === "removed" ? "−" : ""}
											</span>
											<AgentCodeLine
												code={line.content}
												tokens={tokens?.[index]}
												className="min-w-0 whitespace-pre px-1.5"
											/>
										</div>
									);
								})}
							</div>
						</div>

						{canCopy ? (
							<div className="flex justify-end px-2 pb-1.5 pt-1">
								<Button
									type="button"
									variant="ghost"
									size="icon-compact"
									aria-label={copied ? "Copied" : "Copy diff"}
									title={copied ? "Copied" : "Copy diff"}
									onClick={handleCopy}
									className="size-7 text-muted-foreground hover:bg-background/70 hover:text-foreground enabled:active:scale-[0.96]"
								>
									{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
								</Button>
							</div>
						) : null}
					</div>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
