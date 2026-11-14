"use client";

import { memo } from "react";
import { Citations } from "@/components/tools/citations";
import { FileDiff } from "@/components/tools/file-diff";
import { ImageGeneration } from "@/components/tools/image-generation";
import {
	SessionAgentPlan,
	SessionAgentPlanDecision,
	type SessionPlanDecisionPart,
	type SessionPlanItem,
	sessionAgentPlanPresentation,
} from "@/components/tools/session-agent-plan";
import { type TodoItem, TodoList } from "@/components/tools/todo-list";
import { ToolApproval } from "@/components/tools/tool-approval";
import { CodeBlock } from "@/components/tools/tool-code-block";
import { ToolResult, ToolResultOutput, type ToolResultStatus } from "@/components/tools/tool-result";
import { Trace, TraceDescription, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { ToolRendererProps } from "@/lib/chat/chat-message-parts";
import type { CustomToolRendererProps } from "@/lib/chat/types";
import type { AgentCodeLanguage } from "@/lib/shiki-highlight";
import { toolPartDisplayName } from "@/lib/tools/tool-action-icon";
import { coerceStructuredToolPart, normalizeToolPart, type ToolRecord } from "@/lib/tools/tool-output-normalizer";

const MCP_TOOL_PREFIX = "tool-mcp__";

const BUILTIN_MCP_TOOL_NAMES: Record<string, string> = {
	"tool-ListMcpResources": "list_resources",
	"tool-ListMcpResourcesTool": "list_resources",
	"tool-ReadMcpResource": "read_resource",
	"tool-ReadMcpResourceTool": "read_resource",
};

function parseMcpToolName(partType: string): string | undefined {
	const builtin = BUILTIN_MCP_TOOL_NAMES[partType];
	if (builtin) return builtin;
	if (!partType.startsWith(MCP_TOOL_PREFIX)) return undefined;
	const withoutPrefix = partType.slice(MCP_TOOL_PREFIX.length);
	const separatorIndex = withoutPrefix.indexOf("__");
	return separatorIndex === -1 ? undefined : withoutPrefix.slice(separatorIndex + 2);
}

function unwrapMcpOutput(output: unknown): unknown {
	if (
		typeof output === "object" &&
		output !== null &&
		"content" in output &&
		Array.isArray((output as { content?: unknown }).content)
	) {
		const textParts = (output as { content: Array<{ type?: string; text?: string }> }).content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text ?? "");
		if (textParts.length > 0) {
			const combined = textParts.join("\n");
			try {
				return JSON.parse(combined);
			} catch {
				return combined;
			}
		}
	}
	if (typeof output === "string") {
		try {
			return JSON.parse(output);
		} catch {
			return output;
		}
	}
	return output;
}

function deriveCustomStatus(
	status: ToolResultStatus,
	partState: unknown,
	chatStatus?: string,
): CustomToolRendererProps["status"] {
	if (partState === "input-streaming" || partState === "streaming") return "streaming";
	if (status === "error") return "error";
	if (status === "running") {
		return chatStatus === "streaming" || chatStatus === "submitted" ? "pending" : "success";
	}
	return "success";
}

function toSessionPlanItems(items: readonly TodoItem[]): SessionPlanItem[] {
	return items.map((item) => ({
		id: String(item.id),
		title: typeof item.title === "string" ? item.title : "",
		status:
			item.status === "in-progress"
				? "in_progress"
				: item.status === "completed"
					? "completed"
					: item.status === "cancelled"
						? "cancelled"
						: "pending",
	}));
}

function Approval({ approval, name, status }: { approval?: ToolRecord; name: string; status: ToolResultStatus }) {
	if (!approval) return null;
	const approvalStatus = status === "running" ? "pending" : status === "error" ? "error" : "complete";
	const parameters = Object.entries(approval).flatMap(([id, value]) => {
		if (typeof value === "object" || typeof value === "function") return [];
		return [{ id, label: id, value: String(value) }];
	});
	return (
		<ToolApproval
			tool={name}
			title="Fleet Prime permission"
			description="This tool reported a permission decision from Fleet Prime."
			parameters={parameters}
			status={approvalStatus}
		/>
	);
}

function SourceBlock({
	code,
	language,
	languageLabel,
	status,
}: {
	code: string;
	language: AgentCodeLanguage;
	languageLabel?: string;
	status: ToolResultStatus;
}) {
	return (
		<CodeBlock
			code={code}
			language={language}
			languageLabel={languageLabel}
			status={status === "running" ? "streaming" : "complete"}
			showStatus={false}
			maxHeight={160}
			showLineNumbers={false}
			wrap
		/>
	);
}

/**
 * Hides private reasoning/question parts and dispatches all tool parts via normalized or custom presentations.
 */
