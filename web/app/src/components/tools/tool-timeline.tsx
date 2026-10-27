"use client";

import type { PrimeAgentArtifact } from "@prime-agent/web-protocol/chat-protocol";
import type { ChatMessage } from "@prime-agent/web-protocol/chat-types";
import type { ReactNode } from "react";
import { lazy, Suspense, useMemo, useState } from "react";
import type { ToolPartBase } from "@/components/chat/transcript/chat-message-parts";
import { toolActionIconForName } from "@/components/tools/tool-action-icon";
import { normalizeToolPart } from "@/components/tools/tool-output-normalizer";
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

const LazySessionToolRenderer = lazy(() =>
	import("@/components/tools/session-tool-renderer").then(({ SessionToolRenderer }) => ({
		default: SessionToolRenderer,
	})),
);

const NO_ARTIFACTS: readonly PrimeAgentArtifact[] = [];

type TimelineStep = {
	id: string;
	verb: string;
	target: string;
	status: "running" | "complete" | "error" | "cancelled" | "pending";
	artifactId?: string;
	artifactTitle?: string;
	artifactTarget?: "artifacts" | "repl";
	part?: ToolPartBase;
	nestedTools?: Array<ToolPartBase>;
	traceDescription?: string;
	durationLabel?: string;
	reportedError?: boolean;
};

type ToolTimelineProps = {
	messages: readonly ChatMessage[];
	artifacts?: readonly PrimeAgentArtifact[];
	streaming: boolean;
	className?: string;
	onOpenArtifact?: (artifactId: string, target?: "artifacts" | "repl") => void;
	renderToolDetails?: (part: ToolPartBase, streaming: boolean, nestedTools?: Array<ToolPartBase>) => ReactNode;
};

function artifactPanel(kind: PrimeAgentArtifact["kind"]): "artifacts" | "repl" {
	return kind === "ipython" ? "repl" : "artifacts";
}

function withArtifact(step: TimelineStep, artifact: PrimeAgentArtifact | undefined): TimelineStep {
	if (!artifact) return step;
	return {
		...step,
		artifactId: artifact.id,
		artifactTitle: artifact.title,
		artifactTarget: artifactPanel(artifact.kind),
	};
}

/**
 * Converts a non-null, non-array object into a string-keyed record.
 *
 * @param value - The value to convert
 * @returns The value as a record, or `undefined` for other values
 */
function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Determines the timeline status for a tool action.
 *
 * @param part - Tool action data containing its state and output information
 * @param streaming - Whether the conversation is currently streaming
 * @returns The corresponding timeline status
 */
function status(part: Record<string, unknown>, streaming: boolean): TimelineStep["status"] {
	const state = part.state;
	if (state === "output-error" || state === "error") return "error";
	if (state === "cancelled" || state === "canceled" || state === "aborted" || state === "interrupted")
		return "cancelled";
	if (state === "input-streaming" || state === "streaming") return streaming ? "running" : "cancelled";
	if (state === "input-available" || state === "pending" || state === "queued") return "pending";
	return streaming && part.output === undefined && part.result === undefined ? "running" : "complete";
}

/**
 * Converts a supported tool message part into a timeline step.
 *
 * @param part - The tool message part to convert
 * @param fallbackId - The identifier to use when the part has no tool call ID
 * @param streaming - Whether the conversation is currently streaming
 * @returns A timeline step, or `undefined` for unsupported tool parts
 */
function toolStep(
	part: Record<string, unknown>,
	fallbackId: string,
	streaming: boolean,
	nestedTools: Array<ToolPartBase> = [],
	isNestedTaskTool = false,
): TimelineStep | undefined {
	const type = part.type;
	if (
		typeof type !== "string" ||
		!type.startsWith("tool-") ||
		type === "tool-FleetReasoning" ||
		type === "tool-Thinking" ||
		isNestedTaskTool
	)
		return undefined;
	const name = type.slice(5);
	const lower = name.toLowerCase();
	const verb =
		lower.includes("edit") || lower.includes("write") || lower.includes("patch")
			? "Edited"
			: lower.includes("read")
				? "Read"
				: lower.includes("search") || lower.includes("grep") || lower.includes("glob")
					? "Searched"
					: lower.includes("bash") ||
							lower.includes("shell") ||
							lower.includes("python") ||
							lower.includes("ipython")
						? "Ran"
						: name;
	const normalized = normalizeToolPart(part);
	return {
		id: typeof part.toolCallId === "string" ? part.toolCallId : fallbackId,
		verb,
		target: name,
		status: status(part, streaming),
		part: part as ToolPartBase,
		nestedTools,
		traceDescription: normalized?.traceDescription,
		durationLabel: normalized?.durationLabel,
		reportedError: normalized?.outputSummary.isError,
	};
}

