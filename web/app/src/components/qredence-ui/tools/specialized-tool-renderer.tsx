"use client";

import { CheckCircle2, Terminal, Wrench } from "lucide-react";
import { memo } from "react";
import type { AgentCodeLanguage } from "@/components/qredence-ui/tools/agent-code";
import { Citations } from "@/components/qredence-ui/tools/citations";
import { CodeBlock } from "@/components/qredence-ui/tools/code-block";
import { FileDiff } from "@/components/qredence-ui/tools/file-diff";
import { ImageGeneration } from "@/components/qredence-ui/tools/image-generation";
import {
	SessionAgentPlan,
	type SessionPlanItem,
	sessionAgentPlanPresentation,
} from "@/components/qredence-ui/tools/session-agent-plan";
import { type TodoItem, TodoList } from "@/components/qredence-ui/tools/todo-list";
import { ToolApproval } from "@/components/qredence-ui/tools/tool-approval";
import { normalizeToolPart, type ToolRecord } from "@/components/qredence-ui/tools/tool-output-normalizer";
import type { ToolRendererProps } from "@/components/qredence-ui/tools/tool-renderer";
import { ToolRenderer } from "@/components/qredence-ui/tools/tool-renderer";
import { ToolResult, ToolResultOutput, type ToolResultStatus } from "@/components/qredence-ui/tools/tool-result";

/** Map todo-list items (hyphen status) into the Agent-Plan item model (underscore status). */
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

function statusIcon(status: ToolResultStatus, name: string) {
	if (name.toLowerCase().includes("bash") || name.toLowerCase().includes("shell")) {
		return <Terminal aria-hidden="true" className="size-4" />;
	}
	if (status === "success") return <CheckCircle2 aria-hidden="true" className="size-4" />;
	return <Wrench aria-hidden="true" className="size-4" />;
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
 * Renders supported tool outputs with Fleet presentations and delegates unsupported or interactive tools to the
 * generic renderer.
 */
export const SpecializedToolRenderer = memo(function SpecializedToolRenderer({
	part,
	nestedTools,
	chatStatus,
	toolRenderers,
}: ToolRendererProps) {
	const renderFallback = () => (
		<ToolRenderer part={part} nestedTools={nestedTools} chatStatus={chatStatus} toolRenderers={toolRenderers} />
	);
	const normalized = normalizeToolPart(part, chatStatus);
	if (!normalized || normalized.lowerName === "question") return renderFallback();

	const { detail, status } = normalized;
	if (!detail) return renderFallback();

	if (detail.kind === "todo") {
		const planItems = toSessionPlanItems(detail.items);
		const pendingDecision = Boolean((part.input as { pendingDecision?: unknown } | undefined)?.pendingDecision);
		// A plan awaiting an Execute/Stay/Refine decision must keep its controls:
		// the fallback PlanWrite renderer owns them, so never swap it out.
		if (normalized.lowerName === "planwrite" && pendingDecision) {
			return renderFallback();
		}
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

	if (detail.kind === "citations") {
		return <Citations citations={detail.citations} title="Sources" defaultOpen />;
	}

	if (detail.kind === "image") {
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

	if (detail.kind === "diff") {
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

	const content = detail.content || "No output.";
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
			icon={statusIcon(status, normalized.name)}
			defaultOpen={status === "running"}
			collapseOnComplete={false}
			maxHeight={240}
			copyText={content}
		>
			{detail.sourceCode ? (
				<SourceBlock
					code={detail.sourceCode}
					language={detail.sourceLanguage ?? "text"}
					languageLabel={detail.sourceLabel}
					status={status}
				/>
			) : null}
			{detail.sections.map((section) => (
				<ToolResultOutput key={section.label} language={section.language} label={section.label}>
					{section.content}
				</ToolResultOutput>
			))}
			<Approval approval={normalized.approval} name={normalized.name} status={status} />
		</ToolResult>
	);
});