export const SessionToolRenderer = memo(function SessionToolRenderer({
	part: rawPart,
	nestedTools,
	chatStatus,
	toolRenderers,
	insideTrace = false,
}: ToolRendererProps) {
	const part = coerceStructuredToolPart(rawPart);
	const partType = typeof part.type === "string" ? part.type : "";
	if (partType === "tool-Thinking" || partType === "tool-FleetReasoning" || partType === "tool-Question") {
		return null;
	}
	if (!partType.startsWith("tool-")) return null;

	const normalized = normalizeToolPart(part, chatStatus);
	if (!normalized) return null;

	const mcpToolName = parseMcpToolName(partType);
	const plainToolName = partType.slice("tool-".length);
	const customToolName = mcpToolName ?? plainToolName;
	const CustomRenderer = toolRenderers?.[customToolName] ?? toolRenderers?.[plainToolName];
	if (CustomRenderer) {
		const rawOutput =
			(part as { output?: unknown; result?: unknown }).output ?? (part as { result?: unknown }).result;
		return (
			<CustomRenderer
				name={customToolName}
				input={(part.input as Record<string, unknown> | undefined) ?? {}}
				output={rawOutput !== undefined ? (mcpToolName ? unwrapMcpOutput(rawOutput) : rawOutput) : undefined}
				status={deriveCustomStatus(normalized.status, part.state, chatStatus)}
			/>
		);
	}

	const pendingDecision = Boolean((part.input as { pendingDecision?: unknown } | undefined)?.pendingDecision);
	if (normalized.lowerName === "planwrite" && pendingDecision) {
		return <SessionAgentPlanDecision part={part as SessionPlanDecisionPart} chatStatus={chatStatus} />;
	}

	const { detail, status } = normalized;

	if ((partType === "tool-Task" || partType === "tool-Agent") && nestedTools && nestedTools.length > 0) {
		const description =
			typeof (part.input as { description?: unknown } | undefined)?.description === "string"
				? (part.input as { description: string }).description
				: undefined;
		return (
			<Trace data-testid="nested-task-tools" className="gap-1.5">
				{description ? (
					<TraceLine>
						<TraceTitle>{description}</TraceTitle>
						<TraceDescription>{`${nestedTools.length} ${nestedTools.length === 1 ? "step" : "steps"}`}</TraceDescription>
					</TraceLine>
				) : null}
				{nestedTools.map((nestedPart, index) => (
					<div
						key={nestedPart.toolCallId ?? `${nestedPart.type}-${index}`}
						className="border-l border-border/60 pl-3"
					>
						<p className="mb-1 text-xs font-medium text-muted-foreground">
							{toolPartDisplayName(nestedPart.type)}
						</p>
						<SessionToolRenderer
							part={nestedPart}
							chatStatus={chatStatus}
							toolRenderers={toolRenderers}
							insideTrace
						/>
					</div>
				))}
			</Trace>
		);
	}

	if (detail?.kind === "todo") {
		const planItems = toSessionPlanItems(detail.items);
		const planPresentation =
			normalized.lowerName === "planwrite" && (part.input as { executing?: unknown } | undefined)?.executing
				? sessionAgentPlanPresentation(planItems)
				: undefined;

		if (planPresentation) {
			return <SessionAgentPlan presentation={planPresentation} className="mb-2" />;
		}

		return (
			<TodoList items={detail.items} title={detail.title} defaultOpen collapseOnComplete={false} maxHeight={240} />
		);
	}

	if (detail?.kind === "citations") {
		return <Citations citations={detail.citations} title="Sources" defaultOpen />;
	}

	if (detail?.kind === "image") {
		return (
			<ImageGeneration status={status === "running" ? "generating" : status === "error" ? "error" : "complete"}>
				<img
					src={detail.url}
					alt="Generated result"
					width={640}
					height={320}
					loading="lazy"
					decoding="async"
					className="h-auto max-h-80 w-full object-contain"
				/>
			</ImageGeneration>
		);
	}

	if (detail?.kind === "diff") {
		return (
			<FileDiff
				file={detail.file}
				lines={detail.lines}
				status={status === "running" ? "streaming" : "complete"}
				language="diff"
				maxHeight={240}
				copyText={detail.copyText}
				defaultOpen={status === "running"}
			/>
		);
	}

	const outputDetail = detail?.kind === "output" ? detail : undefined;
	const content = outputDetail?.content || normalized.traceDescription || "No output.";
	const details = (
		<div className="flex min-w-0 flex-col gap-2">
			{outputDetail?.sourceCode ? (
				<SourceBlock
					code={outputDetail.sourceCode}
					language={outputDetail.sourceLanguage ?? "text"}
					languageLabel={outputDetail.sourceLabel}
					status={status}
				/>
			) : null}
			{outputDetail && outputDetail.sections.length > 0 ? (
				outputDetail.sections.map((section) => (
					<ToolResultOutput
						key={section.label}
						language={section.language}
						label={section.label}
						error={section.label === "reported-error"}
					>
						{section.content}
					</ToolResultOutput>
				))
			) : (
				<ToolResultOutput language={outputDetail?.language ?? "text"}>{content}</ToolResultOutput>
			)}
			<Approval approval={normalized.approval} name={normalized.name} status={status} />
		</div>
	);
	if (insideTrace) return details;
	return (
		<ToolResult
			tool="Prime"
			title={normalized.name}
			status={status}
			kind={
				normalized.lowerName.includes("bash") ||
				normalized.lowerName.includes("shell") ||
				normalized.lowerName.includes("python")
					? "terminal"
					: "custom"
			}
			meta={normalized.metadata.length > 0 ? normalized.metadata.join(" · ") : undefined}
			defaultOpen={status === "running"}
			collapseOnComplete={false}
			maxHeight={240}
			copyText={content}
		>
			{details}
		</ToolResult>
	);
});
export { SessionToolRenderer as SpecializedToolRenderer };
