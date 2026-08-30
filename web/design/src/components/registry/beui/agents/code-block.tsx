"use client";
// beui.dev/components/agents/chat-app

import { Check, Copy, FileCode2, LoaderCircle } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AgentCodeLanguage,
  AgentCodeLine,
  useAgentCodeTokens,
} from "@prime-agent/web-design/components/registry/beui/agents/agent-code";
import { SPRING_PRESS } from "@prime-agent/web-design/lib/ease";
import { cn } from "@prime-agent/web-design/lib/utils";

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
  className?: string;
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
  className,
}: CodeBlockProps) {
  const reduce = useReducedMotion() ?? false;
  const viewportRef = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const streaming = status === "streaming";
  const tokens = useAgentCodeTokens(code, language);
  const highlighted = useMemo(
    () => new Set(highlightLines),
    [highlightLines],
  );
  let offset = 0;
	const lines = code.split("\n").map((content) => {
    const line = { content, offset };
    offset += content.length + 1;
    return line;
	});
	const resolvedLanguageLabel =
		languageLabel ??
		({
			bash: "Bash",
			diff: "Diff",
			json: "JSON",
			python: "Python",
			text: "Text",
			tsx: "TSX",
			typescript: "TypeScript",
		} satisfies Record<AgentCodeLanguage, string>)[language];

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
    <div
      data-state={status}
      aria-busy={streaming}
      className={cn(
        "w-full overflow-hidden rounded-2xl bg-muted/80 text-sm",
        className,
      )}
    >
      <div className="flex h-10 items-center gap-2.5 px-3">
        <FileCode2
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground/70"
        />
		{filename ? (
          <span className="min-w-0 truncate font-mono text-xs text-foreground/80">
            {filename}
          </span>
		) : null}
		<span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/55">
			{resolvedLanguageLabel}
		</span>
		{showStatus ? (
			<span
				className={cn(
					"ml-auto inline-flex shrink-0 items-center gap-1 text-[10px] font-medium",
					streaming
						? "text-blue-600 dark:text-blue-400"
						: "text-emerald-600 dark:text-emerald-400",
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
			<m.button
            type="button"
            aria-label={copied ? "Copied" : "Copy code"}
            title={copied ? "Copied" : "Copy code"}
            onClick={handleCopy}
            whileTap={reduce ? undefined : { scale: 0.9 }}
            transition={SPRING_PRESS}
				className={cn(
					"grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
					!showStatus && "ml-auto",
				)}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </m.button>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        role={streaming ? "log" : undefined}
        aria-live={streaming ? "polite" : undefined}
        className="overflow-auto border-t border-foreground/[0.06] py-2 [scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_35%,transparent)_transparent] [scrollbar-width:thin]"
        style={{ maxHeight }}
      >
        <pre className="m-0 min-w-max font-mono text-xs leading-5 text-foreground/85">
          <code>
            {lines.map((line, index) => {
              const lineNumber = index + 1;
              return (
                <span
                  key={line.offset}
                  className={cn(
                    "grid min-h-5",
                    showLineNumbers
                      ? "grid-cols-[2.75rem_minmax(0,1fr)]"
                      : "grid-cols-1",
                    highlighted.has(lineNumber) && "bg-blue-500/[0.07]",
                  )}
                >
                  {showLineNumbers ? (
                    <span className="select-none pr-3 text-right tabular-nums text-muted-foreground/35">
                      {lineNumber}
                    </span>
                  ) : null}
                  <AgentCodeLine
                    code={line.content}
                    tokens={tokens?.[index]}
                    className={cn(
                      "pr-4",
                      showLineNumbers ? "pl-1" : "pl-4",
                      wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                    )}
                  />
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}
