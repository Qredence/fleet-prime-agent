"use client";

import { Check, Copy, FileCode2, LoaderCircle } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AgentCodeLanguage, AgentCodeLine, useAgentCodeTokens } from "@/components/tools/agent-code";
import {
	CodeBlockActions,
	CodeBlockContent,
	CodeBlockHeader,
	CodeBlockTitle,
	CodeBlock as UiCodeBlock,
} from "@/components/ui/code-block";
import { SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";

const EMPTY_HIGHLIGHT_LINES: number[] = [];

export type CodeBlockStatus = "streaming" | "complete";

export interface CodeBlockProps {
	code: string;
	language?: AgentCodeLanguage;
	languageLabel?: ReactNode;
	filename?: ReactNode;
	status?: CodeBlockStatus;
	showStatus?: boolean;
	showLineNumbers?: boolean;
	highlightLines?: number[];
	maxHeight?: number;
	wrap?: boolean;
	copyable?: boolean;
	onCopy?: () => void | Promise<void>;
}

export function CodeBlock({
	code,
	language = "typescript",
	languageLabel,
	filename,
	status = "complete",
	showStatus = true,
	showLineNumbers = true,
	highlightLines = EMPTY_HIGHLIGHT_LINES,
	maxHeight = 280,
	wrap = false,
	copyable = true,
	onCopy,
}: CodeBlockProps) {
	const reduce = useReducedMotion() ?? false;
	const viewportRef = useRef<HTMLPreElement>(null);
	const copyTimer = useRef<number | undefined>(undefined);
	const [copied, setCopied] = useState(false);
	const streaming = status === "streaming";
	const tokens = useAgentCodeTokens(code, language);
	const highlighted = useMemo(() => new Set(highlightLines), [highlightLines]);
	let offset = 0;
	const lines = code.split("\n").map((content) => {
		const line = { content, offset };
		offset += content.length + 1;
		return line;
	});
	const resolvedLanguageLabel =
		languageLabel ??
		(
			{
				bash: "Bash",
				diff: "Diff",
				json: "JSON",
				python: "Python",
				text: "Text",
				tsx: "TSX",
				typescript: "TypeScript",
			} satisfies Record<AgentCodeLanguage, string>
		)[language];

	useEffect(
		() => () => {
			if (copyTimer.current) window.clearTimeout(copyTimer.current);
		},
		[],
	);

	useLayoutEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || !streaming) return;

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
		else await navigator.clipboard?.writeText(code);

		setCopied(true);
		if (copyTimer.current) window.clearTimeout(copyTimer.current);
		copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
	}, [code, onCopy]);

	return (
		<UiCodeBlock data-state={status} aria-busy={streaming} size="sm" className="bg-muted/80">
			<CodeBlockHeader className="h-10 gap-2.5 px-3 pt-0">
				<FileCode2 aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
				{filename ? (
					<CodeBlockTitle className="font-mono text-xs text-foreground/80">{filename}</CodeBlockTitle>
				) : null}
				<span className="text-micro font-medium uppercase tracking-wide text-muted-foreground/55">
					{resolvedLanguageLabel}
				</span>
				{showStatus ? (
					<span
						className={cn(
							!copyable && !onCopy && "ml-auto",
							"inline-flex shrink-0 items-center gap-1 text-micro font-medium",
							streaming ? "text-info" : "text-success",
						)}
					>
						{streaming ? (
							<LoaderCircle className={cn("size-3", !reduce && "animate-spin")} />
						) : (
							<Check className="size-3" />
						)}
						{streaming ? "Writing" : "Ready"}
					</span>
				) : null}
				{copyable || onCopy ? (
					<CodeBlockActions className={cn("-my-0 -me-0", showStatus ? "ms-0" : "ms-auto")}>
						<m.button
							type="button"
							aria-label={copied ? "Copied" : "Copy code"}
							title={copied ? "Copied" : "Copy code"}
							onClick={handleCopy}
							whileTap={reduce ? undefined : { scale: 0.96 }}
							transition={SPRING_PRESS}
							className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
						>
							{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
						</m.button>
					</CodeBlockActions>
				) : null}
			</CodeBlockHeader>

			<CodeBlockContent
				ref={viewportRef}
				role={streaming ? "log" : undefined}
				aria-live={streaming ? "off" : undefined}
				className="max-w-full overflow-auto border-t border-foreground/[0.06] px-0 py-2 font-mono text-xs leading-5 text-foreground/85 [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_35%,transparent)_transparent] [scrollbar-width:thin]"
				style={{ maxHeight }}
				wrap={wrap}
			>
				{lines.map((line, index) => {
					const lineNumber = index + 1;
					return (
						<span
							key={line.offset}
							data-line-number={showLineNumbers ? lineNumber : undefined}
							className={cn(
								"grid min-h-5",
								showLineNumbers
									? "grid-cols-[2.75rem_minmax(0,1fr)] before:content-[attr(data-line-number)] before:select-none before:pr-3 before:text-right before:tabular-nums before:text-muted-foreground/35"
									: "grid-cols-1",
								highlighted.has(lineNumber) && "bg-primary/[0.07]",
							)}
						>
							<AgentCodeLine
								code={line.content}
								tokens={tokens?.[index]}
								suffix={index < lines.length - 1 ? "\n" : undefined}
								className={cn(
									"pr-4",
									showLineNumbers ? "pl-1" : "pl-4",
									wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
								)}
							/>
						</span>
					);
				})}
			</CodeBlockContent>
		</UiCodeBlock>
	);
}