/**
 * Converts an artifact into a timeline step with an appropriate action label, target, and status.
 *
 * @param artifact - The artifact to represent in the timeline
 * @returns The timeline step derived from the artifact
 */
function artifactStep(artifact: PrimeAgentArtifact): TimelineStep {
	return {
		id: `artifact:${artifact.id}`,
		verb:
			artifact.kind === "compaction"
				? "Compacted"
				: artifact.kind === "refinement"
					? "Refined"
					: artifact.kind === "recap"
						? "Recapped"
						: artifact.kind === "rlm"
							? "Delegated"
							: artifact.kind === "diff"
								? "Edited"
								: "Completed",
		target:
			artifact.kind === "bash"
				? "Bash output"
				: artifact.kind === "ipython"
					? "IPython result"
					: artifact.kind === "diff"
						? "File change"
						: artifact.kind === "rlm"
							? "Child task"
							: artifact.kind === "recap"
								? "Session recap"
								: artifact.kind === "refinement"
									? "Refinement"
									: "Session activity",
		status: artifact.status === "success" ? "complete" : artifact.status,
	};
}

function TimelineStepRow({
	step,
	onOpenArtifact,
	renderToolDetails,
}: {
	step: TimelineStep;
	onOpenArtifact?: ToolTimelineProps["onOpenArtifact"];
	renderToolDetails?: ToolTimelineProps["renderToolDetails"];
}) {
	const Icon = toolActionIconForName(step.part?.type.replace(/^tool-/, "") ?? step.target);
	const artifactId = step.artifactId;
	const openLabel =
		artifactId && step.artifactTitle
			? step.artifactTarget === "repl"
				? `Open ${step.artifactTitle} in REPL`
				: `Open ${step.artifactTitle} in artifacts`
			: undefined;
	const detailLabel = `Details for ${step.target}${step.id ? ` (${step.id})` : ""}`;
	const statusLabel = step.reportedError
		? "reported error"
		: step.status === "error"
			? "failed"
			: step.status === "running"
				? "running"
				: step.status === "pending"
					? "waiting"
					: step.status === "cancelled"
						? "cancelled"
						: "done";

	const line = (
		<TraceLine
			status={
				step.status === "running"
					? "running"
					: step.status === "error"
						? "error"
						: step.status === "pending"
							? "pending"
							: undefined
			}
		>
			<TraceIcon>
				<Icon
					className={cn(
						"size-3.5",
						step.status === "running" && "animate-pulse text-primary",
						step.status === "error" && "text-destructive",
					)}
				/>
			</TraceIcon>
			<TraceTitle>
				{step.verb} {step.target}
			</TraceTitle>
			<TraceDescription className={step.reportedError ? "text-destructive" : undefined}>
				{statusLabel}
			</TraceDescription>
			{step.traceDescription ? (
				<TraceDescription className="max-w-48 truncate" title={step.traceDescription}>
					{step.traceDescription}
				</TraceDescription>
			) : null}
			{step.durationLabel ? <TraceDescription>{step.durationLabel}</TraceDescription> : null}
		</TraceLine>
	);
	return (
		<div className="flex min-w-0 items-start gap-2">
			{step.part ? (
				<TraceCollapsible className="min-w-0 flex-1">
					<TraceCollapsibleTrigger aria-label={detailLabel}>{line}</TraceCollapsibleTrigger>
					<TraceCollapsibleContent>
						{renderToolDetails ? (
							renderToolDetails(step.part, step.status === "running", step.nestedTools)
						) : (
							<Suspense fallback={null}>
								<LazySessionToolRenderer
									part={step.part}
									nestedTools={step.nestedTools}
									chatStatus={step.status === "running" ? "streaming" : undefined}
									insideTrace
								/>
							</Suspense>
						)}
					</TraceCollapsibleContent>
				</TraceCollapsible>
			) : (
				line
			)}
			{openLabel && artifactId && onOpenArtifact ? (
				<button
					type="button"
					className="shrink-0 text-micro underline"
					aria-label={openLabel}
					onClick={() => onOpenArtifact(artifactId, step.artifactTarget)}
				>
					Open
				</button>
			) : null}
		</div>
	);
}

