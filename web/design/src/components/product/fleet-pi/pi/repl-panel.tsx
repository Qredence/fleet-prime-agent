import { Code2, SquareTerminal } from "lucide-react"
import type { PrimeAgentArtifact, PrimeAgentArtifactRun } from "@prime-agent/web-protocol/chat-protocol"
import { IpythonTool } from "../../../registry/beui/agents/tools/ipython-tool"

type ReplPanelContentProps = {
	artifactRuns?: Array<PrimeAgentArtifactRun>
}

function toolState(status: PrimeAgentArtifact["status"]): string {
	if (status === "running") return "input-streaming"
	if (status === "error") return "output-error"
	if (status === "cancelled") return "aborted"
	return "output-available"
}

function ipythonPart(artifact: PrimeAgentArtifact) {
	return {
		type: "tool-IPython",
		toolCallId: artifact.sourceToolCallId ?? artifact.id,
		state: toolState(artifact.status),
		input: artifact.input,
		output: artifact.output,
	}
}

function statusLabel(status: PrimeAgentArtifact["status"]): string {
	if (status === "running") return "Running"
	if (status === "error") return "Failed"
	if (status === "cancelled") return "Cancelled"
	return "Completed"
}

export function ReplPanelContent({ artifactRuns = [] }: ReplPanelContentProps) {
	const cells = artifactRuns
		.flatMap((run) => run.artifacts)
		.filter((artifact) => artifact.kind === "ipython")

	return (
		<section aria-label="REPL runs" className="space-y-2 pb-1">
			<div className="flex min-w-0 items-center gap-2 rounded-sm bg-foreground/5 px-2 py-1.5">
				<SquareTerminal className="size-3.5 shrink-0 text-foreground/45" />
				<span className="min-w-0 flex-1 truncate text-label font-medium text-foreground/70">
					IPython cells
				</span>
				<span className="shrink-0 text-[10px] text-foreground/40">
					{cells.length > 0 ? cells.length : "none yet"}
				</span>
			</div>

			{cells.length === 0 ? (
				<p className="px-2 text-[11px] leading-4 text-foreground/45">
					Executed IPython cells and their output will appear here.
				</p>
			) : (
				<div className="space-y-2" data-testid="repl-run-list">
					{cells.map((artifact, index) => (
						<article
							key={artifact.id}
							className="overflow-hidden rounded-md border border-border/60 bg-background"
							data-repl-run-id={artifact.id}
						>
							<div className="flex min-w-0 items-center gap-2 border-b border-border/50 px-2.5 py-1.5">
								<Code2 className="size-3.5 shrink-0 text-foreground/45" />
								<span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground/70">
									Cell {index + 1}
								</span>
								<span className="shrink-0 text-[10px] text-foreground/40">
									{statusLabel(artifact.status)}
								</span>
							</div>
							<div className="p-2">
								<IpythonTool part={ipythonPart(artifact)} />
							</div>
						</article>
					))}
				</div>
			)}
		</section>
	)
}
