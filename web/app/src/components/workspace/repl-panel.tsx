import type {
	PrimeAgentArtifact,
	PrimeAgentArtifactRun,
	PrimeAgentKernelDiagnostics,
} from "@prime-agent/web-protocol/chat-protocol";
import { ChevronDown, Code2, SquareTerminal, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { CodeBlock } from "@/components/tools/tool-code-block";
import { ToolResultOutput } from "@/components/tools/tool-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type ReplPanelContentProps = {
	artifactRuns?: Array<PrimeAgentArtifactRun>;
	selectedArtifactId?: string | null;
	kernelDiagnostics?: PrimeAgentKernelDiagnostics | null;
};

const REPL_STATUS_DETAILS: Record<PrimeAgentArtifact["status"], { label: string }> = {
	running: { label: "Running" },
	error: { label: "Failed" },
	cancelled: { label: "Cancelled" },
	success: { label: "Completed" },
};

type ReplOutputDetails = {
	stdout?: string;
	stderr?: string;
	result?: unknown;
	backgroundOutput?: string;
	kernelRestarted?: boolean;
	error?: { ename?: string; evalue?: string } | string;
};

function extractReplOutputDetails(output: unknown): ReplOutputDetails | undefined {
	if (!output || typeof output !== "object") return undefined;
	const record = output as Record<string, unknown>;
	const details =
		record.details && typeof record.details === "object" ? (record.details as Record<string, unknown>) : undefined;
	return { ...record, ...(details ?? {}) } as ReplOutputDetails;
}

function firstNonEmpty(...candidates: Array<unknown>): string {
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) return candidate;
		if (typeof candidate === "number" || typeof candidate === "boolean") return String(candidate);
	}
	return "";
}

/**
 * Gets the human-readable label for an artifact status.
 *
 * @param status - The artifact status to label
 * @returns The display label for the status
 */
function statusLabel(status: PrimeAgentArtifact["status"]): string {
	return REPL_STATUS_DETAILS[status].label;
}

function ReplCell({ artifact, index, selected }: { artifact: PrimeAgentArtifact; index: number; selected: boolean }) {
	const cellRef = useRef<HTMLElement>(null);

	useEffect(() => {
		if (!selected) return;
		requestAnimationFrame(() => {
			cellRef.current?.focus({ preventScroll: true });
			cellRef.current?.scrollIntoView({ block: "nearest" });
		});
	}, [artifact.id, selected]);

	const inputRecord =
		artifact.input && typeof artifact.input === "object" ? (artifact.input as Record<string, unknown>) : undefined;
	const code = typeof inputRecord?.code === "string" ? inputRecord.code : "";
	const isBashCell = code.trimStart().startsWith("%%bash");
	const details = extractReplOutputDetails(artifact.output);
	const backgroundOutput = firstNonEmpty(artifact.backgroundOutput, details?.backgroundOutput);
	const errorText =
		typeof details?.error === "string"
			? details.error
			: details?.error && typeof details.error === "object"
				? firstNonEmpty(details.error.evalue, details.error.ename)
				: "";
	const displayOutput = firstNonEmpty(details?.result, details?.stdout, details?.stderr, errorText);
	const hasError = artifact.status === "error" || Boolean(details?.error);

	return (
		<article
			ref={cellRef}
			tabIndex={-1}
			className="overflow-hidden rounded-md border border-border/60 bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
			data-repl-run-id={artifact.id}
		>
			<div className="flex min-w-0 items-center gap-2 border-b border-border/50 px-2.5 py-1.5">
				<Code2 className="size-3.5 shrink-0 text-foreground/45" />
				<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/70">Cell {index + 1}</span>
				<Badge variant="outline" size="compact" className="font-mono uppercase text-muted-foreground">
					{isBashCell ? "shell" : "python"}
				</Badge>
				<span className="shrink-0 text-xs text-foreground/40">
					{statusLabel(artifact.status)}
					{details?.kernelRestarted ? " · kernel restarted" : ""}
				</span>
			</div>
			<div className="space-y-2 p-2">
				<CodeBlock
					code={code}
					language={isBashCell ? "bash" : "python"}
					languageLabel={isBashCell ? "shell" : "python"}
					status={artifact.status === "running" ? "streaming" : "complete"}
					showStatus={false}
					showLineNumbers={false}
					maxHeight={160}
					wrap
				/>
				{artifact.status !== "running" && displayOutput ? (
					<ToolResultOutput error={hasError} label={hasError ? "reported-error" : "output"}>
						{displayOutput}
					</ToolResultOutput>
				) : null}
				{backgroundOutput ? <ToolResultOutput label="output">{backgroundOutput}</ToolResultOutput> : null}
			</div>
		</article>
	);
}

export function ReplPanelContent({ artifactRuns = [], selectedArtifactId, kernelDiagnostics }: ReplPanelContentProps) {
	const cells = artifactRuns.flatMap((run) => run.artifacts).filter((artifact) => artifact.kind === "ipython");

	return (
		<section aria-label="REPL runs" className="space-y-2 pb-1">
			<div className="flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
				<SquareTerminal className="size-3.5 shrink-0 text-foreground/45" />
				<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/70">CPython cells</span>
				<span className="shrink-0 text-xs text-foreground/40">{cells.length > 0 ? cells.length : "none yet"}</span>
			</div>

			{kernelDiagnostics ? (
				<Collapsible className="overflow-hidden rounded-md border border-border/60 bg-background">
					<CollapsibleTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="compact"
								className="group h-auto w-full justify-start gap-2 rounded-none px-2.5 py-1.5 text-left"
							>
								<TriangleAlert className="size-3.5 shrink-0 text-foreground/45" />
								<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/70">
									Kernel diagnostics
								</span>
								<span className="shrink-0 text-xs text-foreground/40">
									{kernelDiagnostics.truncated ? "tail" : "stderr"}
								</span>
								<ChevronDown className="size-3.5 shrink-0 text-foreground/45 transition-transform group-data-open:rotate-180" />
							</Button>
						}
					/>
					<CollapsibleContent keepMounted>
						<pre className="max-h-48 overflow-auto border-t border-border/50 px-2.5 py-1.5 font-mono text-xs leading-4 whitespace-pre-wrap text-foreground/70">
							{kernelDiagnostics.tail}
						</pre>
					</CollapsibleContent>
				</Collapsible>
			) : null}

			{cells.length === 0 ? (
				<p className="px-2 text-xs leading-4 text-foreground/45">
					Executed CPython cells and their output will appear here.
				</p>
			) : (
				<div className="space-y-2" data-testid="repl-run-list">
					{cells.map((artifact, index) => (
						<ReplCell
							key={artifact.id}
							artifact={artifact}
							index={index}
							selected={artifact.id === selectedArtifactId}
						/>
					))}
				</div>
			)}
		</section>
	);
}