/**
 * Displays a collapsible timeline of tool actions from chat messages and artifacts.
 *
 * @param messages - Chat messages containing tool actions
 * @param artifacts - Artifacts associated with tool actions
 * @param streaming - Whether the chat is currently streaming
 * @param className - Additional CSS classes for the timeline
 */
export function ToolTimeline({
	messages,
	artifacts = NO_ARTIFACTS,
	streaming,
	className,
	onOpenArtifact,
	renderToolDetails,
}: ToolTimelineProps) {
	const steps = useMemo(() => {
		const seen = new Set<string>();
		const artifactByToolCallId = new Map(
			artifacts.flatMap((artifact) =>
				artifact.sourceToolCallId ? [[artifact.sourceToolCallId, artifact] as const] : [],
			),
		);
		const fromMessages = messages.flatMap((message) => {
			const taskPartIds = new Set(
				message.parts.flatMap((part) => {
					const source = record(part);
					return (source?.type === "tool-Task" || source?.type === "tool-Agent") &&
						typeof source.toolCallId === "string"
						? [source.toolCallId]
						: [];
				}),
			);
			const nestedToolsByTask = new Map<string, Array<ToolPartBase>>();
			const nestedToolIds = new Set<string>();
			for (const part of message.parts) {
				const source = record(part);
				const toolCallId = typeof source?.toolCallId === "string" ? source.toolCallId : undefined;
				const separator = toolCallId?.indexOf(":") ?? -1;
				if (!toolCallId || separator <= 0) continue;
				const parentId = toolCallId.slice(0, separator);
				if (!taskPartIds.has(parentId)) continue;
				nestedToolIds.add(toolCallId);
				const children = nestedToolsByTask.get(parentId) ?? [];
				children.push(source as ToolPartBase);
				nestedToolsByTask.set(parentId, children);
			}
			return message.parts.flatMap((part, index) => {
				const source = record(part) ?? {};
				const toolCallId = typeof source.toolCallId === "string" ? source.toolCallId : undefined;
				const step = toolStep(
					source,
					`${message.id}:${index}`,
					streaming,
					toolCallId ? (nestedToolsByTask.get(toolCallId) ?? []) : [],
					toolCallId ? nestedToolIds.has(toolCallId) : false,
				);
				if (!step || seen.has(step.id)) return [];
				seen.add(step.id);
				return [withArtifact(step, artifactByToolCallId.get(step.id))];
			});
		});
		const fromArtifacts = artifacts.flatMap((artifact) => {
			if (artifact.sourceToolCallId && seen.has(artifact.sourceToolCallId)) return [];
			const step = withArtifact(artifactStep(artifact), artifact);
			if (seen.has(step.id)) return [];
			seen.add(step.id);
			return [step];
		});
		return [...fromMessages, ...fromArtifacts];
	}, [artifacts, messages, streaming]);
	const [open, setOpen] = useState(true);
	if (steps.length === 0) return null;

	const active = [...steps].reverse().find((step) => step.status === "running") ?? steps.at(-1);
	const StatusIcon = toolActionIconForName(active?.part?.type.replace(/^tool-/, "") ?? active?.target ?? "activity");
	return (
		<Trace className={cn("mb-2", className)} data-testid="tool-trace">
			<TraceCollapsible open={open} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger aria-label={`${steps.length} tool ${steps.length === 1 ? "action" : "actions"}`}>
					<TraceLine
						status={active?.status === "running" ? "running" : active?.status === "error" ? "error" : undefined}
					>
						<TraceIcon>
							<StatusIcon className={cn("size-3.5", active?.status === "running" && "animate-spin")} />
						</TraceIcon>
						<TraceTitle>
							{streaming && active
								? `${active.verb} ${active.target}`
								: `${steps.length} tool ${steps.length === 1 ? "action" : "actions"}`}
						</TraceTitle>
						<TraceDescription>{steps.length}</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<Trace className="gap-1">
						{steps.map((step) => (
							<TimelineStepRow
								key={step.id}
								step={step}
								onOpenArtifact={onOpenArtifact}
								renderToolDetails={renderToolDetails}
							/>
						))}
					</Trace>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
