import { memo } from "react";
import { useToolComplete } from "@/components/chat/hooks/use-tool-complete";
import type { StepState, TimelineStep } from "@/components/tools/timeline";
import type { ToolApproval } from "@/components/tools/tool-approval-footer";
import { ToolApprovalFooter } from "@/components/tools/tool-approval-footer";
import { ToolTextShimmer } from "@/components/tools/tool-text-shimmer";
import { adaptToolPart } from "@/components/tools/utils/tool-adapters";

function extractCommandSummary(cmd: string): string {
	return cmd
		.split("|")
		.map((s) => s.trim().split(/\s+/)[0] ?? "")
		.filter(Boolean)
		.slice(0, 4)
		.join(", ");
}

type BashToolTerminalCardProps = {
	step: Extract<TimelineStep, { type: "tool-call" }>;
	state: StepState;
	onComplete: () => void;
	approval?: ToolApproval;
};

function BashToolTerminalCard({ step, state, onComplete, approval }: BashToolTerminalCardProps) {
	useToolComplete(state === "animating", step.duration, onComplete);
	const isPending = state === "animating";
	const command = step.bashCommand ?? step.toolDetail;
	const summary = extractCommandSummary(command);

	return (
		<div className="overflow-hidden rounded-chat-tool border border-border bg-muted">
			<div className="flex h-7 items-center justify-between pr-2 pl-2.5">
				<div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
					{isPending ? (
						<ToolTextShimmer
							as="span"
							duration={1.2}
							className="m-0 inline-flex h-full items-center truncate text-xs leading-none"
						>
							Running command: {summary}
						</ToolTextShimmer>
					) : (
						<span className="truncate text-xs text-muted-foreground">Ran command: {summary}</span>
					)}
				</div>
				{isPending && (
					<svg className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" viewBox="0 0 16 16" fill="none">
						<circle
							cx="8"
							cy="8"
							r="6"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeDasharray="28"
							strokeDashoffset="7"
							strokeLinecap="round"
						/>
					</svg>
				)}
			</div>
			<div className="overflow-hidden border-t border-border bg-background px-2.5 py-1.5 font-mono text-label leading-[16px]">
				<div className="break-all">
					<span className="text-amber-600 select-none dark:text-amber-400">$ </span>
					<span className="text-foreground">{command}</span>
				</div>
				{!isPending && step.bashOutput && (
					<div className="mt-1 max-h-[80px] overflow-hidden whitespace-pre-line text-muted-foreground">
						{step.bashOutput}
					</div>
				)}
			</div>
			{approval && <ToolApprovalFooter isPending={isPending} {...approval} />}
		</div>
	);
}

export type BashToolProps = {
	part: any;
};

export const BashTool = memo(function BashTool({ part }: BashToolProps) {
	const approval = (part.input?.approval ?? part.args?.approval) as ToolApproval | undefined;
	const { step, stepState } = adaptToolPart(part, "Bash");
	const noop = () => {};

	return <BashToolTerminalCard step={step} state={stepState} onComplete={noop} approval={approval} />;
});
