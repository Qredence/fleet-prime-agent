import { Code2, SquareTerminal } from "lucide-react"
import { useEffect, useRef } from "react"
import type { PrimeAgentArtifact, PrimeAgentArtifactRun } from "@prime-agent/web-protocol/chat-protocol"
import { IpythonTool } from "../../../registry/beui/agents/tools/ipython-tool"

type ReplPanelContentProps = {
	artifactRuns?: Array<PrimeAgentArtifactRun>
	selectedArtifactId?: string | null
}

const REPL_STATUS_DETAILS: Record<PrimeAgentArtifact["status"], { toolState: string; label: string }> = {
	running: { toolState: "input-streaming", label: "Running" },
	error: { toolState: "output-error", label: "Failed" },
	cancelled: { toolState: "aborted", label: "Cancelled" },
	success: { toolState: "output-available", label: "Completed" },
}

/**
 * Maps an artifact status to the corresponding REPL tool state.
 *
 * @param status - The artifact status to map
 * @returns The corresponding REPL tool state
 */
function toolState(status: PrimeAgentArtifact["status"]): string {
	return REPL_STATUS_DETAILS[status].toolState
}

/**
 * Builds the IPython tool data for an artifact.
 *
 * @param artifact - The artifact providing the tool call identifier, status, input, and output.
 * @returns The IPython tool part derived from the artifact.
 */
function ipythonPart(artifact: PrimeAgentArtifact) {
	return {
		type: "tool-IPython",
		toolCallId: artifact.sourceToolCallId ?? artifact.id,
		state: toolState(artifact.status),
		input: artifact.input,
		output: artifact.output,
	}
}

/**
 * Gets the human-readable label for an artifact status.
 *
 * @param status - The artifact status to label
 * @returns The display label for the status
 */
function statusLabel(status: PrimeAgentArtifact["status"]): string {
	return REPL_STATUS_DETAILS[status].label
}

/**
 * Renders an IPython artifact as a numbered REPL cell with its current status.
 *
 * @param artifact - The IPython artifact to render
 * @param index - The zero-based position of the cell
 * @param selected - Whether the cell should receive focus and scroll into view
 */
function ReplCell({ artifact, index, selected }: { artifact: PrimeAgentArtifact; index: number; selected: boolean }) {
	const cellRef = useRef<HTMLElement>(null)

	useEffect(() => {
		if (!selected) return
		requestAnimationFrame(() => {
			cellRef.current?.focus({ preventScroll: true })
			cellRef.current?.scrollIntoView({ block: "nearest" })
		})
	}, [artifact.id, selected])

	return (
		<article
			ref={cellRef}
			tabIndex={-1}
			className="overflow-hidden rounded-md border border-border/60 bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
	)
}

/**
 * Renders the IPython cells from the available artifact runs.
 *
 * @param artifactRuns - Artifact runs whose IPython cells should be displayed
 * @param selectedArtifactId - Identifier of the cell to focus and scroll into view
 * @returns The REPL panel content
 */
export function ReplPanelContent({ artifactRuns = [], selectedArtifactId }: ReplPanelContentProps) {
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
	)
}
